import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures/tones');
const PINK_NOISE = path.join(FIXTURES, 'pink-noise.wav');

test.describe('waveform editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').nth(0).setInputFiles(PINK_NOISE);
    await expect(page.locator('.source-name').first()).toBeVisible();
  });

  test('shows duration and defaults the selection to the full clip', async ({ page }) => {
    const duration = await page.locator('.duration').first().textContent();
    await expect(page.locator('.duration').first()).toContainText('s');
    // Selection starts at the full clip (0s -> duration), not empty/"drag to select"
    await expect(page.locator('.selection-info').first()).toContainText('0.00s');
    await expect(page.locator('.selection-info').first()).toContainText(duration!.replace('s', '') + 's');
  });

  test('view toggle swaps waveform for spectrogram and back', async ({ page }) => {
    const toggleBtn = page.locator('.tool-btn').first();
    await expect(toggleBtn).toHaveAttribute('title', 'Show spectrogram');

    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('title', 'Show waveform');

    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('title', 'Show spectrogram');
  });

  test('drag-select on the waveform sets a selection range', async ({ page }) => {
    const host = page.locator('.waveform-host').first();
    const box = await host.boundingBox();
    if (!box) throw new Error('waveform host not visible');

    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator('.selection-info').first()).not.toContainText('drag to select');
    await expect(page.locator('.selection-info').first()).toContainText('s –');
  });

  test('reset view clears a drag-selected range', async ({ page }) => {
    const host = page.locator('.waveform-host').first();
    const box = await host.boundingBox();
    if (!box) throw new Error('waveform host not visible');

    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('.selection-info').first()).toContainText('s –');

    await page.locator('.tool-btn[title="Reset zoom & selection"]').first().click();
    await expect(page.locator('.selection-info').first()).toContainText('drag to select');
  });

  test('Remove file clears the waveform back to the empty state', async ({ page }) => {
    await page.locator('.cancel-btn').first().click();
    // WaveformEditor's host (waver + its own empty-overlay) stays visible/mounted after a
    // clear — only its audio content resets — so waver's own Load/Record buttons stay
    // reachable for a next take. `.loaded-state` no longer goes away; Tomas's own Load
    // trigger (rendered below the waveform host, not overlaid on top of it — see
    // WaveformEditor.vue) reappearing is the actual "back to empty" signal now, scoped
    // to Wave 1's own upload area since the reference slot's auto-seeded empty tab
    // shows the identical button.
    const waveOneLoadBtn = page.locator('.upload-area').first().locator('.load-trigger-btn');
    await expect(waveOneLoadBtn).toBeVisible();
  });
});
