import { describe, expect, it } from 'vitest';
import {
  ACTIVITIES, classifyCoreTemp, clothingAreaFactor, convectiveCoefficientWm2K, DEFAULT_BODY, duBoisAreaM2, heatBalance, metabolicW,
  NEUTRAL_STATE, piloerection, radiativeCoefficientWm2K, saturationVapourPressureKpa, shiveringW, simulateThermo, skinBloodFlowLpm,
  sweatRateLph, THERMAL_STATES, thermoStep, wetBulbC, wetBulbRisk, type Environment,
} from '../../src/skin/thermo';
import {
  BODY_REGION_IDS, BURN_DEPTHS, burnDepthFromLayer, burnDepthFromMm, burnTbsa, cellActivity, closurePercent, getBurnDepth, HEALING_FACTORS,
  HEALING_PHASES, healingDelayFactor, LUND_BROWDER_AGE_TABLE, lundBrowder, PALM_PERCENT_TBSA, parkland, phaseActivity, regionPercents,
  RULE_OF_NINES_ADULT, RULE_OF_NINES_CHILD, tensileStrengthPercent, WOUND_EVENTS, WOUND_TYPES, woundStateOnDay,
} from '../../src/skin/wounds';
import {
  activeTrpChannels, bestFrequencyHz, conductionTimeMs, DERMATOME_IDS, DERMATOMES, dermatomeForLandmark, dermatomeIndex, dermatomesBelow,
  feelsTwoPoints, FIBRES, getDermatome, MECHANORECEPTORS, mostSensitiveReceptor, painArrivalMs, RECEPTOR_IDS, RECEPTORS, sitesByAcuity,
  stepResponse, stepResponseSeries, thermalSensation, twoPointProbability, twoPointThresholdMm, vibrationResponse, vibrationSensitivity,
  vibrationThresholdUm,
} from '../../src/skin/sensation';
import {
  abcdeCheck, AGEING_BY_DECADE, clearSkyNoonUvIndex, DISORDERS, dosesInMed, epidermalTurnoverDays, erythemaActionSpectrum,
  erythemalIrradianceWm2, FITZPATRICK_TYPES, minutesToErythema, noonSolarElevationDeg, PHOTOTYPES, relativeCollagen, sunburnGrade, uvBand,
  uvIndexCategory, vitaminDEstimateIU, vitaminDSeason,
} from '../../src/skin/photo';

/** Structure ids from docs/STRUCTURES.md (block + body scenes). */
const STRUCTURE_IDS = new Set([
  'body-skin', 'scalp-hair', 'pubic-hair', 'stratum-corneum', 'stratum-lucidum', 'stratum-granulosum', 'stratum-spinosum', 'stratum-basale',
  'melanocytes', 'langerhans-cells', 'papillary-dermis', 'reticular-dermis', 'collagen-bundles', 'subcutaneous-fat', 'deep-fascia',
  'hair-shaft', 'hair-follicle', 'hair-bulb', 'arrector-pili', 'sebaceous-gland', 'eccrine-gland', 'apocrine-gland', 'meissner-corpuscle',
  'merkel-discs', 'pacinian-corpuscle', 'ruffini-ending', 'free-nerve-endings', 'hair-follicle-plexus', 'superficial-plexus', 'deep-plexus',
  'lymphatic-vessels', 'cutaneous-nerve',
]);

const room = (over: Partial<Environment> = {}): Environment => ({ airTempC: 20, relHumidityPct: 50, windMs: 0, ...over });
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

// ===============================================================================================
// thermo.ts
// ===============================================================================================

describe('thermo: body, coefficients, psychrometrics', () => {
  it('DuBois area of a 70 kg, 1.75 m adult ≈ 1.84 m²', () => {
    expect(duBoisAreaM2(70, 1.75)).toBeCloseTo(1.84, 2);
  });

  it('resting metabolic heat is ≈ 80–110 W; running ≈ 1 kW', () => {
    const A = duBoisAreaM2(70, 1.75);
    expect(metabolicW(ACTIVITIES.seated.met, A)).toBeGreaterThan(80);
    expect(metabolicW(ACTIVITIES.seated.met, A)).toBeLessThan(110);
    expect(metabolicW(ACTIVITIES.sleeping.met, A)).toBeLessThan(metabolicW(ACTIVITIES.seated.met, A));
    expect(metabolicW(ACTIVITIES.running.met, A)).toBeGreaterThan(1000);
  });

  it('saturation vapour pressure: 20 °C ≈ 2.34 kPa, 100 °C ≈ 101 kPa', () => {
    expect(saturationVapourPressureKpa(20)).toBeCloseTo(2.34, 1);
    expect(saturationVapourPressureKpa(100)).toBeGreaterThan(99);
    expect(saturationVapourPressureKpa(100)).toBeLessThan(103);
  });

  it('convection rises with wind; radiative coefficient ≈ 4–5 W/m²K at room temperature; clothing area factor', () => {
    expect(convectiveCoefficientWm2K(0)).toBeCloseTo(3.1, 5);
    expect(convectiveCoefficientWm2K(5)).toBeGreaterThan(convectiveCoefficientWm2K(1));
    const hr = radiativeCoefficientWm2K(30, 20);
    expect(hr).toBeGreaterThan(4);
    expect(hr).toBeLessThan(5);
    expect(clothingAreaFactor(1)).toBeCloseTo(1.31, 5);
  });

  it('wet-bulb (Stull 2011): 20 °C at 50 % ≈ 13.7 °C, never above dry bulb, ≈ dry bulb near saturation', () => {
    expect(wetBulbC(20, 50)).toBeCloseTo(13.7, 1);
    for (const T of [10, 25, 35, 45]) for (const rh of [10, 40, 70, 95]) expect(wetBulbC(T, rh)).toBeLessThanOrEqual(T + 0.3);
    expect(Math.abs(wetBulbC(30, 99) - 30)).toBeLessThan(0.6);
    expect(wetBulbRisk(wetBulbC(20, 50)).risk).toBe('safe');
    expect(wetBulbRisk(36).risk).toBe('unsurvivable');
    expect(wetBulbRisk(32).risk).toBe('danger');
  });
});

describe('thermo: heat balance', () => {
  it('at rest in 20 °C still air with 1 clo the body is close to balance, losing heat by every route', () => {
    const b = heatBalance(NEUTRAL_STATE, room());
    expect(Math.abs(b.storageW)).toBeLessThan(25);
    expect(b.routes.radiationW).toBeGreaterThan(0);
    expect(b.routes.convectionW).toBeGreaterThan(0);
    expect(b.routes.evaporationW).toBeGreaterThan(0);
    expect(b.routes.respirationW).toBeGreaterThan(0);
    expect(b.routes.conductionW).toBe(0);
    // radiation is the largest single route indoors
    expect(b.routes.radiationW).toBeGreaterThan(b.routes.convectionW);
    expect(b.sweatLph).toBe(0);
  });

  it('the routes and storage add up: production − loss = storage', () => {
    const b = heatBalance({ coreC: 37.2, skinC: 35 }, room({ airTempC: 31, windMs: 1.5 }), { clo: 0.3, met: 2 });
    const r = b.routes;
    expect(b.heatProductionW - (r.radiationW + r.convectionW + r.conductionW + r.evaporationW + r.respirationW)).toBeCloseTo(b.storageW, 6);
  });

  it('above skin temperature (> 35 °C) radiation and convection become heat gains and evaporation is required', () => {
    const b = heatBalance(NEUTRAL_STATE, room({ airTempC: 40, relHumidityPct: 30 }), { clo: 0.5 });
    expect(b.routes.radiationW).toBeLessThan(0);
    expect(b.routes.convectionW).toBeLessThan(0);
    expect(b.requiredEvaporationW).toBeGreaterThan(b.metabolicW);
    const cool = heatBalance(NEUTRAL_STATE, room({ airTempC: 20 }), { clo: 0.5 });
    expect(cool.requiredEvaporationW).toBeLessThan(cool.metabolicW);
  });

  it('wind increases convective loss; humidity cuts maximal evaporation; cold water removes heat far faster than air', () => {
    const still = heatBalance(NEUTRAL_STATE, room({ airTempC: 10 }), { clo: 0 });
    const windy = heatBalance(NEUTRAL_STATE, room({ airTempC: 10, windMs: 5 }), { clo: 0 });
    expect(windy.routes.convectionW).toBeGreaterThan(2 * still.routes.convectionW);
    const dry = heatBalance(NEUTRAL_STATE, room({ airTempC: 35, relHumidityPct: 20 }));
    const humid = heatBalance(NEUTRAL_STATE, room({ airTempC: 35, relHumidityPct: 90 }));
    expect(humid.maxEvaporationW).toBeLessThan(dry.maxEvaporationW / 2);
    const water = heatBalance(NEUTRAL_STATE, room({ airTempC: 10, contact: { fraction: 0.9, tempC: 10, medium: 'water' } }), { clo: 0 });
    expect(water.routes.conductionW).toBeGreaterThan(5 * (still.routes.radiationW + still.routes.convectionW));
  });

  it('clothing reduces dry heat loss', () => {
    const nude = heatBalance(NEUTRAL_STATE, room({ airTempC: 10 }), { clo: 0 });
    const coat = heatBalance(NEUTRAL_STATE, room({ airTempC: 10 }), { clo: 2 });
    expect(coat.routes.radiationW + coat.routes.convectionW).toBeLessThan(0.4 * (nude.routes.radiationW + nude.routes.convectionW));
  });
});

describe('thermo: effectors', () => {
  const A = duBoisAreaM2(70, 1.75);
  it('no sweating, shivering or goosebumps at the set points', () => {
    expect(sweatRateLph(36.8, 33.7, A)).toBe(0);
    expect(shiveringW(36.8, 33.7, A)).toBe(0);
    expect(piloerection(33.7, 36.8)).toBe(0);
  });

  it('skin blood flow: ≈ 0.2 L/min neutral, near zero when vasoconstricted, capped ≈ 7.5 L/min in heat', () => {
    expect(skinBloodFlowLpm(36.8, 33.7, A)).toBeCloseTo(0.19, 1);
    expect(skinBloodFlowLpm(36.5, 20, A)).toBeLessThan(0.05);
    expect(skinBloodFlowLpm(39.5, 37, A)).toBe(DEFAULT_BODY.maxSkinBloodFlowLpm);
    expect(skinBloodFlowLpm(37.3, 35, A)).toBeGreaterThan(skinBloodFlowLpm(36.9, 35, A));
  });

  it('sweat rate rises with core and skin temperature and is capped', () => {
    expect(sweatRateLph(37.3, 35, A)).toBeGreaterThan(sweatRateLph(37.0, 35, A));
    expect(sweatRateLph(37.3, 36, A)).toBeGreaterThan(sweatRateLph(37.3, 35, A));
    expect(sweatRateLph(40, 39, A)).toBe(DEFAULT_BODY.maxSweatLph);
    expect(sweatRateLph(40, 39, A, { ...DEFAULT_BODY, maxSweatLph: 2.5 })).toBeGreaterThan(DEFAULT_BODY.maxSweatLph);
  });

  it('shivering needs cooling, is capped, and fails in moderate hypothermia', () => {
    expect(shiveringW(36.0, 20, A)).toBe(DEFAULT_BODY.maxShiveringW);
    expect(shiveringW(36.6, 30, A)).toBeGreaterThan(0);
    expect(shiveringW(29.5, 15, A)).toBe(0);
    expect(shiveringW(31, 15, A)).toBeLessThan(DEFAULT_BODY.maxShiveringW);
  });

  it('piloerection grows with cold skin', () => {
    expect(piloerection(31, 36.8)).toBeLessThan(piloerection(29, 36.8));
    expect(piloerection(25, 36.8)).toBe(1);
  });
});

describe('thermo: simulation', () => {
  it('returns one sample per minute including minute 0', () => {
    const s = simulateThermo(room(), 30);
    expect(s).toHaveLength(31);
    expect(s[0]!.tMin).toBe(0);
    expect(s[30]!.tMin).toBe(30);
  });

  it('thermoStep is stable with large steps', () => {
    const s = thermoStep(NEUTRAL_STATE, room({ airTempC: 5, windMs: 3 }), 600, { clo: 0 });
    expect(Number.isFinite(s.coreC)).toBe(true);
    expect(s.skinC).toBeGreaterThan(5);
    expect(s.skinC).toBeLessThan(34);
  });

  it('20 °C, 1 clo, seated: core stays normal for 3 h without sweating or shivering of note', () => {
    const s = simulateThermo(room(), 180);
    const last = s[180]!;
    expect(last.coreC).toBeGreaterThan(36.4);
    expect(last.coreC).toBeLessThan(37.2);
    expect(last.state).toBe('normal');
    expect(last.sweatLph).toBe(0);
    expect(last.shiveringW).toBeLessThan(10);
    expect(last.piloerection).toBe(0);
  });

  it('sweating rises monotonically as ambient temperature rises past skin temperature', () => {
    const rates = [25, 30, 35, 40].map((T) => simulateThermo(room({ airTempC: T, relHumidityPct: 30 }), 60, { clo: 0.5 })[60]!.sweatLph);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeGreaterThan(rates[i - 1]!);
    expect(rates[3]!).toBeGreaterThan(0.15);
  });

  it('hot dry air is compensable; hot humid air (wet-bulb > 35 °C) is not — core climbs to heat stroke', () => {
    const dry = simulateThermo(room({ airTempC: 40, relHumidityPct: 30 }), 180, { clo: 0.5 });
    expect(dry[180]!.coreC).toBeLessThan(37.6);
    expect(wetBulbC(40, 90)).toBeGreaterThan(35);
    const humid = simulateThermo(room({ airTempC: 40, relHumidityPct: 90 }), 180, { clo: 0.5 });
    expect(humid[120]!.coreC).toBeGreaterThan(38.5);
    expect(humid[180]!.state).toBe('heat-stroke');
    expect(humid[180]!.skinBloodFlowLpm).toBeGreaterThan(6);
    expect(humid[180]!.sweatLph).toBe(DEFAULT_BODY.maxSweatLph);
  });

  it('cold: vasoconstriction, shivering, goosebumps; cold water causes hypothermia within hours', () => {
    const air = simulateThermo(room({ airTempC: 5, windMs: 2 }), 60, { clo: 0 })[60]!;
    expect(air.skinBloodFlowLpm).toBeLessThan(0.05);
    expect(air.shiveringW).toBeGreaterThan(100);
    expect(air.piloerection).toBe(1);
    const water = simulateThermo(room({ airTempC: 10, relHumidityPct: 80, contact: { fraction: 0.9, tempC: 5, medium: 'water' } }), 180, { clo: 0 });
    expect(water[60]!.coreC).toBeLessThan(35.5);
    expect(['mild-hypothermia', 'moderate-hypothermia']).toContain(water[180]!.state);
    for (let i = 1; i < water.length; i++) expect(water[i]!.coreC).toBeLessThanOrEqual(water[i - 1]!.coreC + 1e-9);
  });

  it('exercise raises core temperature to a new steady state with heavy sweating', () => {
    const run = simulateThermo(room({ windMs: 3 }), 60, { clo: 0.3, met: ACTIVITIES.running.met });
    expect(run[60]!.coreC).toBeGreaterThan(38);
    expect(run[60]!.coreC).toBeLessThan(39.5);
    expect(run[60]!.sweatLph).toBeGreaterThan(0.5);
  });

  it('fever: a raised set point causes chills (shivering, vasoconstriction) and the core rises toward it', () => {
    const s = simulateThermo(room({ airTempC: 22 }), 180, { setPointShiftC: 1.5 });
    expect(s[0]!.shiveringW).toBeGreaterThan(30);
    expect(s[0]!.skinBloodFlowLpm).toBeLessThan(skinBloodFlowLpm(36.8, 33.7, duBoisAreaM2(70, 1.75)));
    expect(s[180]!.coreC).toBeGreaterThan(37.7);
  });
});

describe('thermo: states', () => {
  it('classifies core temperature', () => {
    expect(classifyCoreTemp(37)).toBe('normal');
    expect(classifyCoreTemp(34)).toBe('mild-hypothermia');
    expect(classifyCoreTemp(30)).toBe('moderate-hypothermia');
    expect(classifyCoreTemp(26)).toBe('severe-hypothermia');
    expect(classifyCoreTemp(38)).toBe('elevated');
    expect(classifyCoreTemp(39.5)).toBe('heat-exhaustion');
    expect(classifyCoreTemp(41)).toBe('heat-stroke');
  });

  it('state bands are contiguous', () => {
    for (let i = 1; i < THERMAL_STATES.length; i++) expect(THERMAL_STATES[i]!.rangeC[0]).toBe(THERMAL_STATES[i - 1]!.rangeC[1]);
  });
});

// ===============================================================================================
// wounds.ts
// ===============================================================================================

describe('wounds: healing phases', () => {
  it('phases are in order and overlap', () => {
    const ids = HEALING_PHASES.map((p) => p.id);
    expect(ids).toEqual(['haemostasis', 'inflammation', 'proliferation', 'remodelling']);
    for (let i = 1; i < HEALING_PHASES.length; i++) expect(HEALING_PHASES[i]!.startDay).toBeLessThanOrEqual(HEALING_PHASES[i - 1]!.endDay);
    expect(HEALING_PHASES[3]!.endDay).toBeGreaterThanOrEqual(365);
  });

  it('dominant phase follows the textbook timeline for an incision', () => {
    expect(woundStateOnDay(0.01).dominantPhase).toBe('haemostasis');
    expect(woundStateOnDay(1.5).dominantPhase).toBe('inflammation');
    expect(woundStateOnDay(7).dominantPhase).toBe('proliferation');
    expect(woundStateOnDay(60).dominantPhase).toBe('remodelling');
  });

  it('cells appear in sequence: platelets → neutrophils → macrophages → fibroblasts', () => {
    const peakDay = (cell: keyof ReturnType<typeof cellActivity>) => {
      let best = 0, at = 0;
      for (let d = 0; d <= 60; d += 0.05) { const v = cellActivity(d)[cell]; if (v > best) { best = v; at = d; } }
      return at;
    };
    const order = [peakDay('platelets'), peakDay('neutrophils'), peakDay('macrophages'), peakDay('fibroblasts')];
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
    expect(order[1]!).toBeGreaterThan(0.9);
    expect(order[1]!).toBeLessThan(2.1);
  });

  it('an incision closes in ~2 days, a graze in ~10, a deep wound by secondary intention in weeks', () => {
    expect(closurePercent(2, 'incision')).toBe(100);
    expect(closurePercent(1, 'incision')).toBeGreaterThan(0);
    expect(closurePercent(5, 'graze')).toBeLessThan(100);
    expect(closurePercent(10, 'graze')).toBe(100);
    expect(closurePercent(21, 'deep')).toBeLessThan(100);
    expect(WOUND_TYPES.incision.intention).toBe('primary');
    expect(WOUND_TYPES.deep.intention).toBe('secondary');
    expect(phaseActivity(30, 'deep').proliferation).toBeGreaterThan(phaseActivity(30, 'incision').proliferation);
    expect(cellActivity(10, 'deep').myofibroblasts).toBeGreaterThan(cellActivity(10, 'graze').myofibroblasts);
  });

  it('wound layers and events use real structure ids and are sorted by day', () => {
    for (const w of Object.values(WOUND_TYPES)) {
      for (const l of w.layers) expect(STRUCTURE_IDS.has(l)).toBe(true);
      expect(w.layers[w.layers.length - 1]).toBe(w.deepestLayer);
    }
    for (const ev of Object.values(WOUND_EVENTS)) for (let i = 1; i < ev.length; i++) expect(ev[i]!.day).toBeGreaterThanOrEqual(ev[i - 1]!.day);
    expect(woundStateOnDay(3, 'incision').events.length).toBeGreaterThan(woundStateOnDay(0.5, 'incision').events.length);
  });
});

describe('wounds: tensile strength and delaying factors', () => {
  it('≈ 10 % at 1 week, ≈ 20 % at 3 weeks, 70–80 % by 3 months, never above 80 %', () => {
    expect(tensileStrengthPercent(0)).toBe(0);
    expect(tensileStrengthPercent(7)).toBeCloseTo(10, 5);
    expect(tensileStrengthPercent(21)).toBeCloseTo(20, 5);
    expect(tensileStrengthPercent(90)).toBeGreaterThanOrEqual(70);
    expect(tensileStrengthPercent(90)).toBeLessThanOrEqual(80);
    expect(tensileStrengthPercent(3650)).toBe(80);
    let prev = 0;
    for (let d = 0; d <= 800; d += 1) { const v = tensileStrengthPercent(d); expect(v).toBeGreaterThanOrEqual(prev - 1e-9); expect(v).toBeLessThanOrEqual(80); prev = v; }
  });

  it('impairing factors slow healing', () => {
    expect(healingDelayFactor([])).toBe(1);
    expect(healingDelayFactor(['diabetes', 'smoking'])).toBeGreaterThan(healingDelayFactor(['smoking']));
    expect(healingDelayFactor(HEALING_FACTORS.map((f) => f.id))).toBe(4);
    expect(tensileStrengthPercent(21, healingDelayFactor(['diabetes']))).toBeLessThan(tensileStrengthPercent(21));
    expect(woundStateOnDay(2, 'incision', ['infection', 'diabetes']).closurePercent).toBeLessThan(100);
  });
});

describe('wounds: burns', () => {
  it('maps the deepest layer reached to burn depth', () => {
    expect(burnDepthFromLayer('stratum-spinosum')!.id).toBe('superficial');
    expect(burnDepthFromLayer('papillary-dermis')!.id).toBe('superficial-partial');
    expect(burnDepthFromLayer('reticular-dermis')!.id).toBe('deep-partial');
    expect(burnDepthFromLayer('subcutaneous-fat')!.id).toBe('full-thickness');
    expect(burnDepthFromLayer('deep-fascia')!.id).toBe('fourth-degree');
    expect(burnDepthFromLayer('not-a-layer')).toBeNull();
    for (const b of BURN_DEPTHS) {
      expect(STRUCTURE_IDS.has(b.deepestLayer)).toBe(true);
      expect(burnDepthFromLayer(b.deepestLayer)!.id).toBe(b.id);
    }
  });

  it('maps depth in mm to burn depth (thin skin)', () => {
    expect(burnDepthFromMm(0.05).id).toBe('superficial');
    expect(burnDepthFromMm(0.3).id).toBe('superficial-partial');
    expect(burnDepthFromMm(1).id).toBe('deep-partial');
    expect(burnDepthFromMm(5).id).toBe('full-thickness');
    expect(burnDepthFromMm(20).id).toBe('fourth-degree');
  });

  it('features follow the textbook: blisters in partial thickness, painless and grafted when full thickness', () => {
    expect(getBurnDepth('superficial').blisters).toBe(false);
    expect(getBurnDepth('superficial-partial').blisters).toBe(true);
    expect(getBurnDepth('superficial-partial').pain).toMatch(/very painful/i);
    expect(getBurnDepth('full-thickness').pain).toMatch(/painless/i);
    expect(getBurnDepth('full-thickness').grafting).toBe('yes');
    expect(getBurnDepth('full-thickness').healingDays).toBeNull();
    expect(getBurnDepth('superficial').scarring).toBe('None');
    expect(getBurnDepth('superficial').countsForTbsa).toBe(false);
    const days = BURN_DEPTHS.filter((b) => b.healingDays).map((b) => b.healingDays![1]);
    for (let i = 1; i < days.length; i++) expect(days[i]!).toBeGreaterThan(days[i - 1]!);
  });

  it('rule of nines sums to 100 % for adult and child; palm ≈ 1 %', () => {
    expect(sum(RULE_OF_NINES_ADULT)).toBe(100);
    expect(sum(RULE_OF_NINES_CHILD)).toBe(100);
    expect(RULE_OF_NINES_ADULT['head-neck']).toBe(9);
    expect(RULE_OF_NINES_ADULT['leg-left']).toBe(18);
    expect(RULE_OF_NINES_CHILD['head-neck']).toBeGreaterThan(RULE_OF_NINES_ADULT['head-neck']);
    expect(RULE_OF_NINES_CHILD['leg-left']).toBeLessThan(RULE_OF_NINES_ADULT['leg-left']);
    expect(PALM_PERCENT_TBSA).toBe(1);
    expect(Object.keys(RULE_OF_NINES_ADULT).sort()).toEqual([...BODY_REGION_IDS].sort());
  });

  it('Lund–Browder sums to 100 % at every age, head shrinks and legs grow with age', () => {
    for (const row of LUND_BROWDER_AGE_TABLE) expect(sum(lundBrowder(row.ageYears))).toBeCloseTo(100, 9);
    for (const age of [0.5, 3, 7.5, 12, 16, 40]) expect(sum(lundBrowder(age))).toBeCloseTo(100, 9);
    expect(lundBrowder(0)['head-neck']).toBeCloseTo(21, 9);
    expect(lundBrowder(30)['head-neck']).toBeCloseTo(9, 9);
    expect(lundBrowder(10)['leg-left']).toBeGreaterThan(lundBrowder(1)['leg-left']);
  });

  it('%TBSA from region selections; superficial burns excluded from the counted figure', () => {
    const r = burnTbsa([
      { region: 'arm-left', fraction: 1, depth: 'deep-partial' },
      { region: 'trunk-anterior', fraction: 0.5, depth: 'superficial-partial' },
      { region: 'head-neck', fraction: 1, depth: 'superficial' },
    ]);
    expect(r.totalPercent).toBeCloseTo(9 + 9 + 9, 9);
    expect(r.countedPercent).toBeCloseTo(18, 9);
    expect(r.byRegion['arm-left']).toBe(9);
    expect(burnTbsa([], 'adult', [{ count: 3, depth: 'full-thickness' }]).countedPercent).toBe(3);
    expect(burnTbsa([{ region: 'head-neck', fraction: 1, depth: 'full-thickness' }], 'child').countedPercent).toBe(18);
    expect(burnTbsa(BODY_REGION_IDS.map((region) => ({ region, fraction: 1, depth: 'full-thickness' as const }))).totalPercent).toBe(100);
    expect(regionPercents({ lundBrowderAgeYears: 0 })['head-neck']).toBeCloseTo(21, 9);
  });

  it('Parkland: 70 kg × 20 % = 5600 mL, 2800 mL in the first 8 h', () => {
    const p = parkland(70, 20);
    expect(p.total24hMl).toBe(5600);
    expect(p.first8hMl).toBe(2800);
    expect(p.next16hMl).toBe(2800);
    expect(p.first8hRateMlPerH).toBe(350);
    expect(p.next16hRateMlPerH).toBe(175);
    expect(p.urineTargetMlPerH).toBe(35);
    expect(p.indicated).toBe(true);
    expect(parkland(70, 10).indicated).toBe(false);
    expect(parkland(20, 12, { child: true }).indicated).toBe(true);
    expect(parkland(70, 20, { mlPerKgPerPct: 2 }).total24hMl).toBe(2800);
  });
});

// ===============================================================================================
// sensation.ts
// ===============================================================================================

describe('sensation: receptors and fibres', () => {
  it('receptor ids match the structure contract and adaptation classes are right', () => {
    for (const id of RECEPTOR_IDS) {
      expect(STRUCTURE_IDS.has(id)).toBe(true);
      expect(STRUCTURE_IDS.has(RECEPTORS[id].layer)).toBe(true);
    }
    expect(RECEPTORS['meissner-corpuscle'].adaptation).toBe('RA');
    expect(RECEPTORS['pacinian-corpuscle'].adaptation).toBe('RA');
    expect(RECEPTORS['merkel-discs'].adaptation).toBe('SA');
    expect(RECEPTORS['ruffini-ending'].adaptation).toBe('SA');
    expect(RECEPTORS['meissner-corpuscle'].receptiveField).toBe('small');
    expect(RECEPTORS['pacinian-corpuscle'].receptiveField).toBe('large');
    expect(RECEPTORS['free-nerve-endings'].fibre).toEqual(['Aδ', 'C']);
  });

  it('fingertip density: Meissner > Merkel > Pacinian; hand shares sum to 100 %', () => {
    const d = (id: keyof typeof RECEPTORS) => RECEPTORS[id].densityPerCm2!.fingertip;
    expect(d('meissner-corpuscle')).toBeGreaterThan(d('merkel-discs'));
    expect(d('merkel-discs')).toBeGreaterThan(d('pacinian-corpuscle'));
    expect(MECHANORECEPTORS.reduce((a, id) => a + RECEPTORS[id].handSharePct!, 0)).toBe(100);
  });

  it('conduction velocity order Aα > Aβ > Aδ > C; first pain precedes second pain by ≈ 1 s from the foot', () => {
    expect(FIBRES['Aα'].velocityMs[0]).toBeGreaterThan(FIBRES['Aβ'].velocityMs[0]);
    expect(FIBRES['Aβ'].velocityMs[0]).toBeGreaterThan(FIBRES['Aδ'].velocityMs[0]);
    expect(FIBRES['Aδ'].velocityMs[0]).toBeGreaterThan(FIBRES.C.velocityMs[0]);
    expect(FIBRES.C.myelinated).toBe(false);
    expect(conductionTimeMs(1, 50)).toBe(20);
    const p = painArrivalMs(1);
    expect(p.firstPainMs).toBe(50);
    expect(p.secondPainMs).toBe(1000);
    expect(p.gapMs).toBeGreaterThan(900);
  });
});

describe('sensation: two-point discrimination', () => {
  it('fingertip ≈ 2–3 mm, much finer than palm and back (≈ 40 mm)', () => {
    expect(twoPointThresholdMm('fingertip')).toBeGreaterThanOrEqual(2);
    expect(twoPointThresholdMm('fingertip')).toBeLessThanOrEqual(3);
    expect(twoPointThresholdMm('fingertip')).toBeLessThan(twoPointThresholdMm('lip'));
    expect(twoPointThresholdMm('lip')).toBeLessThan(twoPointThresholdMm('palm'));
    expect(twoPointThresholdMm('palm')).toBeLessThan(twoPointThresholdMm('back'));
    expect(twoPointThresholdMm('back')).toBeGreaterThanOrEqual(35);
    expect(sitesByAcuity()[0]).toBe('fingertip');
  });

  it('psychometric function: 50 % at threshold, rising with separation', () => {
    expect(twoPointProbability('back', 40)).toBeCloseTo(0.5, 9);
    expect(twoPointProbability('back', 60)).toBeGreaterThan(0.9);
    expect(twoPointProbability('fingertip', 0)).toBe(0);
    expect(feelsTwoPoints('fingertip', 5)).toBe(true);
    expect(feelsTwoPoints('back', 5)).toBe(false);
  });
});

describe('sensation: vibration and adaptation', () => {
  it('Pacinian corpuscles are best at ≈ 250 Hz, Meissner at ≈ 30 Hz', () => {
    expect(bestFrequencyHz('pacinian-corpuscle')).toBeGreaterThan(200);
    expect(bestFrequencyHz('pacinian-corpuscle')).toBeLessThan(300);
    expect(bestFrequencyHz('meissner-corpuscle')).toBeGreaterThan(25);
    expect(bestFrequencyHz('meissner-corpuscle')).toBeLessThan(35);
    expect(mostSensitiveReceptor(250)).toBe('pacinian-corpuscle');
    expect(mostSensitiveReceptor(30)).toBe('meissner-corpuscle');
    expect(mostSensitiveReceptor(2)).toBe('merkel-discs');
    expect(vibrationSensitivity('pacinian-corpuscle', 250)).toBeCloseTo(1, 2);
    expect(vibrationThresholdUm('pacinian-corpuscle', 250)).toBeLessThan(vibrationThresholdUm('meissner-corpuscle', 250) / 100);
  });

  it('vibration response grows with amplitude and is larger at the best frequency', () => {
    expect(vibrationResponse('pacinian-corpuscle', 250, 0)).toBe(0);
    expect(vibrationResponse('pacinian-corpuscle', 250, 1)).toBeGreaterThan(vibrationResponse('pacinian-corpuscle', 250, 0.2));
    expect(vibrationResponse('pacinian-corpuscle', 250, 1)).toBeGreaterThan(vibrationResponse('pacinian-corpuscle', 30, 1));
  });

  it('pressure step: RA units fire at on and off only; SA units sustain firing', () => {
    const step = { onMs: 100, offMs: 1100 };
    for (const ra of ['meissner-corpuscle', 'pacinian-corpuscle'] as const) {
      expect(stepResponse(ra, 50, step)).toBe(0);
      expect(stepResponse(ra, 100, step)).toBe(1);
      expect(stepResponse(ra, 900, step)).toBeLessThan(0.01);
      expect(stepResponse(ra, 1101, step)).toBeGreaterThan(0.3);
    }
    for (const sa of ['merkel-discs', 'ruffini-ending'] as const) {
      expect(stepResponse(sa, 900, step)).toBeGreaterThan(0.4);
      expect(stepResponse(sa, 1300, step)).toBeLessThan(0.01);
    }
    expect(stepResponse('pacinian-corpuscle', 130, step)).toBeLessThan(stepResponse('meissner-corpuscle', 130, step));
    expect(stepResponseSeries('merkel-discs', 1000, 10, step)).toHaveLength(101);
  });
});

describe('sensation: dermatomes', () => {
  it('lists C2–S5 in order (29 levels, no C1)', () => {
    expect(DERMATOMES).toHaveLength(29);
    expect(DERMATOME_IDS[0]).toBe('C2');
    expect(DERMATOME_IDS[DERMATOME_IDS.length - 1]).toBe('S5');
    expect(DERMATOME_IDS).not.toContain('C1');
    expect(dermatomeIndex('T1')).toBe(dermatomeIndex('C8') + 1);
  });

  it('key landmarks: C6 thumb, C7 middle finger, T4 nipple, T10 umbilicus, L4 medial leg, S1 lateral foot', () => {
    expect(dermatomeForLandmark('thumb')).toBe('C6');
    expect(dermatomeForLandmark('middle-finger')).toBe('C7');
    expect(dermatomeForLandmark('little-finger')).toBe('C8');
    expect(dermatomeForLandmark('nipple')).toBe('T4');
    expect(dermatomeForLandmark('xiphoid')).toBe('T6');
    expect(dermatomeForLandmark('umbilicus')).toBe('T10');
    expect(dermatomeForLandmark('knee')).toBe('L3');
    expect(dermatomeForLandmark('medial-leg')).toBe('L4');
    expect(dermatomeForLandmark('big-toe')).toBe('L5');
    expect(dermatomeForLandmark('lateral-foot')).toBe('S1');
    expect(getDermatome('C6').keyPoint).toMatch(/thumb/i);
    expect(getDermatome('T10').keyPoint).toMatch(/umbilicus/i);
  });

  it('a complete injury at T10 loses T11 and below', () => {
    const lost = dermatomesBelow('T10');
    expect(lost[0]).toBe('T11');
    expect(lost).toContain('S5');
    expect(lost).not.toContain('T10');
  });
});

describe('sensation: temperature and pain', () => {
  it('TRPV1 opens above 43 °C, TRPM8 below 25 °C', () => {
    expect(activeTrpChannels(45)).toContain('TRPV1');
    expect(activeTrpChannels(40)).not.toContain('TRPV1');
    expect(activeTrpChannels(20)).toContain('TRPM8');
    expect(activeTrpChannels(30)).not.toContain('TRPM8');
    expect(activeTrpChannels(10)).toContain('TRPA1');
    expect(activeTrpChannels(55)).toContain('TRPV2');
  });

  it('thermal sensation bands', () => {
    expect(thermalSensation(33)).toBe('neutral');
    expect(thermalSensation(20)).toBe('cold');
    expect(thermalSensation(10)).toBe('noxious-cold');
    expect(thermalSensation(38)).toBe('warm');
    expect(thermalSensation(46)).toBe('heat-pain');
  });
});

// ===============================================================================================
// photo.ts
// ===============================================================================================

describe('photo: UV spectrum and index', () => {
  it('UV bands and the CIE erythema action spectrum', () => {
    expect(uvBand(254)).toBe('UVC');
    expect(uvBand(300)).toBe('UVB');
    expect(uvBand(365)).toBe('UVA');
    expect(erythemaActionSpectrum(290)).toBe(1);
    expect(erythemaActionSpectrum(298)).toBe(1);
    expect(erythemaActionSpectrum(308)).toBeCloseTo(10 ** -0.94, 6);
    expect(erythemaActionSpectrum(400)).toBeCloseTo(10 ** (0.015 * -260), 9);
    expect(erythemaActionSpectrum(450)).toBe(0);
    expect(erythemaActionSpectrum(300) / erythemaActionSpectrum(360)).toBeGreaterThan(100);
  });

  it('UV index ↔ irradiance and WHO categories', () => {
    expect(erythemalIrradianceWm2(10)).toBeCloseTo(0.25, 9);
    expect(uvIndexCategory(1).category).toBe('low');
    expect(uvIndexCategory(4).category).toBe('moderate');
    expect(uvIndexCategory(7).category).toBe('high');
    expect(uvIndexCategory(9).category).toBe('very-high');
    expect(uvIndexCategory(12).category).toBe('extreme');
  });

  it('clear-sky noon UV index ≈ 12.5 with the sun overhead, lower at high latitude and in winter', () => {
    const decl = 23.44 * Math.sin((2 * Math.PI * (284 + 172)) / 365);
    expect(clearSkyNoonUvIndex(decl, 172)).toBeCloseTo(12.5, 1);
    expect(clearSkyNoonUvIndex(52, 172)).toBeLessThan(clearSkyNoonUvIndex(20, 172));
    expect(clearSkyNoonUvIndex(52, 355)).toBeLessThan(clearSkyNoonUvIndex(52, 172) / 3);
    expect(clearSkyNoonUvIndex(52, 172, 250)).toBeGreaterThan(clearSkyNoonUvIndex(52, 172, 350));
  });
});

describe('photo: Fitzpatrick types, sunburn, vitamin D', () => {
  it('MED rises from type I to VI', () => {
    for (let i = 1; i < FITZPATRICK_TYPES.length; i++) {
      expect(PHOTOTYPES[FITZPATRICK_TYPES[i]!].medJPerM2).toBeGreaterThan(PHOTOTYPES[FITZPATRICK_TYPES[i - 1]!].medJPerM2);
    }
  });

  it('type I burns faster than type VI; type II at UVI 10 in ≈ 17 min', () => {
    expect(minutesToErythema('I', 8)).toBeLessThan(minutesToErythema('VI', 8));
    expect(minutesToErythema('II', 10)).toBeCloseTo(250 / 0.25 / 60, 9);
    expect(minutesToErythema('II', 0)).toBe(Infinity);
    expect(minutesToErythema('III', 6)).toBeGreaterThan(minutesToErythema('III', 10));
  });

  it('SPF 30 multiplies the time to erythema by 30; thin application gives less', () => {
    expect(minutesToErythema('II', 10, 30) / minutesToErythema('II', 10)).toBeCloseTo(30, 9);
    expect(minutesToErythema('II', 10, 30, 0.5)).toBeLessThan(minutesToErythema('II', 10, 30));
    expect(dosesInMed('II', 10, minutesToErythema('II', 10))).toBeCloseTo(1, 9);
    expect(sunburnGrade(0.5)).toBe('none');
    expect(sunburnGrade(3)).toBe('moderate');
    expect(sunburnGrade(5)).toBe('severe-blistering');
  });

  it('vitamin D: 1 MED to the whole body ≈ 15 000 IU; less with less skin, darker skin or shorter time', () => {
    const t = minutesToErythema('II', 6);
    expect(vitaminDEstimateIU('II', 6, t, 1)).toBeCloseTo(15000, 6);
    expect(vitaminDEstimateIU('II', 6, t, 0.25)).toBeCloseTo(3750, 6);
    expect(vitaminDEstimateIU('VI', 6, 15, 0.25)).toBeLessThan(vitaminDEstimateIU('II', 6, 15, 0.25));
    expect(vitaminDEstimateIU('II', 6, 4 * t, 1)).toBeLessThan(15000 * 1.3); // saturates
  });

  it('vitamin D winter at high latitude, good season in the tropics', () => {
    expect(vitaminDSeason(52, 15).season).toBe('negligible'); // mid-January, 52 °N
    expect(vitaminDSeason(52, 172).season).toBe('good');
    expect(vitaminDSeason(0, 80).season).toBe('good');
    expect(noonSolarElevationDeg(0, 80)).toBeGreaterThan(85);
  });
});

describe('photo: ageing and disorders', () => {
  it('ageing table covers 20s to 80s; collagen falls and turnover slows with age', () => {
    expect(AGEING_BY_DECADE.map((a) => a.decade)).toEqual([20, 30, 40, 50, 60, 70, 80]);
    expect(relativeCollagen(20)).toBe(1);
    expect(relativeCollagen(70)).toBeCloseTo(0.5, 9);
    expect(epidermalTurnoverDays(25)).toBe(28);
    expect(epidermalTurnoverDays(80)).toBeGreaterThan(40);
  });

  it('disorder cards reference real structures', () => {
    expect(Object.keys(DISORDERS)).toHaveLength(7);
    for (const d of Object.values(DISORDERS)) for (const s of d.structures) expect(STRUCTURE_IDS.has(s)).toBe(true);
    expect(DISORDERS.melanoma.structures).toContain('melanocytes');
    expect(DISORDERS.acne.structures).toContain('sebaceous-gland');
  });

  it('ABCDE: benign mole → low; one feature → moderate; evolving or ≥ 2 features → high', () => {
    const benign = abcdeCheck({ asymmetric: false, irregularBorder: false, colourCount: 1, diameterMm: 4, evolving: false });
    expect(benign.count).toBe(0);
    expect(benign.concern).toBe('low');
    const big = abcdeCheck({ asymmetric: false, irregularBorder: false, colourCount: 1, diameterMm: 7, evolving: false });
    expect(big.flags.D).toBe(true);
    expect(big.concern).toBe('moderate');
    expect(abcdeCheck({ asymmetric: false, irregularBorder: false, colourCount: 1, diameterMm: 6, evolving: false }).flags.D).toBe(false);
    const changing = abcdeCheck({ asymmetric: false, irregularBorder: false, colourCount: 1, diameterMm: 3, evolving: true });
    expect(changing.concern).toBe('high');
    const all = abcdeCheck({ asymmetric: true, irregularBorder: true, colourCount: 3, diameterMm: 9, evolving: true });
    expect(all.flags).toEqual({ A: true, B: true, C: true, D: true, E: true });
    expect(all.count).toBe(5);
    expect(all.reasons).toHaveLength(5);
    expect(abcdeCheck({ asymmetric: true, irregularBorder: false, colourCount: 2, diameterMm: 5, evolving: false }).concern).toBe('high');
  });
});
