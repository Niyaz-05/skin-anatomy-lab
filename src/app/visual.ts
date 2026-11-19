/**
 * How the simulations are drawn: pure mappings from the science to pictures (vessel calibre, sweat
 * drops, the filling of a wound, skin tones, spike trains, a lesion outline), so the 3D scene and the
 * panels agree and the mappings are unit-tested. Exaggerations are stated where they are used.
 */
import { HEALING_PHASES, phaseTiming, healingDelayFactor, woundStateOnDay, type HealingFactorId, type WoundTypeId } from '../skin/wounds';
import { twoPointProbability, type BodySiteId } from '../skin/sensation';
import type { FitzpatrickType } from '../skin/photo';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** A small deterministic random generator (mulberry32), so trials and particles repeat exactly. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Temperature
// ---------------------------------------------------------------------------------------------

/** Neutral, fully constricted and fully dilated skin blood flow for a 1.85 m² adult, L/min (Gagge form; thermo.ts). */
export const SKBF = { neutral: 0.2, min: 0.0154, max: 7.5 } as const;

/** Vessel calibre signal −1 (fully constricted) … 0 (neutral) … +1 (fully dilated), on a log scale of skin blood flow. */
export function vesselDilation(skbfLpm: number): number {
  const f = Math.max(1e-4, skbfLpm);
  if (f >= SKBF.neutral) return clamp(Math.log(f / SKBF.neutral) / Math.log(SKBF.max / SKBF.neutral), 0, 1);
  return -clamp(Math.log(SKBF.neutral / f) / Math.log(SKBF.neutral / SKBF.min), 0, 1);
}

/** Sweat drops per second leaving each drawn pore (0 when not sweating; the real rate is far higher per gland). */
export function sweatDropsPerS(sweatLph: number): number {
  return sweatLph <= 0.01 ? 0 : clamp(0.6 + 4 * Math.sqrt(sweatLph), 0, 6);
}

/** A thermal-camera colour for a temperature, °C (blue 20 … green 28 … yellow 33 … red 38 … white 42+). */
export function thermalColour(tC: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [18, [0.12, 0.1, 0.45]], [24, [0.15, 0.35, 0.85]], [28, [0.1, 0.7, 0.65]], [31, [0.45, 0.82, 0.25]],
    [33.5, [0.98, 0.85, 0.2]], [36, [0.95, 0.45, 0.12]], [38.5, [0.85, 0.12, 0.12]], [42, [1, 0.92, 0.9]],
  ];
  if (tC <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!, [t0, c0] = stops[i - 1]!;
    if (tC <= t1) { const k = (tC - t0) / (t1 - t0); return [c0[0] + k * (c1[0] - c0[0]), c0[1] + k * (c1[1] - c0[1]), c0[2] + k * (c1[2] - c0[2])]; }
  }
  return stops[stops.length - 1]![1];
}

/**
 * Local skin temperature at a body point, °C: the mean skin temperature, cooler towards the hands
 * and feet when they are vasoconstricted (arteriovenous anastomoses shut) and closer to the mean
 * when dilated. `distal` is 0 on the trunk … 1 at the fingertips and toes. Illustrative.
 */
export function localSkinC(meanSkinC: number, coreC: number, dilation: number, distal: number): number {
  const constricted = Math.max(0, -dilation);
  const drop = distal * (1.5 + 7 * constricted) * clamp((coreC - meanSkinC) / 4, 0.3, 1.5);
  return meanSkinC + 0.6 * (1 - distal) - drop + Math.max(0, dilation) * distal * 1.2;
}

/** Time as text: "45 s", "12 min", "2.5 h". */
export function formatSimMinutes(min: number): string {
  if (min < 1) return `${Math.round(min * 60)} s`;
  if (min < 90) return `${Math.round(min)} min`;
  return `${(min / 60).toFixed(min < 600 ? 1 : 0)} h`;
}

// ---------------------------------------------------------------------------------------------
// Wounds
// ---------------------------------------------------------------------------------------------

/** Slider position 0…1000 ↔ days after injury on a log scale, 0 … 730 days (2 years). */
const DAY_LOG = Math.log10(730 * 24 + 1);
export const dayFromSlider = (v: number) => (10 ** ((clamp(v, 0, 1000) / 1000) * DAY_LOG) - 1) / 24;
export const sliderFromDay = (d: number) => Math.round((1000 * Math.log10(clamp(d, 0, 730) * 24 + 1)) / DAY_LOG);

/** Days as text: "30 min", "6 h", "3 days", "2 weeks", "4 months", "1.5 years". */
export function formatDay(day: number): string {
  const h = day * 24;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 36) return `${Math.round(h)} h`;
  if (day < 14) return `${Math.round(day)} days`;
  if (day < 60) return `${Math.round(day / 7)} weeks`;
  if (day < 547) return `${Math.round(day / 30.4)} months`;
  return `${+(day / 365).toFixed(1)} years`;
}

/** Shape of each wound in the block, mm: centre x, half-width at the surface, depth, profile exponent (1 = V, small = flat-bottomed). */
export const WOUND_SHAPE: Record<WoundTypeId, { x0: number; halfWidth: number; depth: number; exponent: number }> = {
  incision: { x0: -0.3, halfWidth: 0.07, depth: 1.6, exponent: 1 },
  graze: { x0: -1.2, halfWidth: 1.2, depth: 0.24, exponent: 0.12 },
  deep: { x0: -0.3, halfWidth: 0.9, depth: 3.0, exponent: 0.45 },
};

export interface WoundFill {
  /** Clot or scab still present, 0…1. */
  clot: number;
  /** Granulation tissue grown up from the base, as a fraction of the depth, 0…1. */
  granulation: number;
  /** Surface re-epithelialised, 0…1. */
  epithelium: number;
  /** Scar maturity: red granulation → pale, flat, organised scar, 0…1. */
  scar: number;
  /** Width of the gap relative to the first day (wound contraction), 0…1. */
  gap: number;
}

/** How full the wound is on a day: clot → granulation → epithelial closure → scar (from wounds.ts timing). */
export function woundFill(day: number, type: WoundTypeId, factors: HealingFactorId[] = []): WoundFill {
  const k = healingDelayFactor(factors);
  const st = woundStateOnDay(day, type, factors);
  const prol = phaseTiming(HEALING_PHASES[2]!, type, k), rem = phaseTiming(HEALING_PHASES[3]!, type, k);
  const closeDay = { incision: 2, graze: 10, deep: 35 }[type] * k;
  const granulation = smooth(prol.start * 0.5, Math.max(closeDay, prol.peak) * 0.4, day);
  return {
    clot: day <= 0 ? 1 : clamp(1 - granulation * 0.9 - st.closurePercent / 100 * 0.6, 0, 1),
    granulation,
    epithelium: st.closurePercent / 100,
    scar: smooth(rem.start * 0.8, rem.start + 150 * Math.max(1, k * WOUND_SHAPE_TIME[type]), day),
    gap: type === 'deep' ? 1 - 0.6 * smooth(4 * k, 40 * k, day) : 1,
  };
}
const WOUND_SHAPE_TIME: Record<WoundTypeId, number> = { incision: 1, graze: 0.6, deep: 2.5 };

// ---------------------------------------------------------------------------------------------
// Touch
// ---------------------------------------------------------------------------------------------

/** Slider 0…1000 ↔ vibration frequency 1 … 1000 Hz (log). */
export const hzFromSlider = (v: number) => 10 ** ((3 * clamp(v, 0, 1000)) / 1000);
export const sliderFromHz = (f: number) => Math.round((1000 * Math.log10(clamp(f, 1, 1000))) / 3);
/** Slider 0…1000 ↔ amplitude 0.05 … 1000 µm (log). */
export const umFromSlider = (v: number) => 0.05 * 20000 ** (clamp(v, 0, 1000) / 1000);
export const sliderFromUm = (u: number) => Math.round((1000 * Math.log(clamp(u, 0.05, 1000) / 0.05)) / Math.log(20000));

/** Frequency of the pulsing drawn in 3D, Hz: slow enough to see (0.8 … 4 Hz, rising with the real frequency). */
export const pulseHz = (freqHz: number) => 0.8 + 3.2 * clamp(Math.log10(freqHz) / 3, 0, 1);

/**
 * Spike times (ms) from a normalised firing-rate series: an integrate-and-fire neuron with a little
 * seeded jitter, so a rate of 1 fires at `maxRate` spikes per second.
 */
export function spikeTimes(series: readonly { tMs: number; rate: number }[], maxRateHz: number, seed = 1): number[] {
  const r = rng(seed);
  const out: number[] = [];
  let acc = r() * 0.5;
  for (let i = 1; i < series.length; i++) {
    const dt = series[i]!.tMs - series[i - 1]!.tMs;
    acc += (series[i]!.rate * maxRateHz * dt) / 1000;
    while (acc >= 1) { acc -= 1 + (r() - 0.5) * 0.3; out.push(series[i]!.tMs - r() * dt); }
  }
  return out;
}

/** One trial of the two-point test: true when the (simulated) person reports two points. Deterministic for a trial number. */
export function twoPointTrial(site: BodySiteId, separationMm: number, trial: number): boolean {
  return rng(trial * 7919 + 13)() < twoPointProbability(site, separationMm);
}

// ---------------------------------------------------------------------------------------------
// Life
// ---------------------------------------------------------------------------------------------

/** Typical constitutive skin colours by Fitzpatrick type (illustrative sRGB). */
export const SKIN_TONES: Record<FitzpatrickType, string> = { I: '#f3d2c1', II: '#e8b99f', III: '#d49e7c', IV: '#b57a55', V: '#8a5638', VI: '#5a3624' };

const hex = (c: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as [number, number, number];
const toHex = (c: [number, number, number]) => `#${c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
/** Skin tone of a phototype reddened by an erythemal dose in MEDs (redness shows less on darker skin). */
export function skinTone(type: FitzpatrickType, med = 0): string {
  const base = hex(SKIN_TONES[type]);
  const show = { I: 1, II: 0.95, III: 0.8, IV: 0.55, V: 0.3, VI: 0.15 }[type];
  const k = clamp((med - 0.5) / 3, 0, 1) * 0.6 * show;
  const red: [number, number, number] = [0.86, 0.3, 0.27];
  return toHex([0, 1, 2].map((i) => base[i]! + k * (red[i]! - base[i]!)) as [number, number, number]);
}
/** Melanin in the basal layer and keratinocytes, 0 (type I) … 1 (type VI). */
export const melaninLevel = (type: FitzpatrickType) => ({ I: 0.05, II: 0.15, III: 0.35, IV: 0.55, V: 0.78, VI: 1 })[type];
/** Erythema drawn in the block, 0…1, from the dose in MEDs (1 MED = just pink). */
export const erythemaLevel = (med: number) => clamp((med - 0.6) / 3, 0, 1);

/**
 * Outline of a pigmented lesion for the ABCDE checker, as an SVG path centred on (cx, cy): asymmetry
 * stretches one side, border irregularity adds notches and ragged edges. Radius in px.
 */
export function lesionPath(cx: number, cy: number, radius: number, asymmetry: number, border: number, seed = 3): string {
  const r = rng(seed);
  const phases = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
  const n = 96;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const a = 1 + asymmetry * (0.32 * Math.cos(t - phases[0]!) + 0.16 * Math.cos(2 * t + phases[1]!));
    const b = 1 + border * (0.09 * Math.sin(7 * t + phases[2]!) + 0.06 * Math.sin(13 * t + phases[3]!) + 0.05 * Math.sin(23 * t));
    const rr = radius * a * b / (1 + asymmetry * 0.2);
    pts.push(`${i ? 'L' : 'M'} ${(cx + rr * Math.cos(t)).toFixed(1)} ${(cy + rr * Math.sin(t)).toFixed(1)}`);
  }
  return `${pts.join(' ')} Z`;
}
/** Lesion features as booleans for abcdeCheck: asymmetric above 0.3, irregular border above 0.35. */
export const lesionFlags = (asymmetry: number, border: number) => ({ asymmetric: asymmetry > 0.3, irregularBorder: border > 0.35 });

/** Minutes as text: "45 s", "17 min", "8 h", "more than a day". */
export function formatMinutes(min: number): string {
  if (!Number.isFinite(min)) return 'never';
  if (min <= 0) return 'none';
  if (min >= 60 * 24) return 'more than a day';
  if (min >= 60) return `${+(min / 60).toFixed(min >= 600 ? 0 : 1)} h`;
  if (min >= 1) return `${Math.round(min)} min`;
  return `${Math.max(1, Math.round(min * 60))} s`;
}
