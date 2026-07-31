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

  test('zoom slider changes value on input', async ({ page }) => {
    const slider = page.locator('.zoom-slider').first();
    const before = await slider.inputValue();
    await slider.fill('5');
    await slider.dispatchEvent('input');
    const after = await slider.inputValue();
    expect(after).not.toBe(before);
    expect(after).toBe('5');
  });

  test('view toggle swaps waveform for spectrogram and back', async ({ page }) => {
    const toggleBtn = page.locator('.tool-btn').first();
    await expect(toggleBtn).toHaveAttribute('title', 'Show spectrogram');
    await expect(page.locator('.waveform-minimap-group').first()).not.toHaveClass(/view-hidden/);

    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('title', 'Show waveform');
    await expect(page.locator('.waveform-minimap-group').first()).toHaveClass(/view-hidden/);
    await expect(page.locator('.spectrogram-container').first()).not.toHaveClass(/view-hidden/);

    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('title', 'Show spectrogram');
    await expect(page.locator('.waveform-minimap-group').first()).not.toHaveClass(/view-hidden/);
  });

  test('reset view restores default zoom after zooming in', async ({ page }) => {
    const slider = page.locator('.zoom-slider').first();
    await slider.fill('10');
    await slider.dispatchEvent('input');
    expect(await slider.inputValue()).toBe('10');

    const resetBtn = page.locator('.tool-btn[title="Reset zoom & selection"]').first();
    await resetBtn.click();
    await expect.poll(() => slider.inputValue()).not.toBe('10');
  });

  test('drag-select on the waveform sets a selection range', async ({ page }) => {
    const container = page.locator('.waveform-container').first();
    const box = await container.boundingBox();
    if (!box) throw new Error('waveform container not visible');

    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator('.selection-info').first()).not.toContainText('drag to select');
    await expect(page.locator('.selection-info').first()).toContainText('s –');
  });

  test('Remove file clears the waveform back to the empty state', async ({ page }) => {
    await page.locator('.cancel-btn').first().click();
    await expect(page.locator('.loaded-state')).toBeHidden();
    await expect(page.getByText('Load File').first()).toBeVisible();
  });
});
