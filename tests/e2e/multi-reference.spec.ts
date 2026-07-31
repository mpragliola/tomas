import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures/tones');
const PINK_NOISE = path.join(FIXTURES, 'pink-noise.wav');
const WHITE_NOISE = path.join(FIXTURES, 'white-noise.wav');
const SINE_1K = path.join(FIXTURES, 'sine-1k.wav');

test('multi-reference workflow: load, add, clone, download, remove, play', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon.ico')) {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto('/');

  // The page has exactly two hidden <input type="file"> elements: Wave 1 (A)'s in
  // AudioSlot, and the reference slot's shared one (used for both "Load File" and
  // "Add another reference", since both just call the same hidden input's .click()).
  const fileInputs = page.locator('input[type="file"]');
  const waveAInput = fileInputs.nth(0);
  const referenceInput = fileInputs.nth(1);

  // 1. Load Wave 1 (A)
  await waveAInput.setInputFiles(PINK_NOISE);
  await expect(page.locator('.source-name').first()).toContainText('pink-noise.wav');

  // 2. Load the first reference (Wave 2)
  await referenceInput.setInputFiles(WHITE_NOISE);

  // Confirm the IR panel populated: the "Derive IR to display" placeholder is gone and
  // metadata (e.g. "Length") is visible.
  await expect(page.getByText('Derive IR to display')).toBeHidden();
  await expect(page.getByText('Length')).toBeVisible();

  // 3. Add a 2nd reference via "Add another reference"
  await page.getByRole('button', { name: 'Add another reference' }).click();
  await referenceInput.setInputFiles(SINE_1K);

  // Confirm a tab bar renders with 2 tabs
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await expect(page.getByRole('tab', { name: 'white-noise.wav' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'sine-1k.wav' })).toBeVisible();

  // 4. Click the 2nd tab and confirm it becomes active
  const sineTab = page.getByRole('tab', { name: 'sine-1k.wav' });
  await sineTab.click();
  await expect(sineTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Derive IR to display')).toBeHidden();
  await expect(page.getByText('Length')).toBeVisible();

  // 5. Clone the active reference tab
  await sineTab.locator('.tab-icon-btn').first().click();
  await expect(tabs).toHaveCount(3);
  await expect(page.getByRole('tab', { name: 'sine-1k.wav (2)' })).toBeVisible();

  // 6. Download all IRs
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all as ZIP' }).click();
  const download = await downloadPromise;
  expect(download).toBeTruthy();

  // 7. Remove one reference tab, back down to 2
  const cloneTab = page.getByRole('tab', { name: 'sine-1k.wav (2)' });
  await cloneTab.locator('.tab-close').click();
  await expect(tabs).toHaveCount(2);

  // 8. Switch playback mode to "B" (reference) and play
  await page.locator('.ab-btn', { hasText: 'B' }).click();
  const playButton = page.locator('button.btn-play');
  await playButton.click();
  await expect(playButton).toHaveClass(/playing/);
  await expect(playButton).toContainText('Pause');

  expect(consoleErrors).toEqual([]);

  // 9. Stop playback before the test ends
  await playButton.click();
  await expect(playButton).not.toHaveClass(/playing/);
});
