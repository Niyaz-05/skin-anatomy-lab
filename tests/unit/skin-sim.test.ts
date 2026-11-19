import { describe, expect, it } from 'vitest';
import { defaultSim, parseFactors, parseRegions, patchSim, thermoBody, thermoEnvironment, TEMP_PRESETS, midMonthDay } from '../../src/app/sim';
import {
  SKBF, dayFromSlider, erythemaLevel, formatDay, formatMinutes, hzFromSlider, lesionFlags, lesionPath, localSkinC, melaninLevel, rng, skinTone,
  sliderFromDay, sliderFromHz, sliderFromUm, spikeTimes, sweatDropsPerS, thermalColour, twoPointTrial, umFromSlider, vesselDilation, woundFill,
} from '../../src/app/visual';
import { ThermoLive } from '../../src/app/live';
import {
  effectiveBodyPaint, effectiveMode, effectiveSim, initialState, isVisible, litIds, makeReducer, simHighlight, simXray,
} from '../../src/app/state';
import { skinDefinition as def } from '../../src/skin/definition';
import { stepResponseSeries } from '../../src/skin/sensation';
import { validateDefinition } from '../../src/contract/validate';

describe('simulation settings', () => {
  it('patches stay in range and ignore unknown keys and wrong types', () => {
    const s = patchSim(defaultSim(), { airC: 99, humidity: -5, met: 'fast' as unknown as number, nonsense: 3 } as never);
    expect(s.airC).toBe(50);
    expect(s.humidity).toBe(5);
    expect(s.met).toBe(defaultSim().met);
    expect('nonsense' in s).toBe(false);
  });
  it('a temperature preset applies its conditions; other keys in the patch override it', () => {
    const s = patchSim(defaultSim(), { tempPreset: 'cold-water', speed: 10 });
    expect(s.water).toBe(true);
    expect(s.waterC).toBe(12);
    expect(s.speed).toBe(10);
    expect(patchSim(defaultSim(), { tempPreset: 'nowhere' }).tempPreset).toBe('custom');
    expect(TEMP_PRESETS.map((p) => p.id)).toEqual(['office', 'desert', 'humid', 'cold-wind', 'cold-water', 'marathon', 'fever']);
  });
  it('parses tour strings for factors and burned regions', () => {
    expect(parseFactors('diabetes,smoking,bogus,diabetes')).toEqual(['diabetes', 'smoking']);
    expect(parseRegions('arm-left:1,trunk-anterior:0.5,tail:1,leg-right:0')).toEqual({ 'arm-left': 1, 'trunk-anterior': 0.5 });
    expect(patchSim(defaultSim(), { burnRegions: 'head-neck' }).burnRegions).toEqual({ 'head-neck': 1 });
  });
  it('a landmark sets its dermatome; palm spots come in triples', () => {
    expect(patchSim(defaultSim(), { landmark: 'umbilicus' }).dermatome).toBe('T10');
    expect(patchSim(defaultSim(), { palmSpots: [1, 2, 3, 4] }).palmSpots).toEqual([1, 2, 3]);
  });
  it('lesion presets', () => {
    expect(patchSim(defaultSim(), { lesionPreset: 'melanoma' } as never).lesion.evolving).toBe(true);
  });
  it('maps settings to the heat-balance environment (immersion to the neck)', () => {
    const env = thermoEnvironment(patchSim(defaultSim(), { tempPreset: 'cold-water' }));
    expect(env.contact).toEqual({ fraction: 0.9, tempC: 12, medium: 'water' });
    expect(thermoEnvironment(patchSim(defaultSim(), { tempPreset: 'desert' })).radiantTempC).toBe(60);
    expect(thermoBody({ clo: 1, met: 1, feverK: 2 }).setPointShiftC).toBe(2);
    expect(midMonthDay(1)).toBe(15);
    expect(midMonthDay(12)).toBeGreaterThan(340);
  });
});

describe('visual mappings', () => {
  it('vessel calibre: −1 constricted, 0 neutral, +1 dilated', () => {
    expect(vesselDilation(SKBF.neutral)).toBeCloseTo(0, 5);
    expect(vesselDilation(SKBF.max)).toBeCloseTo(1, 5);
    expect(vesselDilation(SKBF.min)).toBeCloseTo(-1, 5);
    expect(vesselDilation(1)).toBeGreaterThan(vesselDilation(0.5));
  });
  it('sweat drops only when sweating, more with more sweat', () => {
    expect(sweatDropsPerS(0)).toBe(0);
    expect(sweatDropsPerS(1)).toBeGreaterThan(sweatDropsPerS(0.2));
  });
  it('thermal colours run from blue (cold) to red (hot)', () => {
    const [r1, , b1] = thermalColour(20), [r2, , b2] = thermalColour(38);
    expect(b1).toBeGreaterThan(r1);
    expect(r2).toBeGreaterThan(b2);
  });
  it('hands and feet cool when vessels constrict', () => {
    expect(localSkinC(30, 37, -1, 1)).toBeLessThan(localSkinC(30, 37, 0, 1));
    expect(localSkinC(30, 37, -1, 1)).toBeLessThan(localSkinC(30, 37, -1, 0));
  });
  it('the day slider is logarithmic and round-trips', () => {
    expect(dayFromSlider(0)).toBeCloseTo(0, 6);
    expect(dayFromSlider(1000)).toBeCloseTo(730, 3);
    for (const d of [0.1, 1, 7, 90, 365]) expect(dayFromSlider(sliderFromDay(d))).toBeCloseTo(d, -0.5);
    expect(formatDay(0.01)).toBe('14 min');
    expect(formatDay(3)).toBe('3 days');
    expect(formatDay(400)).toBe('13 months');
    expect(formatDay(700)).toBe('1.9 years');
  });
  it('frequency and amplitude sliders round-trip', () => {
    expect(hzFromSlider(sliderFromHz(250))).toBeCloseTo(250, -1);
    expect(umFromSlider(sliderFromUm(2))).toBeCloseTo(2, 1);
  });
  it('a wound fills: clot → granulation → epithelium → scar; deep wounds contract', () => {
    const d1 = woundFill(0.1, 'deep'), d14 = woundFill(14, 'deep'), d40 = woundFill(40, 'deep'), d400 = woundFill(400, 'deep');
    expect(d1.clot).toBeGreaterThan(0.9);
    expect(d14.granulation).toBeGreaterThan(d1.granulation);
    expect(d40.epithelium).toBe(1);
    expect(d400.scar).toBeGreaterThan(0.9);
    expect(d40.gap).toBeLessThan(0.6);
    expect(woundFill(3, 'incision').epithelium).toBe(1);
    // Delaying factors slow every stage.
    expect(woundFill(14, 'deep', ['diabetes', 'infection']).granulation).toBeLessThan(d14.granulation);
  });
  it('spike trains: RA fires at on and off, SA throughout; deterministic', () => {
    const step = { onMs: 200, offMs: 700 };
    const ra = spikeTimes(stepResponseSeries('pacinian-corpuscle', 1000, 2, step), 260, 1);
    const sa = spikeTimes(stepResponseSeries('merkel-discs', 1000, 2, step), 140, 1);
    const mid = (s: number[]) => s.filter((t) => t > 350 && t < 650).length;
    expect(mid(ra)).toBe(0);
    expect(mid(sa)).toBeGreaterThan(10);
    expect(ra.some((t) => t > 700)).toBe(true);
    expect(spikeTimes(stepResponseSeries('merkel-discs', 1000, 2, step), 140, 1)).toEqual(sa);
  });
  it('two-point trials are deterministic and follow the threshold', () => {
    expect(twoPointTrial('back', 40, 5)).toBe(twoPointTrial('back', 40, 5));
    const n = 200;
    const far = Array.from({ length: n }, (_, i) => twoPointTrial('fingertip', 8, i)).filter(Boolean).length;
    const near = Array.from({ length: n }, (_, i) => twoPointTrial('back', 10, i)).filter(Boolean).length;
    expect(far).toBeGreaterThan(n * 0.95);
    expect(near).toBeLessThan(n * 0.05);
    const r = rng(1); expect(r()).not.toBe(r());
  });
  it('skin tones darken with phototype and redden with dose', () => {
    const lum = (h: string) => [1, 3, 5].reduce((n, i) => n + parseInt(h.slice(i, i + 2), 16), 0);
    expect(lum(skinTone('I'))).toBeGreaterThan(lum(skinTone('VI')));
    expect(skinTone('II', 3)).not.toBe(skinTone('II', 0));
    expect(melaninLevel('VI')).toBeGreaterThan(melaninLevel('I'));
    expect(erythemaLevel(0.5)).toBe(0);
    expect(erythemaLevel(4)).toBe(1);
  });
  it('lesion drawing and flags', () => {
    expect(lesionPath(50, 50, 20, 0, 0)).toMatch(/^M .* Z$/);
    expect(lesionFlags(0.5, 0.1)).toEqual({ asymmetric: true, irregularBorder: false });
    expect(formatMinutes(Infinity)).toBe('never');
    expect(formatMinutes(17.2)).toBe('17 min');
  });
});

describe('live heat balance', () => {
  it('runs in simulated time and cools a body in cold water', () => {
    const live = new ThermoLive();
    live.setConditions(thermoEnvironment(patchSim(defaultSim(), { tempPreset: 'cold-water' })), thermoBody(patchSim(defaultSim(), { tempPreset: 'cold-water' })));
    for (let i = 0; i < 100; i++) live.step(0.05, 10); // 5 s at 10 min/s = 50 min
    expect(live.tMin).toBeCloseTo(50, 3);
    expect(live.state.skinC).toBeLessThan(25);
    expect(live.balance.shiveringW).toBeGreaterThan(20);
    expect(live.history.length).toBe(51);
    live.reset();
    expect(live.tMin).toBe(0);
  });
});

describe('modes in the lab state', () => {
  const reduce = makeReducer(def);
  it('the definition with the new tour and sources passes validation', () => {
    const r = validateDefinition(def);
    expect(r.ok).toBe(true);
    expect(def.tour.length).toBe(22);
    for (const m of ['temperature', 'wounds', 'touch', 'life'] as const) expect(def.tour.some((t) => t.mode === m)).toBe(true);
  });
  it('a sub-view moves the camera and the scene', () => {
    let s = reduce(initialState(def), { type: 'set-mode', mode: 'touch' });
    expect(s.view).toBe('block');
    s = reduce(s, { type: 'set-sim', patch: { touchView: 'two-point' } });
    expect(s.view).toBe('body');
    expect(s.camera.preset).toBe('body-front');
    s = reduce(s, { type: 'set-mode', mode: 'wounds' });
    expect(s.camera.preset).toBe('block-wound');
    s = reduce(s, { type: 'set-sim', patch: { woundView: 'burns' } });
    expect(s.camera.preset).toBe('block-burn');
  });
  it('see-through effectors, highlights and body paint follow the mode', () => {
    let s = reduce(initialState(def), { type: 'set-mode', mode: 'temperature' });
    expect(simXray(def, s)?.has('eccrine-gland')).toBe(true);
    expect(effectiveBodyPaint(def, s).kind).toBe('temperature');
    s = reduce(s, { type: 'set-mode', mode: 'life' });
    s = reduce(s, { type: 'set-sim', patch: { lifeView: 'disorders', disorder: 'vitiligo' } });
    expect(simHighlight(def, s)).toContain('melanocytes');
    expect(isVisible(def, s, 'melanocytes')).toBe(false);
    expect(litIds(def, s)).toContain('stratum-basale');
  });
  it('tour steps carry their mode settings; try-step hands them to the learner', () => {
    let s = reduce(initialState(def), { type: 'set-mode', mode: 'tour' });
    const i = def.tour.findIndex((t) => t.id === 'cold');
    s = reduce(s, { type: 'tour-go', index: i });
    expect(effectiveMode(def, s)).toBe('temperature');
    expect(effectiveSim(def, s).water).toBe(true);
    s = reduce(s, { type: 'try-step' });
    expect(s.mode).toBe('temperature');
    expect(s.sim.tempPreset).toBe('cold-water');
    const j = def.tour.findIndex((t) => t.id === 'nines');
    s = reduce(reduce(s, { type: 'set-mode', mode: 'tour' }), { type: 'tour-go', index: j });
    expect(effectiveSim(def, s).burnRegions).toEqual({ 'arm-left': 1, 'trunk-anterior': 1 });
    expect(effectiveBodyPaint(def, s).kind).toBe('burns');
  });
});
