import { test, expect } from '@playwright/test';

// Runs only under the `chromium-mic` project (see playwright.config.ts), which launches
// Chromium with a fake audio input device — no real mic/OS permission dialog needed.
//
// Recording is now waver's own built-in Record/Stop button (rendered in its shadow DOM),
// not a bespoke RecordingPanel — Playwright locators pierce open shadow roots automatically.

test.describe('recording via waver\'s native Record button', () => {
  test('Record on Wave 1 shows Stop, disables Record on the reference slot, and returns to idle', async ({ page }) => {
    await page.goto('/');

    const waves = page.locator('wave-r');
    await expect(waves).toHaveCount(2); // Wave 1 + reference

    const waveOneRecord = waves.nth(0).locator('[aria-label="Record"]');
    await waveOneRecord.click();

    const waveOneStop = waves.nth(0).locator('.waver-action-btn--stop');
    await expect(waveOneStop).toBeVisible();

    // The reference slot's Record button must be disabled while Wave 1 is recording
    const referenceRecord = waves.nth(1).locator('[aria-label="Record"]');
    await expect(referenceRecord).toBeDisabled();

    await page.waitForTimeout(1500); // let the fake device produce a real take

    await waveOneStop.click();
    await expect(waveOneStop).toBeHidden();
    await expect(referenceRecord).toBeEnabled();
  });

  test('recording into a reference tab does not disturb Wave 1', async ({ page }) => {
    await page.goto('/');
    const waves = page.locator('wave-r');

    const referenceRecord = waves.nth(1).locator('[aria-label="Record"]');
    await referenceRecord.click();

    const referenceStop = waves.nth(1).locator('.waver-action-btn--stop');
    await expect(referenceStop).toBeVisible();

    const waveOneRecord = waves.nth(0).locator('[aria-label="Record"]');
    await expect(waveOneRecord).toBeDisabled();

    await page.waitForTimeout(1500);
    await referenceStop.click();
    await expect(referenceStop).toBeHidden();
  });

  test('device picker is present and independent of recording state', async ({ page }) => {
    await page.goto('/');
    const dropdowns = page.locator('.device-dropdown');
    await expect(dropdowns).toHaveCount(2); // device + channel

    const waves = page.locator('wave-r');
    await waves.nth(0).locator('[aria-label="Record"]').click();
    await expect(waves.nth(0).locator('.waver-action-btn--stop')).toBeVisible();

    // Unlike the old panel, the picker is not disabled by an in-progress recording.
    await expect(dropdowns.nth(0)).toBeEnabled();

    await waves.nth(0).locator('.waver-action-btn--stop').click();
  });
});
