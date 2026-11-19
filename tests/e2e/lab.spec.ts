import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'docs/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

async function open(page: Page, query = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`/${query}`);
  return errors;
}
async function ready(page: Page) {
  await expect(page.locator('.viewer[data-ready="true"]')).toBeVisible({ timeout: 90_000 });
  await settle(page);
}
/** Waits until the canvas has rendered two more frames (software WebGL can be slow to compile shaders). */
async function settle(page: Page, ms = 1000) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(ms);
}
const detailTitle = (page: Page) => page.locator('#detail-title');
const listButton = (page: Page, name: string | RegExp) => page.locator('.struct-list button', { hasText: name });
const radio = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });
const mode = (page: Page, name: string) => page.locator('nav[aria-label="Mode"] button', { hasText: new RegExp(`^${name}$`) }).click();
const cameraButton = (page: Page, name: string) => page.locator('[aria-label="Camera views"] button', { hasText: new RegExp(`^${name}$`) });
const scene = (page: Page, name: 'Skin block' | 'Body') => page.locator('[aria-label="Scene"] button', { hasText: name }).click();
const num = async (page: Page, sel: string, attr: string) => Number(await page.locator(sel).first().getAttribute(attr));
const canvasCentre = async (page: Page, dx = 0, dy = 0) => {
  const b = (await page.locator('.viewer canvas').boundingBox())!;
  // The free area between the side panels (left ≈ 300 px; right ≈ 370 px when a sheet is open).
  const right = (await page.locator('aside.right').count()) ? 370 : 0;
  return { x: b.x + 300 + (b.width - 300 - right) / 2 + dx, y: b.y + b.height / 2 + dy };
};

test('loads the skin without console errors and with a clean main screen @smoke', async ({ page }) => {
  const errors = await open(page);
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Human Skin', level: 1 })).toBeVisible();
  await expect(page.locator('aside.right')).toHaveCount(0);
  await expect(radio(page, 'Real')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.viewer')).toHaveAttribute('data-view', 'block');
  await page.screenshot({ path: `${SHOTS}/01-initial.png` });
  expect(errors).toEqual([]);
});

test('clicking the block selects the structure under the pointer', async ({ page }) => {
  await open(page);
  await ready(page);
  const c = await canvasCentre(page, 0, 40);
  await page.mouse.click(c.x, c.y);
  await expect(detailTitle(page)).toHaveText(/./);
  await expect(page.locator('aside.right')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-selected.png` });
});

test('search finds structures by name and synonym', async ({ page }) => {
  await open(page);
  await ready(page);
  const search = page.getByLabel('Search structures');
  await search.fill('goosebumps');
  await search.press('Enter');
  await expect(detailTitle(page)).toHaveText('Arrector pili');
  await search.fill('RA II');
  await expect(page.locator('.search-results')).toContainText('Pacinian corpuscles');
  await search.fill('zzzz');
  await expect(page.getByText('No structure matches')).toBeVisible();
});

test('a group lists its parts; colour by layer; layers hide structures', async ({ page }) => {
  await open(page);
  await ready(page);
  await listButton(page, /^Epidermis$/).first().click();
  await expect(detailTitle(page)).toHaveText('Epidermis');
  await expect(page.locator('aside.right')).toContainText('parts');
  await page.keyboard.press('Escape');
  const canvas = page.locator('.viewer canvas');
  const real = await canvas.screenshot();
  await radio(page, 'Layers').click();
  await settle(page);
  expect(Buffer.compare(real, await canvas.screenshot())).not.toBe(0);
  await radio(page, 'Real').click();
  await expect(listButton(page, /^Subcutaneous fat/).locator('.tag')).toHaveCount(0);
  await page.getByLabel('Hypodermis', { exact: true }).uncheck();
  await expect(listButton(page, /^Subcutaneous fat/).locator('.tag')).toHaveText('hidden');
});

test('peel, cut and labels', async ({ page }) => {
  const errors = await open(page);
  await ready(page);
  await page.getByLabel('Peel layers off the top').fill('3');
  await expect(page.locator('.peel-hint')).toContainText('whole epidermis');
  await page.getByLabel('Peel layers off the top').fill('0');
  await radio(page, 'Across').click();
  await expect(cameraButton(page, 'Front section')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.slice-hint')).toHaveText('Showing the back part');
  await radio(page, 'Off').click();
  await page.getByLabel('Labels').check();
  await page.getByRole('button', { name: 'Fit' }).click();
  await settle(page, 1800);
  const shown = page.locator('.scene-label[data-state="shown"]');
  expect(await shown.count()).toBeGreaterThanOrEqual(3);
  const boxes = await shown.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, b] = [boxes[i]!, boxes[j]!];
    expect(!(a[2]! <= b[0]! || b[2]! <= a[0]! || a[3]! <= b[1]! || b[3]! <= a[1]!), `labels ${i} and ${j} overlap`).toBe(false);
  }
  // The deep fascia is labelled on its own (visible) face, below the fat.
  const fascia = page.locator('.scene-label[data-structure="deep-fascia"]');
  const fat = page.locator('.scene-label[data-structure="subcutaneous-fat"]');
  if ((await fascia.getAttribute('data-state')) === 'shown' && (await fat.getAttribute('data-state')) === 'shown') {
    expect((await fascia.boundingBox())!.y).toBeGreaterThan((await fat.boundingBox())!.y);
  }
  await page.screenshot({ path: `${SHOTS}/03-labels.png` });
  expect(errors).toEqual([]);
});

test('body and block: switch scenes, colour the body, and open the block from a region', async ({ page }) => {
  const errors = await open(page);
  await ready(page);
  await scene(page, 'Body');
  await expect(page.locator('.viewer')).toHaveAttribute('data-view', 'body');
  await radio(page, 'Regions').click();
  await expect(page.locator('.body-legend')).toContainText('Rule of nines');
  await settle(page, 1200);
  await page.screenshot({ path: `${SHOTS}/04-body-regions.png` });
  await radio(page, 'Skin').click();
  const c = await canvasCentre(page, 0, -60);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('.viewer')).toHaveAttribute('data-view', 'block');
  expect(errors).toEqual([]);
});

test('Temperature: presets drive the heat balance; time runs; the block shows the effectors', async ({ page }) => {
  test.slow();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Temperature');
  const panel = page.locator('.temperature-panel');
  await expect(panel).toBeVisible();
  await expect.poll(() => num(page, '[data-time]', 'data-time'), { timeout: 15_000 }).toBeGreaterThan(1);
  const canvas = page.locator('.viewer canvas');
  await settle(page, 800);
  const a = await canvas.screenshot();
  await page.waitForTimeout(500);
  expect(Buffer.compare(a, await canvas.screenshot()), 'the scene animates').not.toBe(0);

  await panel.getByRole('button', { name: 'Cold water' }).click();
  await panel.getByRole('radio', { name: '10 min/s' }).click();
  await expect.poll(() => num(page, '[data-skin]', 'data-skin'), { timeout: 30_000 }).toBeLessThan(26);
  await expect.poll(() => num(page, '[data-shiver]', 'data-shiver'), { timeout: 30_000 }).toBeGreaterThan(20);
  expect(await num(page, '[data-skbf]', 'data-skbf')).toBeLessThan(0.1);
  await page.screenshot({ path: `${SHOTS}/05-temperature-cold.png` });

  await panel.getByRole('button', { name: 'Hot humid' }).click();
  await expect.poll(() => num(page, '[data-sweat]', 'data-sweat'), { timeout: 30_000 }).toBeGreaterThan(0.2);
  await expect(panel.locator('[data-wetbulb]')).toHaveAttribute('data-wetbulb', 'danger');
  await expect.poll(() => num(page, '[data-skbf]', 'data-skbf'), { timeout: 30_000 }).toBeGreaterThan(1);
  // Manual conditions; the body view paints skin temperature.
  await page.getByLabel('Air temperature', { exact: true }).fill('40');
  await expect(panel.getByRole('button', { name: 'Hot humid' })).toHaveAttribute('aria-pressed', 'false');
  await scene(page, 'Body');
  await expect(page.locator('.thermal-legend')).toBeVisible();
  await settle(page, 1500);
  await page.screenshot({ path: `${SHOTS}/06-temperature-body.png` });
  expect(errors).toEqual([]);
});

test('Wounds: the day moves through the phases; strength and closure follow; factors delay', async ({ page }) => {
  test.slow();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Wounds');
  const panel = page.locator('.wounds-panel');
  await expect(cameraButton(page, 'Wound')).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('radio', { name: 'Deep wound' }).click();
  await panel.getByRole('button', { name: '1 h', exact: true }).click();
  await expect(panel.locator('[data-phase]')).toHaveAttribute('data-phase', /haemostasis|inflammation/);
  await expect(panel.locator('[data-stage]')).toHaveAttribute('data-stage', 'clot');
  await expect(page.locator('.point-label[data-point="wound"]')).toHaveText('Clot');
  await panel.getByRole('button', { name: '3 wk', exact: true }).click();
  await expect(panel.locator('[data-phase]')).toHaveAttribute('data-phase', 'proliferation');
  await settle(page, 1200);
  await page.screenshot({ path: `${SHOTS}/07-wound-deep.png` });
  await panel.getByRole('button', { name: '1 yr', exact: true }).click();
  await expect(panel.locator('[data-phase]')).toHaveAttribute('data-phase', 'remodelling');
  await expect(panel.locator('[data-stage]')).toHaveAttribute('data-stage', 'scar');
  expect(await num(page, '.wounds-panel [data-strength]', 'data-strength')).toBeGreaterThan(60);
  // A sutured incision closes within two days; diabetes and infection slow it.
  await panel.getByRole('radio', { name: 'Sutured incision' }).click();
  await panel.getByRole('button', { name: '1 d', exact: true }).click();
  const closed = await num(page, '.wounds-panel [data-closure]', 'data-closure');
  await panel.locator('summary', { hasText: 'Factors that slow healing' }).click();
  await panel.getByLabel('Diabetes mellitus').check();
  await panel.getByLabel('Infection').check();
  await expect.poll(() => num(page, '.wounds-panel [data-closure]', 'data-closure')).toBeLessThan(closed);
  // The slider moves the day.
  await page.getByLabel('Time since injury').fill('600');
  await expect.poll(() => num(page, '.wounds-panel [data-day]', 'data-day')).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('Burns: depth in the block, %TBSA by tapping body regions and palms, Parkland', async ({ page }) => {
  test.slow();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Wounds');
  const panel = page.locator('.wounds-panel');
  await panel.getByRole('radio', { name: 'Burns' }).click();
  await expect(cameraButton(page, 'Burn')).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('radio', { name: 'Full' }).click();
  await expect(panel.locator('.burn-card')).toHaveAttribute('data-depth', 'full-thickness');
  await expect(page.locator('.point-label[data-point="burn"]')).toContainText('whole dermis');
  // Clicking a layer of the block sets the depth from the deepest layer reached (here the dermis or fat).
  await panel.getByRole('radio', { name: 'Superficial' }).click();
  const c = await canvasCentre(page, 0, 60);
  await page.mouse.click(c.x, c.y);
  await expect(panel.locator('.burn-card')).toHaveAttribute('data-depth', /deep-partial|full-thickness|superficial-partial/);
  await panel.getByRole('radio', { name: 'Deep partial' }).click();
  await settle(page, 1200);
  await page.screenshot({ path: `${SHOTS}/08-burn-block.png` });

  await panel.getByRole('button', { name: /Map the burn on the body/ }).click();
  await expect(page.locator('.viewer')).toHaveAttribute('data-view', 'body');
  await settle(page, 1500);
  // Tap the chest: the anterior trunk (18 %).
  const chest = await canvasCentre(page, 0, -110);
  await page.mouse.click(chest.x, chest.y);
  await expect(panel.locator('[data-tbsa]')).toHaveAttribute('data-tbsa', '18.0');
  await panel.locator('[data-region="arm-left"]').click();
  await expect(panel.locator('[data-tbsa]')).toHaveAttribute('data-tbsa', '27.0');
  // Palm-sized patches add 1 % each.
  await panel.getByRole('radio', { name: 'Palm patches (1 %)' }).click();
  const thigh = await canvasCentre(page, -25, 140);
  await page.mouse.click(thigh.x, thigh.y);
  await expect(panel.locator('[data-palms]')).toHaveAttribute('data-palms', '1');
  await expect(panel.locator('[data-tbsa]')).toHaveAttribute('data-tbsa', '28.0');
  // Parkland: 4 × 70 kg × 28 % = 7840 mL.
  await expect(panel.locator('[data-parkland]')).toHaveAttribute('data-parkland', '7840');
  await page.getByLabel('Body weight').fill('50');
  await expect(panel.locator('[data-parkland]')).toHaveAttribute('data-parkland', '5600');
  // A child's chart: the head counts more.
  await panel.getByRole('radio', { name: 'Child nines' }).click();
  await expect(panel.locator('[data-region="head-neck"]')).toContainText('18 %');
  await settle(page, 800);
  await page.screenshot({ path: `${SHOTS}/09-burn-body.png` });
  expect(errors).toEqual([]);
});

test('Touch: receptors, vibration tuning, pressure rasters, thermal sensation and pain timing', async ({ page }) => {
  test.slow();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Touch');
  const panel = page.locator('.touch-panel');
  await panel.locator('.receptor-pick').getByRole('radio', { name: 'Merkel' }).click();
  await expect(panel.locator('.receptor-card')).toHaveAttribute('data-receptor', 'merkel-discs');
  await expect(panel.locator('.receptor-card')).toContainText('SA1');
  await panel.locator('.sub-tabs').getByRole('radio', { name: 'Vibration' }).click();
  await panel.getByRole('button', { name: '250 Hz buzz' }).click();
  await expect(panel.locator('[data-best]')).toHaveAttribute('data-best', 'pacinian-corpuscle');
  await panel.getByRole('button', { name: '30 Hz flutter' }).click();
  await expect(panel.locator('[data-best]')).toHaveAttribute('data-best', 'meissner-corpuscle');
  expect(Number(await panel.locator('[data-response="meissner-corpuscle"]').getAttribute('data-value'))).toBeGreaterThan(0.5);
  await page.getByLabel('Frequency', { exact: true }).fill('900');
  await expect(panel.locator('[data-best]')).toHaveAttribute('data-best', 'pacinian-corpuscle');
  await settle(page, 800);
  await page.screenshot({ path: `${SHOTS}/10-touch-vibration.png` });

  await panel.locator('.sub-tabs').getByRole('radio', { name: 'Pressure' }).click();
  await panel.getByRole('button', { name: 'Press the probe' }).click();
  expect(await num(page, '[data-raster="merkel-discs"]', 'data-spikes')).toBeGreaterThan(await num(page, '[data-raster="pacinian-corpuscle"]', 'data-spikes'));

  await panel.locator('.sub-tabs').getByRole('radio', { name: 'Heat & pain' }).click();
  await page.getByLabel('Probe temperature').fill('47');
  await expect(panel.locator('[data-sensation]')).toHaveAttribute('data-sensation', 'heat-pain');
  await page.getByLabel('Probe temperature').fill('20');
  await expect(panel.locator('[data-sensation]')).toHaveAttribute('data-sensation', 'cold');
  await expect(panel.locator('[data-first]')).toHaveAttribute('data-first', '50');
  await expect(panel.locator('[data-second]')).toHaveAttribute('data-second', '1000');
  await panel.getByRole('button', { name: /Stub a toe/ }).click();
  expect(errors).toEqual([]);
});

test('Touch on the body: the two-point game and the dermatome map', async ({ page }) => {
  test.slow();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Touch');
  const panel = page.locator('.touch-panel');
  await panel.locator('.sub-tabs').getByRole('radio', { name: 'Two-point' }).click();
  await expect(page.locator('.viewer')).toHaveAttribute('data-view', 'body');
  await expect(page.locator('.point-label[data-point="site"]')).toContainText('fingertip');
  await page.getByLabel('Site', { exact: true }).selectOption('back');
  await expect(panel.locator('[data-threshold]')).toHaveAttribute('data-threshold', '40');
  await page.getByLabel('Gap between the points').fill('10');
  await expect.poll(async () => Number(await panel.locator('[data-p]').getAttribute('data-p'))).toBeLessThan(0.05);
  await panel.getByRole('button', { name: 'Touch', exact: true }).click();
  await expect(panel.locator('.trial-result')).toHaveAttribute('data-two', 'false');
  await page.getByLabel('Gap between the points').fill('60');
  await panel.getByRole('button', { name: 'Touch', exact: true }).click();
  await expect(panel.locator('.trial-result')).toHaveAttribute('data-two', 'true');
  await settle(page, 1500);
  await page.screenshot({ path: `${SHOTS}/11-two-point.png` });

  await panel.locator('.sub-tabs').getByRole('radio', { name: 'Dermatomes' }).click();
  await page.getByLabel('Landmark').selectOption('umbilicus');
  await expect(panel.locator('.dermatome-card')).toHaveAttribute('data-dermatome', 'T10');
  // Tapping the body names the dermatome there.
  const c = await canvasCentre(page, 0, -60);
  await page.mouse.click(c.x, c.y);
  await expect(panel.locator('.dermatome-card')).toHaveAttribute('data-dermatome', /^T/);
  await settle(page, 800);
  await page.screenshot({ path: `${SHOTS}/12-dermatomes.png` });
  expect(errors).toEqual([]);
});

test('Life: sunburn by phototype and SPF, vitamin D, ageing, disorders and the ABCDE check', async ({ page }) => {
  test.slow();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Life');
  const panel = page.locator('.life-panel');
  await panel.locator('.phototypes').getByRole('radio', { name: /I$/ }).first().click();
  await page.getByLabel('UV index').fill('10');
  await page.getByLabel('Time in the sun').fill('60');
  await expect(panel.locator('[data-grade]')).toHaveAttribute('data-grade', 'severe-blistering');
  await panel.getByRole('radio', { name: 'SPF 30' }).click();
  await expect(panel.locator('[data-grade]')).toHaveAttribute('data-grade', 'none');
  await page.getByLabel('Latitude').fill('52');
  await page.getByLabel('Month').fill('12');
  await expect(panel.locator('[data-season]')).toHaveAttribute('data-season', 'negligible');
  await settle(page, 800);
  await page.screenshot({ path: `${SHOTS}/13-life-sun.png` });

  await panel.locator('.sub-tabs').getByRole('radio', { name: 'Ageing' }).click();
  await page.getByLabel('Age', { exact: true }).fill('80');
  await expect(panel.locator('[data-collagen]')).toHaveAttribute('data-collagen', '0.40');
  await settle(page, 800);
  await page.screenshot({ path: `${SHOTS}/14-life-age.png` });

  await panel.locator('.sub-tabs').getByRole('radio', { name: 'Disorders' }).click();
  await panel.locator('.disorder-pick').getByRole('radio', { name: 'Psoriasis' }).click();
  await expect(panel.locator('.disorder-card')).toHaveAttribute('data-disorder', 'psoriasis');
  await expect(panel.locator('.abcde')).toHaveAttribute('data-concern', 'low');
  await page.getByLabel('D · Diameter').fill('9');
  await expect(panel.locator('.abcde')).toHaveAttribute('data-concern', 'moderate');
  await panel.getByRole('button', { name: 'Show a melanoma' }).click();
  await expect(panel.locator('.abcde')).toHaveAttribute('data-concern', 'high');
  await expect(panel.locator('.abcde')).toHaveAttribute('data-count', '5');
  await settle(page, 800);
  await page.screenshot({ path: `${SHOTS}/15-life-abcde.png` });
  expect(errors).toEqual([]);
});

test('guided tour drives the modes, navigates, lets you try a step, and finishes', async ({ page }) => {
  test.slow();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Guided tour');
  await expect(page.getByText(/step 1 of 22/)).toBeVisible();
  await expect(page.locator('#tour-title')).toHaveText('The largest organ');
  await page.getByRole('button', { name: 'Next →' }).click();
  await expect(page.locator('#tour-title')).toHaveText('A block of skin');
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByText(/step 1 of 22/)).toBeVisible();
  await page.locator('.tour-index button', { hasText: 'Cold water' }).click();
  await expect(page.locator('.mode-tag')).toContainText('Temperature · Cold water');
  await settle(page, 2000);
  await page.screenshot({ path: `${SHOTS}/16-tour-cold.png` });
  await page.locator('.tour-index button', { hasText: 'Rule of nines' }).click();
  await expect(page.locator('.viewer')).toHaveAttribute('data-view', 'body');
  await page.locator('.tour-index button', { hasText: 'Cold water' }).click();
  await page.getByRole('button', { name: 'Try it yourself →' }).click();
  await expect(page.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.temperature-panel').getByRole('button', { name: 'Cold water' })).toHaveAttribute('aria-pressed', 'true');
  await mode(page, 'Guided tour');
  await page.locator('.tour-index button').last().click();
  await expect(page.getByText(/step 22 of 22/)).toBeVisible();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('button', { name: 'Anatomy' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('phone layout: structures open from the dock and details follow a pick @smoke', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await ready(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator('aside.left')).toBeHidden();
  await page.getByRole('button', { name: 'Structures' }).click();
  await listButton(page, /^Arrector pili/).click();
  await expect(page.locator('aside.left')).toBeHidden();
  await expect(detailTitle(page)).toHaveText('Arrector pili');
  await page.screenshot({ path: `${SHOTS}/17-phone.png` });
});

test('the About sheet holds the BodyParts3D credits', async ({ page }) => {
  await open(page);
  await ready(page);
  await page.getByRole('button', { name: /About this lab/ }).click();
  const dialog = page.getByRole('dialog', { name: 'About this lab' });
  await expect(dialog).toContainText('BodyParts3D');
  await expect(dialog).toContainText('CC BY 4.0');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('without WebGL the learning content and the panels still work @smoke', async ({ page }) => {
  const errors = await open(page, '?nowebgl');
  await expect(page.getByRole('heading', { name: '3D view unavailable' })).toBeVisible();
  await listButton(page, /^Arrector pili/).click();
  await expect(detailTitle(page)).toHaveText('Arrector pili');
  await page.keyboard.press('Escape');
  await mode(page, 'Temperature');
  await expect.poll(() => num(page, '[data-time]', 'data-time'), { timeout: 15_000 }).toBeGreaterThan(0.5);
  await mode(page, 'Touch');
  await page.locator('.touch-panel .sub-tabs').getByRole('radio', { name: 'Vibration' }).click();
  await page.getByRole('button', { name: '250 Hz buzz' }).click();
  await expect(page.locator('[data-best]')).toHaveAttribute('data-best', 'pacinian-corpuscle');
  await mode(page, 'Life');
  await page.locator('.life-panel .sub-tabs').getByRole('radio', { name: 'Disorders' }).click();
  await page.getByRole('button', { name: 'Show a melanoma' }).click();
  await expect(page.locator('.abcde')).toHaveAttribute('data-concern', 'high');
  expect(errors).toEqual([]);
});

test('a missing model shows an error with a working retry', async ({ page }) => {
  let fail = true;
  await page.route('**/models/skin.glb', (route) => (fail ? route.fulfill({ status: 404, body: 'not found' }) : route.continue()));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('The 3D model could not be loaded');
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await ready(page);
});

test('reduced motion: every simulation works without errors', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1366, height: 820 } });
  const page = await context.newPage();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Temperature');
  await expect.poll(() => num(page, '[data-time]', 'data-time'), { timeout: 15_000 }).toBeGreaterThan(0.5);
  await mode(page, 'Wounds');
  await page.getByRole('button', { name: '3 wk', exact: true }).click();
  await settle(page, 600);
  await mode(page, 'Touch');
  await page.locator('.touch-panel .sub-tabs').getByRole('radio', { name: 'Pressure' }).click();
  await page.getByRole('button', { name: 'Press the probe' }).click();
  await page.locator('.touch-panel .sub-tabs').getByRole('radio', { name: 'Heat & pain' }).click();
  await page.getByRole('button', { name: /Stub a toe/ }).click();
  await mode(page, 'Life');
  await settle(page, 600);
  expect(errors).toEqual([]);
  await context.close();
});
