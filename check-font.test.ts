import { test } from '@playwright/test';

test('check font sizes', async ({ page }) => {
  await page.goto('http://localhost:5178');
  await page.waitForTimeout(2000);

  const bodyFontSize = await page.evaluate(() => {
    return window.getComputedStyle(document.body).fontSize;
  });
  console.log('Body font-size:', bodyFontSize);

  const appFontSize = await page.evaluate(() => {
    const app = document.querySelector('.app');
    return window.getComputedStyle(app).fontSize;
  });
  console.log('App font-size:', appFontSize);

  const fontSizeBase = await page.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue('--font-size-base').trim();
  });
  console.log('CSS var --font-size-base:', fontSizeBase);

  const htmlStyles = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      '--font-size-base': getComputedStyle(root).getPropertyValue('--font-size-base'),
      '--font-size-sm': getComputedStyle(root).getPropertyValue('--font-size-sm'),
    };
  });
  console.log('HTML CSS variables:', htmlStyles);
});
