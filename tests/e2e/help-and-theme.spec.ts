import { test, expect } from '@playwright/test';

const THEME_ORDER = ['light', 'dark', 'sepia', 'earth', 'retro'];

test.describe('theme cycling', () => {
  test('cycles through all 5 themes and persists to localStorage', async ({ page }) => {
    await page.goto('/');
    const themeBtn = page.locator('.app-header-actions .btn-icon').first();

    const startTheme = await page.locator('html').getAttribute('data-theme');
    let idx = THEME_ORDER.indexOf(startTheme!);
    expect(idx).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < THEME_ORDER.length; i++) {
      await themeBtn.click();
      idx = (idx + 1) % THEME_ORDER.length;
      const expected = THEME_ORDER[idx];
      await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
      const stored = await page.evaluate(() => localStorage.getItem('theme'));
      expect(stored).toBe(expected);
    }
  });

  test('theme persists across reload', async ({ page }) => {
    await page.goto('/');
    const themeBtn = page.locator('.app-header-actions .btn-icon').first();
    await themeBtn.click();
    const theme = await page.locator('html').getAttribute('data-theme');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme!);
  });
});

test.describe('help modal', () => {
  test('opens, expands a chapter, and closes via the X button', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Help' }).click();

    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    const chapter = page.getByRole('button', { name: 'What is tone matching?' });
    await expect(page.locator('.chapter-body-wrap.open')).toHaveCount(0);
    await chapter.click();
    await expect(page.locator('.chapter-body-wrap.open')).toHaveCount(1);
    await chapter.click();
    await expect(page.locator('.chapter-body-wrap.open')).toHaveCount(0);

    await page.locator('.close-btn').click();
    await expect(modal).toBeHidden();
  });

  test('closes via backdrop click and via "Got it"', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Help' }).click();
    const overlay = page.locator('.modal-overlay');
    await expect(overlay).toBeVisible();

    // click the backdrop itself, not the modal content
    await overlay.click({ position: { x: 5, y: 5 } });
    await expect(overlay).toBeHidden();

    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.locator('.modal-overlay')).toBeHidden();
  });

  test('Escape does not close the modal (no focus trap / esc handling implemented)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Help' }).click();
    const overlay = page.locator('.modal-overlay');
    await expect(overlay).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(overlay).toBeVisible();

    await page.locator('.close-btn').click();
  });
});
