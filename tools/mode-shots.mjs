#!/usr/bin/env node
/**
 * Real-Chrome screenshots of every simulation mode at desktop and phone sizes (dev server on :5202).
 *   node tools/mode-shots.mjs [outDir] [name,name…]
 * Drives the lab through the dev-only window.__lab hook, waits, then captures the page.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'docs/screenshots/modes';
const only = process.argv[3]?.split(',');
fs.mkdirSync(out, { recursive: true });
const mode = (m, patch = {}) => [{ type: 'reset' }, { type: 'set-sim', patch }, { type: 'set-mode', mode: m }];
const SHOTS = {
  'temperature-office': [...mode('temperature', { tempPreset: 'office' })],
  'temperature-desert': [...mode('temperature', { tempPreset: 'desert', speed: 10 })],
  'temperature-cold': [...mode('temperature', { tempPreset: 'cold-water', speed: 10 })],
  'temperature-body': [...mode('temperature', { tempPreset: 'cold-wind', speed: 10 }), { type: 'set-view', view: 'body' }],
  'wounds-incision': [...mode('wounds', { woundType: 'incision', day: 1 })],
  'wounds-deep': [...mode('wounds', { woundType: 'deep', day: 8 })],
  'wounds-graze': [...mode('wounds', { woundType: 'graze', day: 4 })],
  'wounds-scar': [...mode('wounds', { woundType: 'deep', day: 300 })],
  'burns-block': [...mode('wounds', { woundView: 'burns', burnDepth: 'superficial-partial' })],
  'burns-full': [...mode('wounds', { woundView: 'burns', burnDepth: 'full-thickness' })],
  'burns-body': [...mode('wounds', { woundView: 'burns', burnDepth: 'deep-partial', burnRegions: 'arm-left:1,trunk-anterior:1' }), { type: 'set-view', view: 'body' }],
  'touch-receptors': [...mode('touch', { touchView: 'receptors', receptor: 'pacinian-corpuscle' })],
  'touch-vibration': [...mode('touch', { touchView: 'vibration', vibHz: 250, vibUm: 2 })],
  'touch-pressure': [...mode('touch', { touchView: 'pressure' })],
  'touch-twopoint': [...mode('touch', { touchView: 'two-point', site: 'fingertip' })],
  'touch-dermatomes': [...mode('touch', { touchView: 'dermatomes', dermatome: 'T10' })],
  'touch-thermal': [...mode('touch', { touchView: 'thermal', thermalC: 46 })],
  'life-sun': [...mode('life', { lifeView: 'sun', phototype: 'I', uvIndex: 9, sunMinutes: 60 })],
  'life-age': [...mode('life', { lifeView: 'age', age: 80, photoaged: true })],
  'life-disorders': [...mode('life', { lifeView: 'disorders', disorder: 'melanoma', lesionPreset: 'melanoma' })],
  'anatomy-labels': [{ type: 'reset' }, { type: 'set-labels', value: true }],
  'tour': [{ type: 'reset' }, { type: 'set-mode', mode: 'tour' }, { type: 'tour-go', index: 14 }],
};
const SIZES = [{ name: 'desktop', width: 1366, height: 820, touch: false }, { name: 'phone', width: 390, height: 844, touch: true }];
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, hasTouch: size.touch, isMobile: size.touch });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto('http://localhost:5202/?quality=high');
  await page.waitForSelector('.viewer[data-ready="true"]', { timeout: 120000 });
  await page.waitForTimeout(1500);
  for (const [name, actions] of Object.entries(SHOTS)) {
    if (only && !only.includes(name)) continue;
    await page.evaluate((a) => { for (const x of a) window.__lab.dispatch(x); }, actions);
    await page.waitForTimeout(name.startsWith('temperature') ? 6000 : 2500);
    await page.screenshot({ path: path.join(out, `${name}-${size.name}.png`) });
    console.log('shot', name, size.name);
  }
  await ctx.close();
}
await browser.close();
