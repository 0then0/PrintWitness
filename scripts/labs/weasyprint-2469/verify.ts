import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { compare } from '../../../src/core/compare.ts';
import type { PdfIndex } from '../../../src/core/types.ts';
import { sha256 } from '../../../src/node/source.ts';
import { readLabReports } from './integrity.ts';

const root = 'artifacts/weasyprint-2469';
const { manifest, reports } = await readLabReports(root);
const independent = [];
for (const revision of ['parent', 'fix']) {
  const layout = JSON.parse(await readFile(`${root}/${revision}-layout.json`, 'utf8'));
  for (const caseName of ['upstream', 'adapted']) {
    for (const control of ['', '-no-flex', '-no-break']) {
      const name = `${revision}-${caseName}${control}`;
      const pages = (await readFile(`${root}/${name}.txt`, 'utf8')).split('\f');
      assert.equal(pages.pop(), '', 'Poppler must terminate its last page with a form feed.');
      const text = pages.join('\n');
      const clean = (s: string) => s.replace(/\s+/gu, ' ').trim();
      assert.deepEqual(
        pages.map(clean),
        layout[name].map((p: string[]) => clean(p.join(' '))),
        `${name}: layout and Poppler disagree`,
      );
      assert(text.includes(caseName === 'upstream' ? 'B' : 'PW2469-B before forced break'));
      if (!control) assert.equal(pages.length, 3);
      const marker = caseName === 'upstream' ? 'C' : 'PW2469-C after forced break';
      const present = caseName === 'upstream' ? /\bC\b/u.test(text) : text.includes(marker);
      assert.equal(present, revision === 'fix' || !!control, `${name}: reproduction diverged`);
      independent.push({ name, pages: pages.map((p) => p.trim()), marker, present });
    }
  }
  const report = reports[revision];
  assert.equal(report.status, revision === 'parent' ? 'manual' : 'found');
  if (revision === 'parent') {
    assert(
      report.findings.every((f: { reason: string }) => f.reason.startsWith('Section boundaries')),
    );
  }
}
const environment = JSON.parse(await readFile(`${root}/environment.json`, 'utf8'));
assert.equal(environment.upstream_regression.parent.exit_code, 1);
assert.equal(environment.upstream_regression.fix.exit_code, 0);
assert.equal(
  environment.upstream_regression.parent.test_sha256,
  environment.upstream_regression.fix.test_sha256,
);
assert.match(await readFile(`${root}/fix-original-regression.txt`, 'utf8'), /1 passed/u);

// Synthetic core probes isolate uncertainty handling, not the upstream defect.
// No PDF or frozen expectation is changed. These are explicitly modeled indexes.
const section = manifest.sections[0];
const [heading, beforeBreak, afterBreak] = section.expectations.map((e) => e.text);
const end = section.endContext;
assert(end);
const index = (pages: string[][]): PdfIndex => ({
  pages: pages.map((lines, i) => ({
    number: i + 1,
    width: 600,
    height: 800,
    text: lines.join(' '),
  })),
  tokens: pages.flatMap((lines, i) =>
    lines.map((text, j) => ({
      text,
      page: i + 1,
      lineEnd: true,
      box: { x: 10, y: 20 + j * 30, width: text.length * 6, height: 12 },
    })),
  ),
  links: [],
  warnings: [],
});
const probes: [string, string[][], string, string[]][] = [
  [
    'no uncertain page; established boundaries',
    [[heading, beforeBreak, end]],
    'mismatch',
    ['found', 'found', 'mismatch'],
  ],
  [
    'textless page outside established section',
    [[], [heading, beforeBreak, end]],
    'manual',
    ['found', 'found', 'manual'],
  ],
  [
    'textless page inside established section',
    [[heading, beforeBreak], [], [end]],
    'manual',
    ['found', 'found', 'manual'],
  ],
  [
    'textless page and ambiguous boundaries',
    [[], [heading, beforeBreak], [heading, end]],
    'manual',
    ['manual', 'manual', 'manual'],
  ],
  [
    'all pages have no text layer',
    [[]],
    'unverifiable',
    ['unverifiable', 'unverifiable', 'unverifiable'],
  ],
  [
    'all expectations found with a textless page',
    [[], [heading, beforeBreak], [afterBreak, end]],
    'found',
    ['found', 'found', 'found'],
  ],
];
const uncertainty = probes.map(([scenario, pages, expected, findings]) => {
  const report = compare(manifest, index(pages), {
    name: 'synthetic-index-only',
    sha256: 'not-a-pdf',
  });
  assert.equal(report.status, expected, scenario);
  assert.deepEqual(
    report.findings.map((f) => f.status),
    findings,
    scenario,
  );
  return {
    scenario,
    kind: 'synthetic index, not renderer evidence',
    status: report.status,
    findings: report.findings,
  };
});
await writeFile(`${root}/independent-extraction.json`, JSON.stringify(independent, null, 2));
await writeFile(`${root}/uncertainty-probes.json`, JSON.stringify(uncertainty, null, 2));
const hashes: Record<string, string> = {};
for (const file of (await readdir(root)).sort()) {
  if (file !== 'checksums.json' && /\.(pdf|json|html|txt)$/u.test(file))
    hashes[file] = sha256(await readFile(`${root}/${file}`));
}
await writeFile(`${root}/checksums.json`, JSON.stringify(hashes, null, 2));
console.log(
  'Verified: independent extraction, causal controls, upstream regression, frozen manifest, reports and 6 uncertainty probes.',
);
