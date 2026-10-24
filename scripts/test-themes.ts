import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import type { Browser, Page } from 'playwright';
import { locales, translator } from '../src/i18n/index.ts';
import { assertLayout } from './test-locales.ts';

const colors = { light: 'rgb(230, 228, 224)', dark: 'rgb(35, 34, 31)' };
async function expectTheme(page: Page, theme: 'light' | 'dark') {
  await page.waitForFunction(
    (color) => getComputedStyle(document.documentElement).backgroundColor === color,
    colors[theme],
  );
}

export async function testThemes(page: Page, browser: Browser, base: string) {
  await mkdir('artifacts/ui/themes', { recursive: true });
  const original = await page.locator('.detail-content blockquote').textContent();
  for (const locale of locales) {
    await page.getByTestId('language').selectOption(locale);
    const t = translator(locale);
    for (const theme of ['light', 'dark'] as const) {
      // An explicit preference must override an opposing OS setting.
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.getByLabel(t('theme'), { exact: true }).selectOption(theme);
      await expectTheme(page, theme);
      assert.equal(await page.locator('.detail-content blockquote').textContent(), original);
      assert.equal(await page.getByTestId('report-status').textContent(), t('statusMismatch'));
      assert.equal(
        await page.locator('.paper').evaluate((e) => getComputedStyle(e).backgroundColor),
        'rgb(255, 255, 255)',
      );
      assert.equal(
        await page.locator('.paper img').evaluate((e) => getComputedStyle(e).filter),
        'none',
      );
      for (const width of [1500, 1024, 390, 320]) {
        await page.setViewportSize({ width, height: 1050 });
        await assertLayout(page, `${locale}: ${theme} theme at ${width}px`);
        if ((locale === 'en' || locale === 'ja') && (width === 1500 || width === 390))
          await page.screenshot({
            path: `artifacts/ui/themes/${locale}-${theme}-${width}.png`,
            fullPage: true,
          });
      }
      await page.locator('.source-toggle').click();
      for (const width of [1500, 320]) {
        await page.setViewportSize({ width, height: 1050 });
        await assertLayout(page, `${locale}: ${theme} source form at ${width}px`);
      }
      if (locale === 'en') {
        await page.setViewportSize({ width: 1500, height: 1050 });
        await page.screenshot({
          path: `artifacts/ui/themes/en-${theme}-setup.png`,
          fullPage: true,
        });
      }
      await page.locator('.source-toggle').click();
    }
  }
  await page.getByTestId('theme').selectOption('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark');
  assert.equal(await page.getByTestId('theme').inputValue(), 'system');
  // Changing media must not replace the user's stored system preference.
  assert.equal(await page.evaluate(() => localStorage.getItem('printwitness.theme')), 'system');

  await page.getByTestId('theme').selectOption('dark');
  const persisted = await page.context().newPage();
  try {
    await persisted.emulateMedia({ colorScheme: 'light' });
    await persisted.goto(base);
    assert.equal(await persisted.getByTestId('theme').inputValue(), 'dark');
    await expectTheme(persisted, 'dark');
    await persisted.reload();
    await expectTheme(persisted, 'dark');
    await persisted.evaluate(() => localStorage.setItem('printwitness.theme', 'invalid'));
    await persisted.reload();
    assert.equal(await persisted.getByTestId('theme').inputValue(), 'system');
    await expectTheme(persisted, 'light');
    await persisted.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(persisted, 'dark');
  } finally {
    await persisted.close();
  }
  const withoutStorage = await browser.newContext({ colorScheme: 'dark' });
  try {
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
    await expectTheme(privatePage, 'dark');
    assert.equal(await privatePage.getByTestId('theme').inputValue(), 'system');
    await privatePage.getByTestId('theme').selectOption('light');
    await expectTheme(privatePage, 'light');
  } finally {
    await withoutStorage.close();
  }
  await page.getByTestId('language').selectOption('en');
  await page.getByTestId('theme').selectOption('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  console.log(
    'Themes: explicit overrides, live system changes, persistence, invalid/unavailable storage, unchanged PDF/report and all locales at desktop/mobile widths passed.',
  );
}
