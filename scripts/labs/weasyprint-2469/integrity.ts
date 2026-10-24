import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseManifest } from '../../../src/core/manifest.ts';
import type { Report } from '../../../src/core/types.ts';
import { sha256 } from '../../../src/node/source.ts';

/** Validate both PDF/report pairs before a verifier or packager writes any output. */
export async function readLabReports(root: string) {
  const frozen = await readFile(`${root}/manifest.json`);
  assert.equal(
    sha256(frozen),
    (await readFile(`${root}/manifest.sha256`, 'utf8')).trim(),
    'Frozen manifest hash mismatch',
  );
  const manifest = parseManifest(JSON.parse(frozen.toString()));
  const reports: Record<string, Report> = {};
  for (const revision of ['parent', 'fix']) {
    const name = `${revision}-adapted`;
    const report: Report = JSON.parse(await readFile(`${root}/${name}.json`, 'utf8'));
    assert.equal(report.schema, 'printwitness-report/1', `${name}: invalid report schema`);
    assert.deepEqual(report.manifest, manifest, `${name}: report manifest mismatch`);
    assert.equal(report.pdf.name, `${name}.pdf`, `${name}: report PDF name mismatch`);
    assert.equal(
      sha256(await readFile(`${root}/${name}.pdf`)),
      report.pdf.sha256,
      `${name}: PDF hash mismatch; regenerate reports with check.ts compare`,
    );
    reports[revision] = report;
  }
  return { manifest, reports };
}
