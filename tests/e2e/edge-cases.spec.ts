import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures/tones');
const PINK_NOISE = path.join(FIXTURES, 'pink-noise.wav');
const WHITE_NOISE = path.join(FIXTURES, 'white-noise.wav');

test('oversized file (>100MB) is rejected with the size in the message', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');

  // Playwright caps in-memory setInputFiles buffers at 50MB, so a 101MB fixture
  // (content irrelevant — only size is checked) has to be written to disk first.
  const hugePath = path.join(os.tmpdir(), 'tomas-e2e-huge.wav');
  fs.writeFileSync(hugePath, Buffer.alloc(101 * 1024 * 1024));
  try {
    await page.locator('input[type="file"]').nth(0).setInputFiles(hugePath);
    await expect(page.locator('.status-message').first()).toContainText('File too large', { timeout: 30_000 });
    await expect(page.locator('.status-message').first()).toContainText('Max 100MB');
  } finally {
    fs.unlinkSync(hugePath);
  }
});

test('editing a band after cloning does not affect the source reference', async ({ page }) => {
  await page.goto('/');
  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.nth(0).setInputFiles(PINK_NOISE);
  await fileInputs.nth(1).setInputFiles(WHITE_NOISE);
  await expect(page.getByText('Length')).toBeVisible();

  const eqToggle = page.locator('.btn-expand').first();
  await expect(eqToggle).toBeEnabled({ timeout: 15_000 });
  await eqToggle.click();
  await expect(page.locator('.graphic-eq-overlay')).toBeVisible();

  // Clone the single active reference via the single-view clone button
  await page.locator('.add-reference-btn[title*="Clone"]').click();
  await expect(page.getByRole('tab')).toHaveCount(2);

  const cloneTab = page.getByRole('tab', { name: 'white-noise.wav (2)' });
  await cloneTab.click();
  await expect(page.locator('.graphic-eq-overlay')).toBeVisible();

  // Enable a band only on the clone (wheel-adjust dirties + enables it)
  const cloneHandle = page.locator('.eq-handle').first();
  await cloneHandle.hover();
  await page.mouse.wheel(0, -100);
  await expect(cloneHandle).toHaveClass(/eq-handle--enabled/);

  // Switch back to the source — its corresponding band must be untouched
  const sourceTab = page.getByRole('tab', { name: 'white-noise.wav', exact: true });
  await sourceTab.click();
  await expect(page.locator('.graphic-eq-overlay')).toBeVisible();
  const sourceHandle = page.locator('.eq-handle').first();
  await expect(sourceHandle).not.toHaveClass(/eq-handle--enabled/);
});

test('narrow viewport does not break the app or spam console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon.ico')) consoleErrors.push(msg.text());
  });

  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Help' })).toBeVisible();
  await page.locator('input[type="file"]').nth(0).setInputFiles(PINK_NOISE);
  await expect(page.locator('.source-name').first()).toContainText('pink-noise.wav');

  expect(consoleErrors).toEqual([]);
});
