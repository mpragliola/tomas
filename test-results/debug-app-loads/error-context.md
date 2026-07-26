# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: debug.test.ts >> app loads
- Location: debug.test.ts:3:1

# Error details

```
Error: locator.textContent: Error: strict mode violation: locator('#app') resolved to 2 elements:
    1) <div id="app" data-v-app="">…</div> aka locator('#app').first()
    2) <div id="app">…</div> aka getByText('Debug: Import TestVue: ✓')

Call log:
  - waiting for locator('#app')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - 'heading "Debug: Import Test" [level=1] [ref=e4]'
  - paragraph [ref=e5]: "Vue: ✓"
  - paragraph [ref=e6]: "Logger: true"
  - paragraph [ref=e7]: "Store: true"
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test('app loads', async ({ page }) => {
  4  |   await page.goto('http://localhost:5174');
  5  | 
  6  |   // Check for errors
  7  |   const errors: string[] = [];
  8  |   page.on('console', (msg) => {
  9  |     if (msg.type() === 'error') {
  10 |       errors.push(msg.text());
  11 |       console.log('ERROR:', msg.text());
  12 |     }
  13 |   });
  14 | 
  15 |   // Wait and check content
  16 |   await page.waitForTimeout(2000);
  17 | 
  18 |   const content = await page.content();
  19 |   console.log('Page HTML:', content.substring(0, 500));
  20 | 
  21 |   const hasApp = await page.locator('#app').count() > 0;
  22 |   console.log('Has #app:', hasApp);
  23 | 
  24 |   if (hasApp) {
> 25 |     const text = await page.locator('#app').textContent();
     |                                             ^ Error: locator.textContent: Error: strict mode violation: locator('#app') resolved to 2 elements:
  26 |     console.log('App text:', text);
  27 |   }
  28 | 
  29 |   expect(hasApp).toBe(true);
  30 | });
  31 | 
```