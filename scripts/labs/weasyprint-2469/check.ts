import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compare } from '../../../src/core/compare.ts';
import { parseManifest } from '../../../src/core/manifest.ts';
import { analyzePdf } from '../../../src/node/pdf.ts';
import { reportHtml } from '../../../src/node/report.ts';
import { capture, sha256 } from '../../../src/node/source.ts';

const root = resolve('artifacts/weasyprint-2469');
await mkdir(root, { recursive: true });
const manifestPath = `${root}/manifest.json`;
if (process.argv[2] === 'freeze') {
  // Refuse to replace an existing baseline, including on a later rerun.
  assert(
    !(await readdir(root)).some((name) => name.endsWith('.pdf')),
    'Freeze before generating any PDF.',
  );
  const manifest = await capture({
    source: resolve('fixtures/weasyprint-2469/adapted.html'),
    selectors: ['#required'],
    exclusions: [],
    ready: { mode: 'dom', value: '', timeout: 10000 },
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  await writeFile(`${root}/manifest.sha256`, `${sha256(await readFile(manifestPath))}\n`, {
    flag: 'wx',
  });
  console.log(
    'Frozen expectations:',
    manifest.sections[0].expectations.map((e) => e.text),
  );
} else if (process.argv[2] === 'compare') {
  const frozen = await readFile(manifestPath);
  assert.equal(sha256(frozen), (await readFile(`${root}/manifest.sha256`, 'utf8')).trim());
  const manifest = parseManifest(JSON.parse(frozen.toString()));
  const summary = [];
  for (const revision of ['parent', 'fix']) {
    const name = `${revision}-adapted`;
    const bytes = await readFile(`${root}/${name}.pdf`);
    const { index, images } = await analyzePdf(bytes);
    assert(!index.error, index.error ?? 'PDF extraction failed');
    assert.equal(images.length, index.pages.length);
    assert(images.every((i) => i.startsWith('data:image/png;base64,')));
    const report = compare(manifest, index, { name: `${name}.pdf`, sha256: sha256(bytes) });
    const suffix = process.argv[3] ? `-${process.argv[3]}` : '';
    await writeFile(`${root}/${name}${suffix}.json`, JSON.stringify(report, null, 2));
    await writeFile(`${root}/${name}${suffix}.html`, reportHtml(report, images));
    summary.push({
      revision,
      status: report.status,
      pages: index.pages,
      findings: report.findings,
    });
    console.log(
      revision,
      report.status,
      report.findings.map((f) => [f.expected, f.status]),
    );
  }
  await writeFile(
    `${root}/printwitness-summary${process.argv[3] ? `-${process.argv[3]}` : ''}.json`,
    JSON.stringify(summary, null, 2),
  );
  assert.equal(sha256(await readFile(manifestPath)), sha256(frozen));
} else {
  throw new Error('Use freeze before rendering, then compare [report-suffix].');
}
