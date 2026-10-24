import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readLabReports } from '../scripts/labs/weasyprint-2469/integrity.ts';
import type { Manifest, Report } from '../src/core/types.ts';
import { sha256 } from '../src/node/source.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const cwd = await mkdtemp(join(tmpdir(), 'printwitness-lab-integrity-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const root = join(cwd, 'artifacts/weasyprint-2469');
  await mkdir(root, { recursive: true });
  const manifest: Manifest = {
    schema: 'printwitness/1',
    createdAt: '2026-10-24T00:00:00Z',
    source: { name: 'adapted.html', sha256: 'source', readiness: 'dom' },
    exclusions: [],
    sections: [
      {
        id: 's1',
        selector: '#required',
        title: 'Required',
        anchor: 'Required',
        before: null,
        after: null,
        startContext: null,
        endContext: null,
        anchorInside: true,
        headers: [],
        expectations: [{ id: 'e1', kind: 'text', text: 'Required' }],
      },
    ],
  };
  const frozen = JSON.stringify(manifest);
  await writeFile(`${root}/manifest.json`, frozen);
  await writeFile(`${root}/manifest.sha256`, `${sha256(frozen)}\n`);
  // Distinct bytes isolate identity checks; PDF rendering is covered by the real lab.
  const pdfs = { parent: Buffer.from('parent PDF bytes'), fix: Buffer.from('fixed PDF bytes') };
  const reports: Record<string, Report> = {};
  for (const revision of ['parent', 'fix'] as const) {
    const name = `${revision}-adapted`;
    const report: Report = {
      schema: 'printwitness-report/1',
      createdAt: manifest.createdAt,
      manifest,
      pdf: { name: `${name}.pdf`, sha256: sha256(pdfs[revision]), pages: [] },
      status: revision === 'parent' ? 'manual' : 'found',
      findings: [],
      warnings: [],
    };
    reports[revision] = report;
    await writeFile(`${root}/${name}.pdf`, pdfs[revision]);
    await writeFile(`${root}/${name}.json`, JSON.stringify(report));
  }
  return { cwd, root, manifest, reports, pdfs };
}

test('lab integrity accepts both reports against the same frozen manifest and PDF bytes', async (t) => {
  const { root, manifest, reports } = await fixture(t);
  assert.deepEqual(await readLabReports(root), { manifest, reports });
});

test('lab integrity rejects a changed PDF with its original report', async (t) => {
  const { root } = await fixture(t);
  await writeFile(`${root}/fix-adapted.pdf`, 'different PDF bytes');
  await assert.rejects(readLabReports(root), /fix-adapted: PDF hash mismatch/);
});

test('lab integrity rejects a report from a different manifest', async (t) => {
  const { root, reports } = await fixture(t);
  const report = structuredClone(reports.fix);
  report.manifest.source.sha256 = 'another source';
  await writeFile(`${root}/fix-adapted.json`, JSON.stringify(report));
  await assert.rejects(readLabReports(root), /fix-adapted: report manifest mismatch/);
});

test('lab integrity rejects a changed frozen manifest even if reports agree with it', async (t) => {
  const { root, manifest, reports } = await fixture(t);
  const changed = { ...manifest, createdAt: 'changed' };
  await writeFile(`${root}/manifest.json`, JSON.stringify(changed));
  for (const revision of ['parent', 'fix']) {
    await writeFile(
      `${root}/${revision}-adapted.json`,
      JSON.stringify({ ...reports[revision], manifest: changed }),
    );
  }
  await assert.rejects(readLabReports(root), /Frozen manifest hash mismatch/);
});

for (const entry of ['verify', 'package']) {
  test(`${entry} rejects swapped PDFs before changing checksums or export artifacts`, async (t) => {
    const { cwd, root, pdfs } = await fixture(t);
    await writeFile(`${root}/parent-adapted.pdf`, pdfs.fix);
    await writeFile(`${root}/fix-adapted.pdf`, pdfs.parent);
    const sentinels = [
      'checksums.json',
      'independent-extraction.json',
      'uncertainty-probes.json',
      'share.tar.gz',
      'share/parent-adapted.pdf',
    ];
    await mkdir(`${root}/share`);
    for (const file of sentinels) await writeFile(`${root}/${file}`, `previous ${file}`);
    const script = fileURLToPath(
      new URL(`../scripts/labs/weasyprint-2469/${entry}.ts`, import.meta.url),
    );
    const result = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /parent-adapted: PDF hash mismatch/);
    for (const file of sentinels) {
      assert.equal(await readFile(`${root}/${file}`, 'utf8'), `previous ${file}`);
    }
  });
}
