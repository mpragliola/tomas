import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures/tones');
const PINK_NOISE = path.join(FIXTURES, 'pink-noise.wav');
const WHITE_NOISE = path.join(FIXTURES, 'white-noise.wav');

test.describe('graphic EQ overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles(PINK_NOISE);
    await fileInputs.nth(1).setInputFiles(WHITE_NOISE);
    await expect(page.getByText('Length')).toBeVisible();

    const eqToggle = page.locator('.btn-expand').first();
    await expect(eqToggle).toBeEnabled({ timeout: 15_000 });
    await eqToggle.click();
    await expect(page.locator('.graphic-eq-overlay')).toBeVisible();
  });

  test('renders a handle per band, initially disabled/bypassed', async ({ page }) => {
    const handles = page.locator('.eq-handle');
    await expect(handles).not.toHaveCount(0);
    await expect(handles.first()).not.toHaveClass(/eq-handle--enabled/);
  });

  test('click on a handle opens the popover with matching fields', async ({ page }) => {
    const handle = page.locator('.eq-handle').first();
    await handle.click();

    const popover = page.locator('.eq-popover');
    await expect(popover).toBeVisible();
    await expect(popover.locator('.eq-input-select')).toHaveValue('peaking');
  });

  test('popover edits update the band and its handle title', async ({ page }) => {
    const handle = page.locator('.eq-handle').first();
    await handle.click();
    const popover = page.locator('.eq-popover');
    await expect(popover).toBeVisible();

    await popover.locator('.eq-popover-enabled input[type="checkbox"]').check();
    await expect(handle).toHaveClass(/eq-handle--enabled/);

    const gainInput = popover.locator('.eq-input-number').nth(1);
    await gainInput.fill('6');
    await gainInput.dispatchEvent('change');
    await expect(handle).toHaveAttribute('title', /\+6\.0dB/);
  });

  test('choosing a gain-less filter type disables the gain field', async ({ page }) => {
    await page.locator('.eq-handle').first().click();
    const popover = page.locator('.eq-popover');
    await popover.locator('.eq-input-select').selectOption('lowpass');

    const gainInput = popover.locator('.eq-input-number').nth(1);
    await expect(gainInput).toBeDisabled();
    await expect(gainInput).toHaveAttribute('title', 'This filter type ignores gain');
  });

  test('clicking outside the popover closes it', async ({ page }) => {
    await page.locator('.eq-handle').first().click();
    await expect(page.locator('.eq-popover')).toBeVisible();

    await page.mouse.click(5, 5);
    await expect(page.locator('.eq-popover')).toBeHidden();
  });

  test('wheel over a handle adjusts Q and enables the band', async ({ page }) => {
    const handle = page.locator('.eq-handle').first();
    const titleBefore = await handle.getAttribute('title');

    await handle.hover();
    await page.mouse.wheel(0, -100);

    await expect.poll(() => handle.getAttribute('title')).not.toBe(titleBefore);
    await expect(handle).toHaveClass(/eq-handle--enabled/);
  });

  test('double-click resets a band to bypassed/default', async ({ page }) => {
    const handle = page.locator('.eq-handle').first();
    await handle.hover();
    await page.mouse.wheel(0, -100); // dirty the band first
    await expect(handle).toHaveClass(/eq-handle--enabled/);

    await handle.dblclick();
    await expect(handle).not.toHaveClass(/eq-handle--enabled/);
    await expect(handle).toHaveAttribute('title', /bypassed/);
  });

  test('drag on a handle moves it without opening the popover', async ({ page }) => {
    const handle = page.locator('.eq-handle').first();
    const box = await handle.boundingBox();
    if (!box) throw new Error('handle not visible');
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 40, startY - 20, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator('.eq-popover')).toHaveCount(0);
    await expect(handle).toHaveClass(/eq-handle--enabled/);
  });
});
