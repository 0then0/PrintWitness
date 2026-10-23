import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright';
import { locales, translator } from '../src/i18n/index.ts';

async function assertLayout(page: Page, description: string) {
  const issues = await page.evaluate(() => {
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) problems.push('page overflows');
    for (const element of document.querySelectorAll<HTMLElement>(
      'button:not(.check), .file-button, .pane-title h2, .error > p, .detail-status',
    )) {
      if (!element.getClientRects().length) continue;
      if (
        element.scrollWidth > element.clientWidth + 2 ||
        element.scrollHeight > element.clientHeight + 2
      )
        problems.push(`clipped label: ${element.textContent?.trim()}`);
    }
    const picker = document.querySelector<HTMLSelectElement>('[data-testid=language]');
    if (picker) {
      const style = getComputedStyle(picker);
      const context = document.createElement('canvas').getContext('2d');
      if (context) {
        context.font = style.font;
        const textWidth = context.measureText(picker.selectedOptions[0].text).width;
        const available =
          picker.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight) -
          20;
        if (textWidth > available) problems.push('language name is truncated');
      }
    }
    return problems;
  });
  assert.deepEqual(issues, [], description);
}

export async function testLocales(page: Page, browser: Browser, base: string) {
  await mkdir('artifacts/ui/locales', { recursive: true });
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.getByLabel('Filter checks').selectOption('all');
  await page.getByRole('button', { name: 'Source & manifest' }).click();
  await page.getByLabel('Section or table CSS selectors, one per line').fill('#missing-locale');
  await page.getByRole('button', { name: 'Freeze manifest', exact: true }).click();
  await page.getByRole('alert').waitFor();
  const offline = await browser.newPage();
  const network: string[] = [];
  offline.on('request', (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  try {
    for (const locale of locales) {
      const t = translator(locale);
      await page.getByTestId('language').selectOption(locale);
      await page.waitForFunction((value) => document.documentElement.lang === value, locale);
      assert.equal(await page.title(), t('appTitle'));
      assert.equal(await page.getByTestId('report-status').textContent(), t('statusMismatch'));
      assert.equal(
        await page.locator('.error > p').textContent(),
        t('errorNoSelector', { selector: '#missing-locale' }),
      );
      if ((await page.locator('.source-toggle').getAttribute('aria-expanded')) === 'true')
        await page.locator('.source-toggle').click();
      await page.getByLabel(t('filterChecks')).selectOption('mismatch');
      assert.equal(await page.locator('.check').count(), 6, `${locale}: unchanged check results`);
      await page.locator('.check').filter({ hasText: 'PW-042' }).click();
      assert(
        (await page.locator('.detail-content blockquote').textContent())?.includes(
          'PW-042 Север · участок 042',
        ),
      );
      assert((await page.locator('.detail-content').textContent())?.includes(t('reasonMissing')));
      for (const width of [1500, 1024, 390, 320]) {
        await page.setViewportSize({ width, height: 1050 });
        await assertLayout(page, `${locale}: report at ${width}px`);
        if (width === 1500 || width === 390)
          await page.screenshot({
            path: `artifacts/ui/locales/${locale}-report-${width}.png`,
            fullPage: true,
          });
      }
      await page.locator('.source-toggle').click();
      assert.equal(
        await page.getByLabel(t('selectors')).inputValue(),
        '#missing-locale',
        'switching does not reset form input',
      );
      for (const width of [1500, 390, 320]) {
        await page.setViewportSize({ width, height: 1050 });
        await assertLayout(page, `${locale}: setup/error at ${width}px`);
        if (width === 1500 || width === 390)
          await page.screenshot({
            path: `artifacts/ui/locales/${locale}-setup-${width}.png`,
            fullPage: true,
          });
      }
      const href = await page
        .getByRole('link', { name: t('htmlReport'), exact: true })
        .getAttribute('href');
      assert(href?.endsWith(`?lang=${locale}`));
      const response = await page.request.get(base + href);
      assert(response.ok());
      const html = await response.text();
      const path = resolve(`artifacts/ui/locales/${locale}-report.html`);
      await writeFile(path, html);
      await offline.goto(pathToFileURL(path).href);
      assert.equal(await offline.locator('html').getAttribute('lang'), locale);
      assert.equal(await offline.title(), t('reportTitle'));
      assert((await offline.locator('body').textContent())?.includes(t('reasonMissing')));
      assert.equal(await offline.locator('figure').count(), 5);
      await offline.setViewportSize({ width: 390, height: 844 });
      assert(
        await offline.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${locale}: offline report overflow`,
      );
    }
    assert.deepEqual(network, [], 'localized standalone reports make no network requests');
    const persisted = await page.context().newPage();
    await persisted.goto(base);
    assert.equal(await persisted.getByTestId('language').inputValue(), 'ru');
    await persisted.evaluate(() => localStorage.setItem('printwitness.locale', 'unsupported'));
    await persisted.reload();
    assert.equal(await persisted.getByTestId('language').inputValue(), 'en');
    await persisted.close();
    const withoutStorage = await browser.newContext();
    await withoutStorage.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('Storage unavailable');
      };
      Storage.prototype.setItem = () => {
        throw new Error('Storage unavailable');
      };
    });
    const privatePage = await withoutStorage.newPage();
    await privatePage.goto(base);
    assert.equal(await privatePage.getByTestId('language').inputValue(), 'en');
    await privatePage.getByTestId('language').selectOption('ja');
    await privatePage.waitForFunction(() => document.documentElement.lang === 'ja');
    await withoutStorage.close();
    console.log(
      'Locales: en/es/de/fr/ja/pt-BR/ru; setup, reports and errors at 1500/1024/390/320px; offline HTML exports, unchanged document text/results, persistence, invalid locale and unavailable storage passed.',
    );
  } finally {
    await offline.close();
  }
  await page.getByTestId('language').selectOption('en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  if ((await page.locator('.source-toggle').getAttribute('aria-expanded')) === 'true')
    await page.locator('.source-toggle').click();
}
