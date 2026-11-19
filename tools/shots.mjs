#!/usr/bin/env node
/**
 * Real-Chrome screenshots of the lab for visual review (dev server on :5202 must be running).
 *   node tools/shots.mjs [outDir]
 * Each shot dispatches lab actions through the dev-only window.__lab hook, waits, then captures.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'test-results/shots';
fs.mkdirSync(out, { recursive: true });
const only = process.argv[3]?.split(',');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
await page.goto('http://localhost:5202/?quality=high');
await page.waitForSelector('.viewer[data-ready="true"]', { timeout: 120000 });
await page.waitForTimeout(1500);
const act = (actions) => page.evaluate((a) => { for (const x of a) window.__lab.dispatch(x); }, actions);
const reset = [{ type: 'reset' }];
const shots = {
  'block-oblique': [...reset],
  'block-labels': [...reset, { type: 'set-labels', value: true }],
  'body-front': [...reset, { type: 'set-view', view: 'body' }],
  'body-regions': [...reset, { type: 'set-view', view: 'body' }, { type: 'set-body-colour', value: 'regions' }],
  'body-dermatomes': [...reset, { type: 'set-view', view: 'body' }, { type: 'set-body-colour', value: 'dermatomes' }, { type: 'camera', preset: 'body-back' }],
  'section-x-follicle': [...reset, { type: 'set-slice', axis: 'sagittal', at: -0.5833 }],
  'section-z-thick': [...reset, { type: 'set-slice', axis: 'coronal', at: 0.2 }],
  'closeup-follicle': [...reset, { type: 'set-slice', axis: 'sagittal', at: -0.5833 }, { type: 'camera', preset: 'block-follicle' }],
  'closeup-glands': [...reset, { type: 'set-slice', axis: 'coronal', at: 0.2 }, { type: 'camera', preset: 'block-glands' }],
  'closeup-receptors': [...reset, { type: 'set-slice', axis: 'coronal', at: 0.2 }, { type: 'camera', preset: 'block-receptors' }],
  'peel-papillae': [...reset, { type: 'set-peel', value: 3 }, { type: 'camera', preset: 'block-thick' }],
  'peel-dermis': [...reset, { type: 'set-peel', value: 5 }],
  'section-axial': [...reset, { type: 'set-slice', axis: 'axial', at: 0.4 }],
};
for (const [name, actions] of Object.entries(shots)) {
  if (only && !only.includes(name)) continue;
  await act(actions);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('shot', name);
}
await browser.close();
