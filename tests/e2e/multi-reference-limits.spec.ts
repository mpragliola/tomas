import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures/tones');
const WHITE_NOISE = path.join(FIXTURES, 'white-noise.wav');
const MAX_REFERENCES = 8;
const LIMIT_TOAST = `You can compare up to ${MAX_REFERENCES} references at once`;

test('reference tabs cap at MAX_REFERENCES and surface a toast past the limit', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').nth(1).setInputFiles(WHITE_NOISE);

  // 1 -> 2: single-view "Add another reference" button
  await page.getByRole('button', { name: 'Add another reference' }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);

  // 2 -> 8: tab-bar add button
  const tabAddBtn = page.locator('.tab-add-btn');
  for (let count = 2; count < MAX_REFERENCES; count++) {
    await tabAddBtn.click();
    await expect(page.getByRole('tab')).toHaveCount(count + 1);
  }

  await expect(page.getByRole('tab')).toHaveCount(MAX_REFERENCES);
  await expect(tabAddBtn).toBeDisabled();
  await expect(tabAddBtn).toHaveAttribute('title', /remove one first/);

  // Cloning is also blocked at the cap
  const firstCloneBtn = page.locator('.tab-icon-btn').first();
  await expect(firstCloneBtn).toBeDisabled();
});
