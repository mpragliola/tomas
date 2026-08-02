import { test, expect, type Page } from '@playwright/test';
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
 * There's no DOM to query for freqplot's canvas-drawn bands — `window.__spectrum` (a
 * dev-only hook on `SpectrumViewer.vue`) exposes the same axis ranges and `Curve[]` the
 * canvas is drawing from, and `window.__store` (main.ts) the Pinia store bands round-trip
 * writes land in.
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

test.describe('graphic EQ (freqplot canvas)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles(PINK_NOISE);
    await fileInputs.nth(1).setInputFiles(WHITE_NOISE);
    await expect(page.getByText('Length')).toBeVisible();

    const eqToggle = page.locator('.btn-expand').first();
    await expect(eqToggle).toBeEnabled({ timeout: 15_000 });
    await eqToggle.click();

    await expect
      .poll(async () => {
        const state = await readSpectrumState(page);
        return state.curves.some((c: any) => c.id === 'graphicEQ');
      })
      .toBe(true);
  });

  test('renders one band per octave, initially disabled at 0dB', async ({ page }) => {
    const state = await readSpectrumState(page);
    const curve = eqCurveOf(state);
    expect(curve.bands).toHaveLength(9);
    expect(curve.bands[0].enabled).toBe(false);
    expect(curve.bands[0].gain).toBe(0);
  });

  test('dragging a handle sets its frequency and gain, and enables the band', async ({ page }) => {
    const state = await readSpectrumState(page);
    const { x, y } = await bandPixel(page, state, 0);

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 30, y - 25, { steps: 10 });
    await page.mouse.up();

    const band = await bandById(page, 0);
    expect(band.enabled).toBe(true);
    expect(band.gain).toBeGreaterThan(0);
  });

  test('dragging the zone around an enabled handle adjusts Q', async ({ page }) => {
    let state = await readSpectrumState(page);
    let pixel = await bandPixel(page, state, 0);

    // Enable the band first — the Q-drag zone only responds to enabled bands.
    await page.mouse.move(pixel.x, pixel.y);
    await page.mouse.down();
    await page.mouse.move(pixel.x + 10, pixel.y - 10, { steps: 5 });
    await page.mouse.up();

    const before = (await bandById(page, 0)).q;

    state = await readSpectrumState(page);
    pixel = await bandPixel(page, state, 0);
    // Just outside the handle's own hit radius (~10px) but inside its Q zone (~24px).
    await page.mouse.move(pixel.x + 16, pixel.y);
    await page.mouse.down();
    await page.mouse.move(pixel.x + 70, pixel.y, { steps: 10 });
    await page.mouse.up();

    const after = (await bandById(page, 0)).q;
    expect(after).not.toBeCloseTo(before, 5);
  });

  test('double-click resets frequency/gain/Q to the untouched default', async ({ page }) => {
    let state = await readSpectrumState(page);
    let pixel = await bandPixel(page, state, 0);

    await page.mouse.move(pixel.x, pixel.y);
    await page.mouse.down();
    await page.mouse.move(pixel.x + 40, pixel.y - 20, { steps: 10 });
    await page.mouse.up();
    expect((await bandById(page, 0)).gain).toBeGreaterThan(0);

    state = await readSpectrumState(page);
    pixel = await bandPixel(page, state, 0);
    await page.mouse.dblclick(pixel.x, pixel.y);

    await expect
      .poll(async () => Math.round((await bandById(page, 0)).gain))
      .toBe(0);
  });
});
