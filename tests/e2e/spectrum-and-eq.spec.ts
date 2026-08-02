import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures/tones');
const PINK_NOISE = path.join(FIXTURES, 'pink-noise.wav');
const WHITE_NOISE = path.join(FIXTURES, 'white-noise.wav');

test.describe('spectrum viewer', () => {
  test('graphic EQ toggle stays disabled until a tone-match curve exists', async ({ page }) => {
    await page.goto('/');
    const eqToggle = page.locator('.btn-expand').first();
    await expect(eqToggle).toBeDisabled();

    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles(PINK_NOISE);
    await fileInputs.nth(1).setInputFiles(WHITE_NOISE);
    await expect(page.getByText('Length')).toBeVisible();

    await expect(eqToggle).toBeEnabled({ timeout: 15_000 });
    await eqToggle.click();
    await expect(eqToggle).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__spectrum.curves.value.some((c: any) => c.id === 'graphicEQ'))
      )
      .toBe(true);

    await eqToggle.click();
    await expect(eqToggle).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__spectrum.curves.value.some((c: any) => c.id === 'graphicEQ'))
      )
      .toBe(false);
  });

  test('expand/collapse spectrum persists across reload', async ({ page }) => {
    await page.goto('/');
    const expandBtn = page.getByLabel('Expand spectrum viewer');
    await expandBtn.click();

    const collapseBtn = page.getByLabel('Collapse spectrum viewer');
    await expect(collapseBtn).toBeVisible();
    await expect(collapseBtn).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(page.getByLabel('Collapse spectrum viewer')).toBeVisible();
  });
});
