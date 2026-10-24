import { execFileSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { readLabReports } from './integrity.ts';

const root = 'artifacts/weasyprint-2469';
await readLabReports(root);
const share = `${root}/share`;
await mkdir(share, { recursive: true });
// Explicit allowlist. Never archive the downloaded issue example or work directory.
const files = [
  'manifest.json',
  'manifest.sha256',
  'environment.json',
  'issue-evidence.json',
  'parent-adapted.pdf',
  'fix-adapted.pdf',
  'parent-adapted.json',
  'fix-adapted.json',
  'parent-adapted.html',
  'fix-adapted.html',
  'printwitness-summary.json',
  'parent-upstream-regression.txt',
  'fix-upstream-regression.txt',
  'fix-original-regression.txt',
  'uncertainty-probes.json',
];
for (const file of files) await copyFile(`${root}/${file}`, `${share}/${file}`);
for (const revision of ['parent', 'fix']) {
  for (let page = 1; page <= 3; page++) {
    const file = `${revision}-adapted-${page}.png`;
    await copyFile(`${root}/previews/${file}`, `${share}/${file}`);
  }
}
for (const file of ['NOTICE.md', 'LICENSE.WeasyPrint', 'LICENSE.DejaVu']) {
  await copyFile(`scripts/labs/weasyprint-2469/${file}`, `${share}/${file}`);
}
await copyFile('fixtures/weasyprint-2469/adapted.html', `${share}/adapted.html`);
await copyFile('LICENSE', `${share}/LICENSE.PrintWitness`);
await copyFile('docs/case-studies/weasyprint-2469.md', `${share}/case-study.md`);
execFileSync('tar', [
  '-czf',
  `${root}/share.tar.gz`,
  '-C',
  share,
  ...files,
  ...['parent', 'fix'].flatMap((revision) =>
    [1, 2, 3].map((page) => `${revision}-adapted-${page}.png`),
  ),
  'NOTICE.md',
  'LICENSE.WeasyPrint',
  'LICENSE.DejaVu',
  'LICENSE.PrintWitness',
  'adapted.html',
  'case-study.md',
]);
console.log(`${root}/share.tar.gz: adapted artifacts and license notices only.`);
