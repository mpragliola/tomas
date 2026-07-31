import { test, expect } from '@playwright/test';

// Runs only under the `chromium-mic` project (see playwright.config.ts), which launches
// Chromium with a fake audio input device — no real mic/OS permission dialog needed.
//
// Recording is stopped via the slot's own Stop button (`.action-button.stop`) — the
// RecordingPanel no longer renders a separate inline Stop button.

test.describe('recording panel', () => {
  test('Record on Wave 1 shows Stop, disables Record on the reference slot, and returns to idle', async ({ page }) => {
    await page.goto('/');

    const recordButtons = page.locator('.action-button.record');
    await expect(recordButtons).toHaveCount(2); // Wave 1 + reference

    await recordButtons.nth(0).click();

    const stopBtn = page.locator('.action-button.stop').first();
    await expect(stopBtn).toBeVisible();
    await expect(page.locator('.recording-hint')).toContainText('Recording');

    // The other slot's Record button must be disabled while Wave 1 is recording
    const otherRecordBtn = page.locator('.action-button.record');
    await expect(otherRecordBtn).toBeDisabled();
    await expect(otherRecordBtn).toHaveAttribute('title', 'Another slot is recording');

    await page.waitForTimeout(1500); // let the fake device produce a real take

    await stopBtn.click();
    await expect(page.locator('.action-button.stop')).toBeHidden();
    await expect(page.locator('.action-button.record').first()).toBeEnabled();
  });

  test('too-short take on Wave 1 surfaces the inline hint', async ({ page }) => {
    await page.goto('/');
    await page.locator('.action-button.record').first().click();
    const stopBtn = page.locator('.action-button.stop').first();
    await expect(stopBtn).toBeVisible();

    // Stop almost immediately — below MIN_ANALYSIS_SECONDS
    await stopBtn.click();

    await expect(page.locator('.recording-panel .status-message')).toContainText('Take too short to analyse');
  });

  test('monitor toggle activates and is disabled while recording', async ({ page }) => {
    await page.goto('/');
    const monitorBtn = page.locator('.btn-monitor');
    await expect(monitorBtn).toContainText('Monitor');
    await monitorBtn.click();
    await expect(monitorBtn).toHaveClass(/active/);
    await expect(monitorBtn).toContainText('Stop monitor');

    const stopBtn = page.locator('.action-button.stop').first();
    await page.locator('.action-button.record').first().click();
    await expect(stopBtn).toBeVisible();
    await expect(monitorBtn).toBeDisabled();

    await stopBtn.click();
  });

  test('auto-trigger checkbox reveals threshold slider and arms recording', async ({ page }) => {
    await page.goto('/');
    const checkbox = page.locator('.auto-trigger-header input[type="checkbox"]');
    await expect(page.locator('.auto-trigger-controls')).toHaveCount(0);

    await checkbox.check();
    await expect(page.locator('.auto-trigger-controls')).toBeVisible();

    const slider = page.locator('.auto-trigger-controls .slider');
    await slider.fill('-30');
    await slider.dispatchEvent('change');
    await expect(page.locator('.slider-value')).toContainText('-30dB');

    await page.locator('.action-button.record').first().click();
    await expect(page.locator('.armed-message')).toContainText('Armed — waiting for a peak above -30dB');

    await page.locator('.action-button.stop').first().click();
  });

  test('device and channel selects are disabled while recording', async ({ page }) => {
    await page.goto('/');
    const dropdowns = page.locator('.device-dropdown');
    await expect(dropdowns.nth(0)).toBeEnabled();

    const stopBtn = page.locator('.action-button.stop').first();
    await page.locator('.action-button.record').first().click();
    await expect(stopBtn).toBeVisible();
    await expect(dropdowns.nth(0)).toBeDisabled();

    await stopBtn.click();
    await expect(dropdowns.nth(0)).toBeEnabled();
  });
});
