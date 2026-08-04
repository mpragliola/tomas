import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures/tones');
const SINE_1K = path.join(FIXTURES, 'sine-1k.wav');

function fileInputs(page: import('@playwright/test').Page) {
  const inputs = page.locator('input[type="file"]');
  return { waveA: inputs.nth(0), reference: inputs.nth(1) };
}

test.describe('file upload validation', () => {
  test('rejects unsupported extension with inline status message', async ({ page }) => {
    await page.goto('/');
    const { waveA } = fileInputs(page);

    await waveA.setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not audio'),
    });

    await expect(page.locator('.status-message').first()).toContainText('Invalid file type');
    // no filename should have been accepted onto Wave 1 specifically — scoped to that
    // slot's `.section` because the reference slot always has a `.source-name` now (its
    // own tab auto-seeds empty, so ReferenceSlot's single-reference view renders one for
    // the placeholder tab's "Empty reference" label, unrelated to this rejected file)
    await expect(page.locator('.section').first().locator('.source-name')).toHaveCount(0);
  });

  test('rejects empty file with "File is empty"', async ({ page }) => {
    await page.goto('/');
    const { waveA } = fileInputs(page);

    await waveA.setInputFiles({
      name: 'empty.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.alloc(0),
    });

    await expect(page.locator('.status-message').first()).toContainText('File is empty');
  });

  test('status message auto-clears after a few seconds', async ({ page }) => {
    await page.goto('/');
    const { waveA } = fileInputs(page);

    await waveA.setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not audio'),
    });

    await expect(page.locator('.status-message').first()).toBeVisible();
    await expect(page.locator('.status-message').first()).toBeHidden({ timeout: 5000 });
  });

  test('dropping a non-audio file is silently ignored (no toast, no status)', async ({ page }) => {
    await page.goto('/');

    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      const file = new File(['plain text'], 'readme.txt', { type: 'text/plain' });
      dt.items.add(file);
      return dt;
    });

    await page.locator('.upload-area').first().dispatchEvent('drop', { dataTransfer });

    await page.waitForTimeout(500);
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(page.locator('.status-message')).toHaveCount(0);
  });

  test('load then remove clears the source name', async ({ page }) => {
    await page.goto('/');
    const { waveA } = fileInputs(page);

    await waveA.setInputFiles(SINE_1K);
    await expect(page.locator('.source-name').first()).toContainText('sine-1k.wav');

    await page.locator('.cancel-btn').first().click();
    // Scoped to Wave 1's own .section — the reference slot's auto-seeded empty tab keeps
    // its own `.source-name` ("Empty reference") up throughout, unrelated to A's file.
    await expect(page.locator('.section').first().locator('.source-name')).toHaveCount(0);
    await expect(page.getByText('Load File').first()).toBeVisible();
  });
});
