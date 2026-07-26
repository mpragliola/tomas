import { test } from '@playwright/test';

test('check app', async ({ page }) => {
  await page.goto('http://localhost:5174');
  await page.waitForTimeout(3000);

  const hasApp = await page.locator('#app').count() > 0;
  console.log('\n=== APP STATUS ===');
  console.log('Has #app:', hasApp);

  if (hasApp) {
    const text = await page.locator('#app').textContent();
    console.log('App text:', text);
  }

  const logs: string[] = [];
  page.on('console', (msg) => {
    console.log(`[${msg.type()}]`, msg.text());
    logs.push(msg.text());
  });

  await page.waitForTimeout(2000);
  console.log('All console logs:', logs);
});
