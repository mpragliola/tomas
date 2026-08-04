import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freqToX, valueToY } from 'freqplot';
import type { EqCurve } from 'freqplot';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures/tones');
const PINK_NOISE = path.join(FIXTURES, 'pink-noise.wav');
const WHITE_NOISE = path.join(FIXTURES, 'white-noise.wav');

interface SpectrumState {
  minFreq: number;
  maxFreq: number;
  curves: unknown[];
}

/**
 * Mirrors the readSpectrumState/bandById/bandPixel helpers in
 * graphic-eq-interaction.spec.ts — the graphic EQ is canvas-drawn (no DOM
 * overlay), so band state is read via the __spectrum/__store dev hooks.
 */
async function readSpectrumState(page: Page): Promise<SpectrumState> {
  return page.evaluate(() => {
    const s = (window as any).__spectrum;
    return { minFreq: s.minFreq, maxFreq: s.maxFreq.value, curves: s.curves.value };
  });
}

function eqCurveOf(state: SpectrumState): EqCurve {
  const curve = state.curves.find((c: any) => c.id === 'graphicEQ') as EqCurve | undefined;
  if (!curve) throw new Error('graphic EQ curve not present in __spectrum.curves');
  return curve;
}

async function bandById(page: Page, index: number) {
  return page.evaluate((i) => {
    const store = (window as any).__store;
    const id = store.activeReferenceId;
    return store.references[id].graphicEq.bands[i];
  }, index);
}

async function bandPixel(page: Page, state: SpectrumState, index: number) {
  const canvas = page.locator('.plot-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not visible');
  const curve = eqCurveOf(state);
  const band = curve.bands[index];
  return {
    x: box.x + freqToX(band.freq, state.minFreq, state.maxFreq, box.width),
    y: box.y + valueToY(band.gain, curve.minGain ?? -18, curve.maxGain ?? 18, box.height),
  };
}

async function expectGraphicEqReady(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const state = await readSpectrumState(page);
      return state.curves.some((c: any) => c.id === 'graphicEQ');
    })
    .toBe(true);
}

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
  await expectGraphicEqReady(page);

  // Clone the single active reference via the single-view clone button
  await page.locator('.add-reference-btn[title*="Clone"]').click();
  await expect(page.getByRole('tab')).toHaveCount(2);

  const cloneTab = page.getByRole('tab', { name: 'white-noise.wav (2)' });
  await cloneTab.click();
  await expectGraphicEqReady(page);

  // Enable a band only on the clone by dragging its handle on the canvas
  let state = await readSpectrumState(page);
  let pixel = await bandPixel(page, state, 0);
  await page.mouse.move(pixel.x, pixel.y);
  await page.mouse.down();
  await page.mouse.move(pixel.x + 30, pixel.y - 25, { steps: 10 });
  await page.mouse.up();
  expect((await bandById(page, 0)).enabled).toBe(true);

  // Switch back to the source — its corresponding band must be untouched
  const sourceTab = page.getByRole('tab', { name: 'white-noise.wav', exact: true });
  await sourceTab.click();
  await expectGraphicEqReady(page);
  expect((await bandById(page, 0)).enabled).toBe(false);
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
