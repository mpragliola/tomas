import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures/tones');
const PINK_NOISE = path.join(FIXTURES, 'pink-noise.wav');
const WHITE_NOISE = path.join(FIXTURES, 'white-noise.wav');

test.describe('impulse response panel', () => {
  test('shows placeholder until an IR is derived', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Derive IR to display')).toBeVisible();

    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles(PINK_NOISE);
    await fileInputs.nth(1).setInputFiles(WHITE_NOISE);

    await expect(page.getByText('Derive IR to display')).toBeHidden();
    await expect(page.getByText('Length')).toBeVisible();
  });

  test('download button produces a WAV file named for the chosen rate/depth', async ({ page }) => {
    await page.goto('/');
    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles(PINK_NOISE);
    await fileInputs.nth(1).setInputFiles(WHITE_NOISE);
    await expect(page.getByText('Length')).toBeVisible();

    const selects = page.locator('.ir-display .input-select');
    await selects.nth(0).selectOption('16'); // 16-bit
    await selects.nth(1).selectOption('44100'); // 44.1kHz

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/44k1/);
    expect(download.suggestedFilename()).toMatch(/16bit/);
  });

  test('JSON button copies IR data to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles(PINK_NOISE);
    await fileInputs.nth(1).setInputFiles(WHITE_NOISE);
    await expect(page.getByText('Length')).toBeVisible();

    await page.getByRole('button', { name: 'JSON' }).click();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    const parsed = JSON.parse(clipboardText);
    expect(parsed).toHaveProperty('length');
    expect(parsed).toHaveProperty('sampleRate');
    expect(parsed).toHaveProperty('coefficients');
  });

  test('"Download all as ZIP" is hidden until an IR exists, then enabled', async ({ page }) => {
    await page.goto('/');
    const zipBtn = page.getByRole('button', { name: 'Download all as ZIP' });
    await expect(zipBtn).toHaveCount(0);

    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles(PINK_NOISE);
    await fileInputs.nth(1).setInputFiles(WHITE_NOISE);
    await expect(page.getByText('Length')).toBeVisible();

    await expect(zipBtn).toBeEnabled();
  });

  test('advanced settings toggle expands extra controls once a reference exists', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Advanced Settings' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // FFT Size / Window always present
    await expect(page.locator('.advanced-settings .settings-body select').first()).toBeVisible();

    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles(PINK_NOISE);
    await fileInputs.nth(1).setInputFiles(WHITE_NOISE);
    await expect(page.getByText('Length')).toBeVisible();

    // Once a reference exists, tone-match-only fields (Filter Taps, Smoothing) appear
    await expect(page.getByText('Filter Taps')).toBeVisible();
    await expect(page.getByText('Smoothing')).toBeVisible();
  });
});
