/**
 * Settings of the simulation modes (Temperature, Wounds, Touch, Life), kept in the lab state so a tour
 * step can set them through its `params` and every learner action stays a pure, testable update.
 * Values that change every frame (the running heat balance) live in `live.ts` instead.
 */
import type { StepParams } from '../contract/schema';
import type { BodyParams, Environment } from '../skin/thermo';
import { HEALING_FACTORS, BODY_REGION_IDS, BURN_DEPTHS, type BodyRegionId, type BurnDepthId, type HealingFactorId, type WoundTypeId } from '../skin/wounds';
import { RECEPTOR_IDS, TWO_POINT_THRESHOLD_MM, DERMATOME_IDS, LANDMARK_DERMATOME, type BodySiteId, type DermatomeId, type LandmarkId, type ReceptorId } from '../skin/sensation';
import { DISORDERS, FITZPATRICK_TYPES, type DisorderId, type FitzpatrickType } from '../skin/photo';

export type TouchView = 'receptors' | 'vibration' | 'pressure' | 'two-point' | 'dermatomes' | 'thermal';
export type WoundView = 'healing' | 'burns';
export type LifeView = 'sun' | 'age' | 'disorders';
export type TbsaChartId = 'adult' | 'child' | 'lund';
export type PaintMode = 'region' | 'palm';

export const TOUCH_VIEWS: { id: TouchView; label: string }[] = [
  { id: 'receptors', label: 'Receptors' }, { id: 'vibration', label: 'Vibration' }, { id: 'pressure', label: 'Pressure' },
  { id: 'two-point', label: 'Two-point' }, { id: 'dermatomes', label: 'Dermatomes' }, { id: 'thermal', label: 'Heat & pain' },
];
export const WOUND_VIEWS: { id: WoundView; label: string }[] = [{ id: 'healing', label: 'Wound healing' }, { id: 'burns', label: 'Burns' }];
export const LIFE_VIEWS: { id: LifeView; label: string }[] = [{ id: 'sun', label: 'Sun' }, { id: 'age', label: 'Ageing' }, { id: 'disorders', label: 'Disorders' }];

export interface Lesion { asymmetry: number; border: number; colours: number; diameterMm: number; evolving: boolean }

export interface Sim {
  // Temperature
  tempPreset: string;
  airC: number;
  humidity: number;
  windMs: number;
  /** Extra mean radiant temperature from sunshine, K. */
  sunK: number;
  clo: number;
  met: number;
  water: boolean;
  waterC: number;
  /** Fever: rise of the hypothalamic set point, K. */
  feverK: number;
  /** Simulated minutes per real second. */
  speed: number;
  /** See-through block with the effectors in full colour. */
  xray: boolean;
  /** Restart counter. */
  thermoRun: number;
  // Wounds
  woundView: WoundView;
  woundType: WoundTypeId;
  day: number;
  factors: HealingFactorId[];
  burnDepth: BurnDepthId;
  burnRegions: Partial<Record<BodyRegionId, number>>;
  /** Palm-sized (≈ 1 % TBSA) burns painted on the body: x, y, z (m) per patch. */
  palmSpots: number[];
  paintMode: PaintMode;
  chart: TbsaChartId;
  ageYears: number;
  weightKg: number;
  // Touch
  touchView: TouchView;
  receptor: ReceptorId;
  vibHz: number;
  vibUm: number;
  site: BodySiteId;
  separationMm: number;
  dermatome: DermatomeId | null;
  landmark: LandmarkId | null;
  thermalC: number;
  painM: number;
  // Life
  lifeView: LifeView;
  uvIndex: number;
  phototype: FitzpatrickType;
  spf: number;
  sunMinutes: number;
  latitude: number;
  month: number;
  exposed: number;
  age: number;
  photoaged: boolean;
  disorder: DisorderId;
  lesion: Lesion;
}

/** Temperature scenarios (approximate conditions for teaching). */
export const TEMP_PRESETS: { id: string; label: string; patch: Partial<Sim> }[] = [
  { id: 'office', label: 'Cool office', patch: { airC: 21, humidity: 45, windMs: 0.1, sunK: 0, clo: 1.0, met: 1.2, water: false, feverK: 0 } },
  { id: 'desert', label: 'Hot dry desert', patch: { airC: 42, humidity: 12, windMs: 2, sunK: 18, clo: 0.5, met: 2.0, water: false, feverK: 0 } },
  { id: 'humid', label: 'Hot humid', patch: { airC: 35, humidity: 85, windMs: 0.3, sunK: 0, clo: 0.3, met: 1.5, water: false, feverK: 0 } },
  { id: 'cold-wind', label: 'Cold wind', patch: { airC: -5, humidity: 60, windMs: 8, sunK: 0, clo: 1.0, met: 1.5, water: false, feverK: 0 } },
  { id: 'cold-water', label: 'Cold water', patch: { airC: 12, humidity: 80, windMs: 1, sunK: 0, clo: 0.1, met: 1.5, water: true, waterC: 12, feverK: 0 } },
  { id: 'marathon', label: 'Marathon', patch: { airC: 24, humidity: 55, windMs: 3.5, sunK: 8, clo: 0.2, met: 10, water: false, feverK: 0 } },
  { id: 'fever', label: 'Fever', patch: { airC: 22, humidity: 45, windMs: 0.1, sunK: 0, clo: 1.0, met: 1.0, water: false, feverK: 2 } },
];

export const DEFAULT_LESION: Lesion = { asymmetry: 0.1, border: 0.1, colours: 1, diameterMm: 4, evolving: false };

export function defaultSim(): Sim {
  return {
    tempPreset: 'office', airC: 21, humidity: 45, windMs: 0.1, sunK: 0, clo: 1.0, met: 1.2, water: false, waterC: 15, feverK: 0, speed: 2, xray: true, thermoRun: 0,
    woundView: 'healing', woundType: 'incision', day: 1, factors: [], burnDepth: 'superficial-partial', burnRegions: {}, palmSpots: [], paintMode: 'region', chart: 'adult', ageYears: 30, weightKg: 70,
    touchView: 'receptors', receptor: 'meissner-corpuscle', vibHz: 30, vibUm: 20, site: 'fingertip', separationMm: 5, dermatome: null, landmark: null, thermalC: 33, painM: 1.0,
    lifeView: 'sun', uvIndex: 7, phototype: 'II', spf: 1, sunMinutes: 30, latitude: 51, month: 6, exposed: 0.25, age: 30, photoaged: false, disorder: 'psoriasis', lesion: { ...DEFAULT_LESION },
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

const FACTOR_IDS = HEALING_FACTORS.map((f) => f.id);
const DEPTH_IDS = BURN_DEPTHS.map((b) => b.id);
const SITE_IDS = Object.keys(TWO_POINT_THRESHOLD_MM) as BodySiteId[];
const LANDMARK_IDS = Object.keys(LANDMARK_DERMATOME) as LandmarkId[];
const DISORDER_IDS = Object.keys(DISORDERS) as DisorderId[];

/** "diabetes,smoking" or an array → valid healing factors. */
export function parseFactors(v: unknown): HealingFactorId[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return [...new Set(list.map((x) => String(x).trim()).filter((x): x is HealingFactorId => (FACTOR_IDS as string[]).includes(x)))];
}
/** "arm-left:1,trunk-anterior:0.5" or a record → burned fraction per region (0 … 1). */
export function parseRegions(v: unknown): Partial<Record<BodyRegionId, number>> {
  const out: Partial<Record<BodyRegionId, number>> = {};
  const entries: [string, unknown][] = typeof v === 'string'
    ? v.split(',').filter(Boolean).map((e) => { const [k, f] = e.split(':'); return [String(k).trim(), f === undefined ? 1 : Number(f)]; })
    : v && typeof v === 'object' ? Object.entries(v) : [];
  for (const [k, f] of entries) {
    if (!(BODY_REGION_IDS as string[]).includes(k)) continue;
    const x = num(f, 0, 1, 0);
    if (x > 0) out[k as BodyRegionId] = x;
  }
  return out;
}

/**
 * Apply a patch of settings, keeping every value in range (unknown keys and wrong types are
 * ignored). Used both for learner actions and for a tour step's `params`. A temperature preset id
 * applies that preset's conditions first.
 */
export function patchSim(sim: Sim, p: Partial<Sim> | StepParams): Sim {
  const q = p as Record<string, unknown>;
  let out: Sim = { ...sim };
  if ('tempPreset' in q && typeof q.tempPreset === 'string') {
    const pre = TEMP_PRESETS.find((t) => t.id === q.tempPreset);
    out.tempPreset = pre ? pre.id : 'custom';
    if (pre) out = { ...out, ...pre.patch };
  }
  if ('airC' in q) out.airC = num(q.airC, -20, 50, out.airC);
  if ('humidity' in q) out.humidity = num(q.humidity, 5, 100, out.humidity);
  if ('windMs' in q) out.windMs = num(q.windMs, 0, 15, out.windMs);
  if ('sunK' in q) out.sunK = num(q.sunK, 0, 30, out.sunK);
  if ('clo' in q) out.clo = num(q.clo, 0, 4, out.clo);
  if ('met' in q) out.met = num(q.met, 0.7, 12, out.met);
  if ('water' in q) out.water = bool(q.water, out.water);
  if ('waterC' in q) out.waterC = num(q.waterC, 0, 40, out.waterC);
  if ('feverK' in q) out.feverK = num(q.feverK, 0, 3, out.feverK);
  if ('speed' in q) out.speed = num(q.speed, 0.25, 30, out.speed);
  if ('xray' in q) out.xray = bool(q.xray, out.xray);
  if ('thermoRun' in q) out.thermoRun = num(q.thermoRun, 0, 1e9, out.thermoRun);

  if ('woundView' in q) out.woundView = oneOf(q.woundView, ['healing', 'burns'] as const, out.woundView);
  if ('woundType' in q) out.woundType = oneOf(q.woundType, ['incision', 'graze', 'deep'] as const, out.woundType);
  if ('day' in q) out.day = num(q.day, 0, 730, out.day);
  if ('factors' in q) out.factors = parseFactors(q.factors);
  if ('burnDepth' in q) out.burnDepth = oneOf(q.burnDepth, DEPTH_IDS, out.burnDepth);
  if ('burnRegions' in q) out.burnRegions = parseRegions(q.burnRegions);
  if ('palmSpots' in q && Array.isArray(q.palmSpots)) { const a = q.palmSpots.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)); out.palmSpots = a.slice(0, a.length - (a.length % 3)).slice(0, 300); }
  if ('paintMode' in q) out.paintMode = oneOf(q.paintMode, ['region', 'palm'] as const, out.paintMode);
  if ('chart' in q) out.chart = oneOf(q.chart, ['adult', 'child', 'lund'] as const, out.chart);
  if ('ageYears' in q) out.ageYears = num(q.ageYears, 0, 90, out.ageYears);
  if ('weightKg' in q) out.weightKg = num(q.weightKg, 3, 200, out.weightKg);

  if ('touchView' in q) out.touchView = oneOf(q.touchView, TOUCH_VIEWS.map((t) => t.id), out.touchView);
  if ('receptor' in q) out.receptor = oneOf(q.receptor, RECEPTOR_IDS, out.receptor);
  if ('vibHz' in q) out.vibHz = num(q.vibHz, 1, 1000, out.vibHz);
  if ('vibUm' in q) out.vibUm = num(q.vibUm, 0.05, 1000, out.vibUm);
  if ('site' in q) out.site = oneOf(q.site, SITE_IDS, out.site);
  if ('separationMm' in q) out.separationMm = num(q.separationMm, 0.5, 80, out.separationMm);
  if ('dermatome' in q) out.dermatome = q.dermatome === null ? null : oneOf(q.dermatome, DERMATOME_IDS, out.dermatome ?? 'C6');
  if ('landmark' in q) {
    out.landmark = q.landmark === null ? null : oneOf(q.landmark, LANDMARK_IDS, out.landmark ?? 'thumb');
    if (out.landmark) out.dermatome = LANDMARK_DERMATOME[out.landmark];
  }
  if ('thermalC' in q) out.thermalC = num(q.thermalC, 0, 55, out.thermalC);
  if ('painM' in q) out.painM = num(q.painM, 0.1, 1.5, out.painM);

  if ('lifeView' in q) out.lifeView = oneOf(q.lifeView, ['sun', 'age', 'disorders'] as const, out.lifeView);
  if ('uvIndex' in q) out.uvIndex = num(q.uvIndex, 0, 14, out.uvIndex);
  if ('phototype' in q) out.phototype = oneOf(q.phototype, FITZPATRICK_TYPES, out.phototype);
  if ('spf' in q) out.spf = num(q.spf, 1, 100, out.spf);
  if ('sunMinutes' in q) out.sunMinutes = num(q.sunMinutes, 0, 480, out.sunMinutes);
  if ('latitude' in q) out.latitude = num(q.latitude, -70, 70, out.latitude);
  if ('month' in q) out.month = Math.round(num(q.month, 1, 12, out.month));
  if ('exposed' in q) out.exposed = num(q.exposed, 0, 1, out.exposed);
  if ('age' in q) out.age = num(q.age, 20, 90, out.age);
  if ('photoaged' in q) out.photoaged = bool(q.photoaged, out.photoaged);
  if ('disorder' in q) out.disorder = oneOf(q.disorder, DISORDER_IDS, out.disorder);
  if ('lesion' in q && q.lesion && typeof q.lesion === 'object') {
    const l = q.lesion as Partial<Lesion>;
    out.lesion = {
      asymmetry: num(l.asymmetry, 0, 1, out.lesion.asymmetry), border: num(l.border, 0, 1, out.lesion.border),
      colours: Math.round(num(l.colours, 1, 6, out.lesion.colours)), diameterMm: num(l.diameterMm, 1, 20, out.lesion.diameterMm),
      evolving: bool(l.evolving, out.lesion.evolving),
    };
  }
  if ('lesionPreset' in q) out.lesion = q.lesionPreset === 'melanoma' ? { asymmetry: 0.8, border: 0.75, colours: 4, diameterMm: 9, evolving: true } : { ...DEFAULT_LESION };
  return out;
}

/** The heat-exchange environment the Temperature settings describe. Immersion is to the neck (≈ 90 % of the surface). */
export function thermoEnvironment(s: Pick<Sim, 'airC' | 'humidity' | 'windMs' | 'sunK' | 'water' | 'waterC'>): Environment {
  return {
    airTempC: s.airC, radiantTempC: s.airC + s.sunK, relHumidityPct: s.humidity, windMs: s.windMs,
    ...(s.water ? { contact: { fraction: 0.9, tempC: s.waterC, medium: 'water' as const } } : {}),
  };
}
/** The body parameters the Temperature settings describe (70 kg, 1.75 m adult). */
export function thermoBody(s: Pick<Sim, 'clo' | 'met' | 'feverK'>): Partial<BodyParams> {
  return { clo: s.clo, met: s.met, setPointShiftC: s.feverK, efficiency: s.met >= 5 ? 0.1 : 0 };
}

/** Day of the year in the middle of a month (1–12). */
export const midMonthDay = (month: number) => Math.round(15 + 30.44 * (clamp(Math.round(month), 1, 12) - 1));
