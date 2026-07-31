import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures/tones');
const PINK_NOISE = path.join(FIXTURES, 'pink-noise.wav');
const WHITE_NOISE = path.join(FIXTURES, 'white-noise.wav');

test.describe('playback panel', () => {
  test('shows empty state until a wave is loaded', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Load a sound to enable playback')).toBeVisible();
  });

  test('A + IR and B stay disabled until IR/reference are ready', async ({ page }) => {
    await page.goto('/');
    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles(PINK_NOISE);

    await expect(page.getByText('Load a sound to enable playback')).toBeHidden();
    const aBtn = page.locator('.ab-btn', { hasText: 'A' }).first();
    const aIrBtn = page.locator('.ab-btn', { hasText: 'A + IR' });
    const bBtn = page.locator('.ab-btn', { hasText: 'B' });

    await expect(aBtn).toBeEnabled();
    await expect(aIrBtn).toBeDisabled();
    await expect(bBtn).toBeDisabled();

    await fileInputs.nth(1).setInputFiles(WHITE_NOISE);
    await expect(page.getByText('Length')).toBeVisible();

    await expect(aIrBtn).toBeEnabled();
    await expect(bBtn).toBeEnabled();
  });

  test('play/pause via button toggles state and label', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').nth(0).setInputFiles(PINK_NOISE);

    const playButton = page.locator('button.btn-play');
    await expect(playButton).toContainText('Play');
    await playButton.click();
    await expect(playButton).toHaveClass(/playing/);
    await expect(playButton).toContainText('Pause');

    await playButton.click();
    await expect(playButton).not.toHaveClass(/playing/);
    await expect(playButton).toContainText('Play');
  });

  test('Space bar toggles playback, but not while a form field is focused', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').nth(0).setInputFiles(PINK_NOISE);

    const playButton = page.locator('button.btn-play');
    await page.keyboard.press('Space');
    await expect(playButton).toHaveClass(/playing/);

    // focus a select field, Space must not toggle playback while typing/selecting
    await page.locator('select.input-select').first().focus();
    await page.keyboard.press('Space');
    await expect(playButton).toHaveClass(/playing/); // unchanged, still playing

    await playButton.click();
    await expect(playButton).not.toHaveClass(/playing/);
  });

  test('loop button toggles active state', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').nth(0).setInputFiles(PINK_NOISE);

    const loopButton = page.locator('button.btn-loop');
    await expect(loopButton).not.toHaveClass(/active/);
    await loopButton.click();
    await expect(loopButton).toHaveClass(/active/);
    await loopButton.click();
    await expect(loopButton).not.toHaveClass(/active/);
  });

  test('volume slider responds to mouse wheel nudges', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').nth(0).setInputFiles(PINK_NOISE);

    const slider = page.locator('.playback-content .slider[type="range"]');
    const before = await slider.inputValue();
    await slider.hover();
    await page.mouse.wheel(0, -100); // scroll up = volume nudge up
    const after = await slider.inputValue();
    expect(after).not.toBe(before);
  });
});
