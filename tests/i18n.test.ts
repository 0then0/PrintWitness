import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { Report } from '../src/core/types.ts';
import type { MessageKey } from '../src/i18n/en.ts';
import {
  catalogs,
  defaultLocale,
  diagnostic,
  diagnosticKeys,
  isLocale,
  locales,
  statusLabel,
  translator,
} from '../src/i18n/index.ts';
import { reportHtml } from '../src/node/report.ts';

test('English is the default, and only supported locale IDs are accepted', () => {
  assert.equal(defaultLocale, 'en');
  for (const locale of ['en', 'es', 'de', 'fr', 'ja', 'pt-BR', 'ru']) assert(isLocale(locale));
  for (const locale of ['pt', 'pt-PT', 'EN', '', null, 'constructor', '__proto__'])
    assert(!isLocale(locale));
});
test('every catalog is complete and preserves all named interpolation parameters', () => {
  const reference = catalogs.en;
  for (const locale of locales) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), Object.keys(reference).sort(), locale);
    for (const key of Object.keys(reference) as MessageKey[]) {
      const value = catalogs[locale][key];
      assert(value.trim(), `${locale}:${key}`);
      assert.deepEqual(
        value.match(/\{\w+\}/g)?.sort(),
        reference[key].match(/\{\w+\}/g)?.sort(),
        `${locale}:${key}`,
      );
      assert(!/\uFFFD/.test(value), `${locale}:${key} has replacement characters`);
    }
    assert.equal(
      translator(locale)('pageCount', { count: 1000 }),
      catalogs[locale].pageCount.replace('{count}', new Intl.NumberFormat(locale).format(1000)),
    );
  }
});
test('all core reasons and warnings have translated presentation without changing JSON data', async () => {
  const core = await readFile(new URL('../src/core/compare.ts', import.meta.url), 'utf8');
  // Catch new unregistered core diagnostics as they are added, not just current catalog keys.
  const literals = [...core.matchAll(/'([^'\n]+(?:\\'[^'\n]*)*)'/g)].map((m) => m[1]);
  for (const message of literals.filter((s) => s.endsWith('.') && s.length > 40))
    assert(diagnosticKeys[message], `unregistered diagnostic: ${message}`);
  for (const locale of locales) {
    const t = translator(locale);
    for (const [message, key] of Object.entries(diagnosticKeys))
      assert.equal(diagnostic(locale, message), t(key));
    assert.equal(
      diagnostic(
        locale,
        'page.evaluate: Error: Selector matches no elements: #lost\n    at browser code',
      ),
      t('errorNoSelector', { selector: '#lost' }),
    );
    assert.equal(
      diagnostic(locale, 'Page 12: preview could not be rendered.'),
      t('warningPreview', { page: 12 }),
    );
    assert.equal(
      diagnostic(locale, 'TimeoutError: page.waitForFunction: Timeout 1000ms exceeded'),
      t('errorTimeout'),
    );
    assert.equal(diagnostic(locale, 'Cannot read PDF: Invalid PDF structure'), t('errorPdfRead'));
    assert.equal(
      diagnostic(
        locale,
        'PDF runtime resource unavailable: cMapUrl/UniJIS-UCS2-H.bcmap. Processing is incomplete.',
      ),
      t('errorPdfResource', { resource: 'cMapUrl/UniJIS-UCS2-H.bcmap' }),
    );
    assert.equal(diagnostic(locale, 'Unexpected token in JSON'), t('errorJson'));
    assert.equal(diagnostic(locale, 'ENOENT: missing local.html'), t('errorFile'));
    assert.equal(diagnostic(locale, 'Unrecognized platform failure'), t('operationFailed'));
    assert.equal(diagnostic(locale, 'constructor'), t('operationFailed'));
    assert.equal(diagnostic(locale, '__proto__'), t('operationFailed'));
    assert.equal(
      diagnostic(locale, 'Explicitly excluded: First line\nSecond line'),
      t('reasonExcluded', { reason: 'First line\nSecond line' }),
    );
  }
});
test('standalone HTML translates labels and diagnostics, retains document text and escapes exclusions', () => {
  const report: Report = {
    schema: 'printwitness-report/1',
    createdAt: '2026-10-23T12:00:00Z',
    status: 'mismatch',
    manifest: {
      schema: 'printwitness/1',
      createdAt: '',
      source: { name: 'test.html', sha256: 'abc', readiness: 'dom' },
      sections: [],
      exclusions: [],
    },
    pdf: { name: 'original.pdf', sha256: 'def', pages: [] },
    findings: [
      {
        id: 'finding',
        sectionId: 's1',
        section: 'Original heading',
        kind: 'text',
        expected: '原文 · café · Москва',
        status: 'mismatch',
        reason: 'Expected text/row is absent inside the established section boundaries.',
        evidence: [],
      },
      {
        id: 'excluded',
        sectionId: 's1',
        section: 'Original heading',
        kind: 'text',
        expected: 'Unchanged',
        status: 'unverifiable',
        reason: 'Explicitly excluded: <script>alert(1)</script>',
        excluded: '<script>alert(1)</script>',
        evidence: [],
      },
    ],
    warnings: [
      'Text-layer presence does not prove visibility. Clipping, overlays and transparency are not universally detected.',
      'PDF runtime resource unavailable: cMapUrl/UniJIS-UCS2-H.bcmap. Processing is incomplete.',
    ],
  };
  const before = JSON.stringify(report);
  for (const locale of locales) {
    const html = reportHtml(report, [], locale);
    const t = translator(locale);
    assert(html.includes(`<html lang="${locale}">`));
    assert(html.includes(`<title>${t('reportTitle')}</title>`));
    assert(html.includes(statusLabel(locale, 'mismatch')));
    assert(html.includes('原文 · café · Москва'));
    assert(html.includes('Original heading'));
    assert(html.includes(t('warningVisibility')));
    assert(html.includes(t('errorPdfResource', { resource: 'cMapUrl/UniJIS-UCS2-H.bcmap' })));
    assert(!html.includes('<script>alert(1)</script>'));
    assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  }
  assert.equal(JSON.stringify(report), before);
  assert(reportHtml(report, []).includes('<html lang="en">'));
});
