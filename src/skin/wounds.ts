/**
 * Wound healing and burns for the skin lab: the four overlapping phases of repair with their cells
 * and day-by-day events for an incision (primary intention), a graze (re-epithelialisation from the
 * appendages) and a deep open wound (secondary intention); the recovery of tensile strength; factors
 * that delay healing; burn depth by the skin layer reached; total body surface area (TBSA) by Wallace's
 * rule of nines (adult and child) or the Lund–Browder chart; and the Parkland fluid formula. Pure
 * functions, no DOM. Structure ids are those of docs/STRUCTURES.md.
 *
 * EDUCATIONAL ONLY — not for the assessment or treatment of real patients.
 *
 * Main sources: Gurtner GC, Werner S, Barrandon Y & Longaker MT (2008) Wound repair and regeneration,
 * Nature 453:314–321; Kumar V, Abbas AK & Aster JC (2018) Robbins Basic Pathology, 10th ed., ch. 3
 * "Inflammation and Repair"; OpenStax Anatomy & Physiology 2e (2022) ch. 5 §5.4 (diseases, disorders
 * and injuries of the integumentary system: burns, scars); Wallace AB (1951) The exposure treatment of
 * burns, Lancet 1:501–504; Lund CC & Browder NC (1944) Surg Gynecol Obstet 79:352–358; Baxter CR &
 * Shires T (1968) Ann NY Acad Sci 150:874 (Parkland formula); Levenson SM et al. (1965) Ann Surg
 * 161:293 (wound tensile strength); Jeschke MG et al. (2020) Burn injury, Nat Rev Dis Primers 6:11.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------------------------
// Healing phases
// ---------------------------------------------------------------------------------------------

export type HealingPhaseId = 'haemostasis' | 'inflammation' | 'proliferation' | 'remodelling';

export interface HealingPhase {
  id: HealingPhaseId;
  label: string;
  /** Typical onset after injury, days. */
  startDay: number;
  /** Typical end, days (phases overlap). */
  endDay: number;
  /** Day of peak activity. */
  peakDay: number;
  /** Text range for display. */
  span: string;
  cells: string[];
  events: string[];
  mediators: string[];
}

/**
 * The four overlapping phases (Gurtner 2008; Robbins 10e ch. 3). Times are those for a clean
 * incision in healthy skin; secondary intention stretches proliferation and remodelling.
 */
export const HEALING_PHASES: HealingPhase[] = [
  {
    id: 'haemostasis', label: 'Haemostasis', startDay: 0, endDay: 0.25, peakDay: 0.01, span: 'seconds to hours',
    cells: ['platelets', 'erythrocytes'],
    events: [
      'Reflex vasoconstriction of the injured dermal vessels (seconds).',
      'Platelets adhere to exposed collagen (via von Willebrand factor) and aggregate into a plug.',
      'The coagulation cascade converts fibrinogen to fibrin; the fibrin clot seals the wound and is the provisional matrix for cells.',
      'Platelet α-granules release PDGF and TGF-β, calling in inflammatory cells and fibroblasts.',
    ],
    mediators: ['thromboxane A2', 'thrombin', 'PDGF', 'TGF-β', 'fibrin'],
  },
  {
    id: 'inflammation', label: 'Inflammation', startDay: 0.05, endDay: 4, peakDay: 1.5, span: 'hours to ~3 days',
    cells: ['neutrophils', 'macrophages', 'mast cells', 'lymphocytes'],
    events: [
      'Vasodilation and leaky venules: redness, heat, swelling and pain around the wound.',
      'Neutrophils arrive within hours and peak at 1–2 days, killing bacteria and clearing debris.',
      'Monocytes become macrophages (peak ≈ 2–3 days): they phagocytose dead neutrophils and switch from pro-inflammatory (M1) to reparative (M2) signalling.',
      'Macrophage growth factors (PDGF, TGF-β, VEGF, FGF) start the proliferative phase.',
    ],
    mediators: ['histamine', 'IL-1', 'TNF', 'IL-8 (CXCL8)', 'complement C5a'],
  },
  {
    id: 'proliferation', label: 'Proliferation (new tissue)', startDay: 2, endDay: 21, peakDay: 7, span: '~3 days to 3 weeks',
    cells: ['keratinocytes', 'fibroblasts', 'endothelial cells', 'myofibroblasts', 'macrophages'],
    events: [
      'Re-epithelialisation: keratinocytes at the edges and from hair follicles and sweat ducts loosen and migrate over the wound bed under the scab.',
      'Angiogenesis: VEGF-driven capillary sprouts make pink, granular granulation tissue (peaks ≈ day 5–7).',
      'Fibroblasts proliferate and lay down type III collagen and ground substance (proteoglycans, fibronectin).',
      'Myofibroblasts (α-smooth-muscle actin) contract the wound and pull its edges together.',
    ],
    mediators: ['VEGF', 'FGF-2', 'EGF', 'KGF (FGF-7)', 'TGF-β', 'PDGF'],
  },
  {
    id: 'remodelling', label: 'Remodelling (maturation)', startDay: 21, endDay: 730, peakDay: 60, span: '~3 weeks to 1–2 years',
    cells: ['fibroblasts', 'myofibroblasts (apoptosis)'],
    events: [
      'Type III collagen is replaced by stronger, more organised type I collagen with cross-links.',
      'Matrix metalloproteinases and their inhibitors (TIMPs) balance synthesis and breakdown.',
      'Capillaries regress and myofibroblasts die by apoptosis: the scar turns from red to pale and flat.',
      'Tensile strength rises to a plateau of only ≈ 70–80 % of unwounded skin; hair follicles and sweat glands are not regenerated in the scar.',
    ],
    mediators: ['MMPs', 'TIMPs', 'TGF-β', 'lysyl oxidase'],
  },
];

export type WoundTypeId = 'incision' | 'graze' | 'deep';

export interface WoundType {
  id: WoundTypeId;
  label: string;
  intention: 'primary' | 'regeneration' | 'secondary';
  description: string;
  /** Deepest layer reached (structure id). */
  deepestLayer: string;
  /** Layers injured (structure ids, superficial → deep). */
  layers: string[];
  /** Day by which the surface is fully re-epithelialised. */
  closureDay: number;
  /** Time-scale factor applied to proliferation and remodelling relative to an incision. */
  timeScale: number;
  scar: string;
}

export const WOUND_TYPES: Record<WoundTypeId, WoundType> = {
  incision: {
    id: 'incision', label: 'Clean sutured incision', intention: 'primary',
    description: 'A clean cut with its edges brought together (sutures, staples, glue). Little tissue is lost, so only a thin bridge of granulation tissue forms.',
    deepestLayer: 'reticular-dermis',
    layers: ['stratum-corneum', 'stratum-granulosum', 'stratum-spinosum', 'stratum-basale', 'papillary-dermis', 'reticular-dermis'],
    closureDay: 2, timeScale: 1,
    scar: 'Fine linear scar.',
  },
  graze: {
    id: 'graze', label: 'Graze (abrasion)', intention: 'regeneration',
    description: 'Loss of the epidermis and at most the papillary dermis. Keratinocytes from the wound edge and from the hair follicles and sweat ducts left in the dermis resurface it under a scab.',
    deepestLayer: 'papillary-dermis',
    layers: ['stratum-corneum', 'stratum-granulosum', 'stratum-spinosum', 'stratum-basale', 'papillary-dermis'],
    closureDay: 10, timeScale: 0.6,
    scar: 'Usually none; temporary pink or pigment change.',
  },
  deep: {
    id: 'deep', label: 'Deep open wound', intention: 'secondary',
    description: 'A gaping wound with tissue loss through the dermis into the subcutaneous fat (e.g. ulcer, excised abscess, laceration left open). It fills from the base with granulation tissue and closes mainly by contraction.',
    deepestLayer: 'subcutaneous-fat',
    layers: ['stratum-corneum', 'stratum-granulosum', 'stratum-spinosum', 'stratum-basale', 'papillary-dermis', 'reticular-dermis', 'subcutaneous-fat'],
    closureDay: 35, timeScale: 2.5,
    scar: 'Wide scar; risk of hypertrophic scar and contracture.',
  },
};

/** Day-stamped events for each wound type (on top of the generic phase events). */
export const WOUND_EVENTS: Record<WoundTypeId, { day: number; text: string }[]> = {
  incision: [
    { day: 0, text: 'Clot fills the narrow incision; sutures appose the edges.' },
    { day: 1, text: 'Neutrophils at the margins; basal keratinocytes migrate along the cut dermal edges.' },
    { day: 2, text: 'Epidermis bridges the incision (24–48 h): the wound is sealed.' },
    { day: 3, text: 'Macrophages replace neutrophils; granulation tissue invades the incision space.' },
    { day: 5, text: 'Incision space filled with granulation tissue; collagen fibrils bridge the cut.' },
    { day: 7, text: 'Sutures often removed: strength only ≈ 10 % of unwounded skin.' },
    { day: 14, text: 'Collagen accumulating, inflammation and vascularity receding.' },
    { day: 30, text: 'Scar of cellular connective tissue largely free of inflammation, covered by intact epidermis.' },
    { day: 90, text: 'Strength ≈ 70–80 % of normal — the plateau.' },
  ],
  graze: [
    { day: 0, text: 'Oozing of serum and blood from dermal capillary loops; a scab (dried exudate) forms.' },
    { day: 1, text: 'Neutrophils clear dirt and bacteria; keratinocytes start to migrate from the edges and from follicles and sweat ducts.' },
    { day: 3, text: 'Islands of new epidermis spread from each hair follicle opening.' },
    { day: 7, text: 'Most of the surface resurfaced; the scab loosens.' },
    { day: 10, text: 'Scab shed; thin pink epidermis, usually no scar.' },
    { day: 28, text: 'Epidermis fully stratified; pigment returns to normal over weeks to months.' },
  ],
  deep: [
    { day: 0, text: 'Large clot and fibrin-rich exudate fill the defect.' },
    { day: 2, text: 'Intense inflammation with abundant neutrophils; dead tissue (slough) must be cleared.' },
    { day: 5, text: 'Red, granular granulation tissue grows up from the base.' },
    { day: 10, text: 'Myofibroblasts contract the wound: its area shrinks markedly.' },
    { day: 21, text: 'Granulation tissue fills the defect; epithelium creeps in from the edges.' },
    { day: 35, text: 'Surface finally re-epithelialised.' },
    { day: 120, text: 'Wide, initially red and raised scar matures; no hair follicles or sweat glands.' },
  ],
};

/** Smooth phase envelope 0…1: rises from onset to peak, decays to ≈ 0 by the end (piecewise cosine in time). */
function envelope(day: number, start: number, peak: number, end: number): number {
  if (day < start || day > end) return 0;
  if (day <= peak) return peak === start ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * (day - start)) / (peak - start));
  return 0.5 + 0.5 * Math.cos((Math.PI * (day - peak)) / (end - peak));
}

/** Phase timing for a wound type, days: proliferation and remodelling stretch by the type's time scale. */
export function phaseTiming(phase: HealingPhase, type: WoundTypeId, delayFactor = 1): { start: number; peak: number; end: number } {
  const k = phase.id === 'haemostasis' || phase.id === 'inflammation' ? 1 : WOUND_TYPES[type].timeScale * delayFactor;
  const inflK = phase.id === 'inflammation' ? Math.max(1, delayFactor) * (type === 'deep' ? 1.5 : 1) : 1;
  return { start: phase.startDay * k, peak: phase.peakDay * k * inflK, end: phase.endDay * k * inflK };
}

/** Relative activity (0…1) of each healing phase on a given day for a wound type. */
export function phaseActivity(day: number, type: WoundTypeId = 'incision', delayFactor = 1): Record<HealingPhaseId, number> {
  const out = {} as Record<HealingPhaseId, number>;
  for (const ph of HEALING_PHASES) {
    const t = phaseTiming(ph, type, delayFactor);
    out[ph.id] = envelope(day, t.start, t.peak, t.end);
  }
  return out;
}

export type HealingCell = 'platelets' | 'neutrophils' | 'macrophages' | 'lymphocytes' | 'fibroblasts' | 'endothelial' | 'keratinocytes' | 'myofibroblasts';

/**
 * Relative abundance (0…1) of the key cells on a day (Gurtner 2008 fig. 1; Robbins 10e): platelets
 * minutes–hours, neutrophils peak ≈ 1–2 d, macrophages ≈ 2–3 d, lymphocytes ≈ 5–7 d, fibroblasts and
 * endothelial sprouts ≈ 5–10 d, migrating keratinocytes until closure, myofibroblasts in contracting wounds.
 */
export function cellActivity(day: number, type: WoundTypeId = 'incision', delayFactor = 1): Record<HealingCell, number> {
  const w = WOUND_TYPES[type];
  const k = w.timeScale * delayFactor;
  const infl = (type === 'deep' ? 1.5 : 1) * Math.max(1, delayFactor);
  const contraction = type === 'deep' ? 1 : type === 'incision' ? 0.3 : 0.1;
  return {
    platelets: envelope(day, 0, 0.005, 0.5),
    neutrophils: envelope(day, 0.05, 1.5 * infl, 5 * infl),
    macrophages: envelope(day, 0.5, 2.5 * infl, 14 * k),
    lymphocytes: envelope(day, 2, 6 * infl, 20 * k),
    fibroblasts: envelope(day, 2, 8 * k, 60 * k),
    endothelial: envelope(day, 2, 6 * k, 30 * k),
    keratinocytes: envelope(day, 0.3, Math.max(0.6, w.closureDay * delayFactor * 0.4), w.closureDay * delayFactor * 1.3),
    myofibroblasts: contraction * envelope(day, 3 * delayFactor, 10 * delayFactor, 30 * k),
  };
}

/** Fraction of the surface re-epithelialised (0–100 %) on a day — a smooth S-curve reaching 100 % at closure. */
export function closurePercent(day: number, type: WoundTypeId = 'incision', delayFactor = 1): number {
  const t = clamp(day / (WOUND_TYPES[type].closureDay * delayFactor), 0, 1);
  return 100 * t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------
// Tensile strength
// ---------------------------------------------------------------------------------------------

/**
 * Tensile strength of a healing incision as % of unwounded skin (Robbins 10e ch. 3; Levenson 1965):
 * ≈ 10 % at 1 week (suture removal), ≈ 20 % at 3 weeks, ≈ 70–80 % by 3 months, then a plateau that
 * never exceeds ≈ 80 %. Knots: [day, %]. Day 365 value approximate.
 */
export const TENSILE_STRENGTH_KNOTS: [number, number][] = [[0, 0], [7, 10], [21, 20], [42, 45], [90, 75], [365, 80]];
/** Maximum strength ever regained, % of unwounded skin. */
export const MAX_SCAR_STRENGTH_PCT = 80;

/** Monotone cubic (Fritsch–Carlson) interpolation through knots. */
function monotoneCubic(knots: [number, number][], x: number): number {
  const n = knots.length;
  if (x <= knots[0]![0]) return knots[0]![1];
  if (x >= knots[n - 1]![0]) return knots[n - 1]![1];
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(knots[i + 1]![0] - knots[i]![0]);
    m.push((knots[i + 1]![1] - knots[i]![1]) / dx[i]!);
  }
  const t: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1]! * m[i]! <= 0 ? 0 : (3 * (dx[i - 1]! + dx[i]!)) / ((2 * dx[i]! + dx[i - 1]!) / m[i - 1]! + (dx[i]! + 2 * dx[i - 1]!) / m[i]!));
  t.push(m[n - 2]!);
  let i = 0;
  while (x > knots[i + 1]![0]) i++;
  const h = dx[i]!, s = (x - knots[i]![0]) / h;
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  return h00 * knots[i]![1] + h10 * h * t[i]! + h01 * knots[i + 1]![1] + h11 * h * t[i + 1]!;
}

/**
 * Tensile strength, % of unwounded skin, `day` days after a clean incision; `delayFactor` > 1 stretches
 * the time axis for impaired healing (illustrative). Monotone, 0 at day 0, plateau 80 %.
 */
export function tensileStrengthPercent(day: number, delayFactor = 1): number {
  if (day <= 0) return 0;
  return clamp(monotoneCubic(TENSILE_STRENGTH_KNOTS, day / Math.max(1, delayFactor)), 0, MAX_SCAR_STRENGTH_PCT);
}

// ---------------------------------------------------------------------------------------------
// Factors that delay healing
// ---------------------------------------------------------------------------------------------

export type HealingFactorId =
  | 'infection' | 'diabetes' | 'ischaemia' | 'smoking' | 'malnutrition' | 'vitamin-c-deficiency' | 'glucocorticoids'
  | 'old-age' | 'foreign-body' | 'mechanical-stress' | 'radiation' | 'venous-insufficiency' | 'obesity' | 'chemotherapy';

export interface HealingFactor {
  id: HealingFactorId;
  label: string;
  mechanism: string;
  /**
   * Illustrative time-stretch factor for the lab's animation (≥ 1). NOT clinical data — real effects
   * vary enormously; values chosen only to rank severity plausibly.
   */
  delay: number;
}

/** Local and systemic factors that impair repair (Robbins 10e ch. 3; Guo S & DiPietro LA 2010 J Dent Res 89:219). */
export const HEALING_FACTORS: HealingFactor[] = [
  { id: 'infection', label: 'Infection', mechanism: 'Prolongs inflammation; bacterial proteases and toxins destroy matrix and growth factors.', delay: 1.6 },
  { id: 'diabetes', label: 'Diabetes mellitus', mechanism: 'Microangiopathy, neuropathy, impaired neutrophil function and glycated matrix; chronic foot ulcers.', delay: 1.8 },
  { id: 'ischaemia', label: 'Poor blood supply', mechanism: 'Atherosclerosis or pressure starve the wound of oxygen, needed for collagen hydroxylation and bacterial killing.', delay: 2.0 },
  { id: 'smoking', label: 'Smoking', mechanism: 'Nicotine vasoconstriction and carbon monoxide reduce tissue oxygen.', delay: 1.3 },
  { id: 'malnutrition', label: 'Protein malnutrition', mechanism: 'Too little amino acid substrate for collagen and cell proliferation.', delay: 1.5 },
  { id: 'vitamin-c-deficiency', label: 'Vitamin C deficiency (scurvy)', mechanism: 'Prolyl and lysyl hydroxylases need ascorbate: unstable collagen, old scars can reopen.', delay: 1.7 },
  { id: 'glucocorticoids', label: 'Glucocorticoids', mechanism: 'Anti-inflammatory: fewer macrophages, less TGF-β and collagen, weaker scar.', delay: 1.5 },
  { id: 'old-age', label: 'Old age', mechanism: 'Slower keratinocyte migration and fibroblast response, thinner dermis, more comorbidity.', delay: 1.3 },
  { id: 'foreign-body', label: 'Foreign body', mechanism: 'Dirt, glass or suture material sustain inflammation and harbour bacteria.', delay: 1.4 },
  { id: 'mechanical-stress', label: 'Movement / tension', mechanism: 'Early motion or tension across the wound pulls edges apart (dehiscence) and widens the scar.', delay: 1.2 },
  { id: 'radiation', label: 'Radiotherapy', mechanism: 'Endarteritis and fibroblast damage leave poorly vascularised, fibrotic tissue.', delay: 1.6 },
  { id: 'venous-insufficiency', label: 'Venous insufficiency', mechanism: 'Venous hypertension, oedema and fibrin cuffs: chronic leg ulcers.', delay: 1.8 },
  { id: 'obesity', label: 'Obesity', mechanism: 'Poorly perfused adipose tissue, tension and higher infection risk.', delay: 1.2 },
  { id: 'chemotherapy', label: 'Chemotherapy', mechanism: 'Antiproliferative drugs suppress fibroblasts, endothelium and keratinocytes.', delay: 1.5 },
];

/** Combined illustrative delay factor for a set of factors (product, capped at 4). */
export function healingDelayFactor(factors: HealingFactorId[]): number {
  let k = 1;
  for (const id of new Set(factors)) k *= HEALING_FACTORS.find((f) => f.id === id)?.delay ?? 1;
  return Math.min(4, k);
}

export interface WoundStateOnDay {
  day: number;
  type: WoundTypeId;
  phases: Record<HealingPhaseId, number>;
  dominantPhase: HealingPhaseId;
  cells: Record<HealingCell, number>;
  closurePercent: number;
  tensileStrengthPercent: number;
  /** Events that have happened by this day (wound-specific). */
  events: { day: number; text: string }[];
}

/** Everything the lab needs to animate a wound on a given day after injury. */
export function woundStateOnDay(day: number, type: WoundTypeId = 'incision', factors: HealingFactorId[] = []): WoundStateOnDay {
  const k = healingDelayFactor(factors);
  const phases = phaseActivity(day, type, k);
  let dominantPhase: HealingPhaseId = 'haemostasis', best = -1;
  for (const ph of HEALING_PHASES) if (phases[ph.id] > best) { best = phases[ph.id]; dominantPhase = ph.id; }
  if (best <= 0) dominantPhase = day > 1 ? 'remodelling' : 'haemostasis';
  const strengthScale = type === 'incision' ? 1 : WOUND_TYPES[type].timeScale;
  return {
    day, type, phases, dominantPhase,
    cells: cellActivity(day, type, k),
    closurePercent: closurePercent(day, type, k),
    tensileStrengthPercent: tensileStrengthPercent(day, k * strengthScale),
    events: WOUND_EVENTS[type].filter((e) => e.day <= day / k),
  };
}

// ---------------------------------------------------------------------------------------------
// Burns: depth
// ---------------------------------------------------------------------------------------------

export type BurnDepthId = 'superficial' | 'superficial-partial' | 'deep-partial' | 'full-thickness' | 'fourth-degree';

export interface BurnDepth {
  id: BurnDepthId;
  label: string;
  /** Traditional "degree". */
  degree: 1 | 2 | 3 | 4;
  /** Deepest layer reached (structure id). */
  deepestLayer: string;
  layers: string;
  colour: string;
  blanching: string;
  blisters: boolean;
  pain: string;
  healing: string;
  /** Typical healing time, days [min, max] (null = will not heal without surgery). */
  healingDays: [number, number] | null;
  scarring: string;
  grafting: 'no' | 'sometimes' | 'yes';
  example: string;
  /** Counts towards %TBSA for fluid resuscitation (superficial/epidermal burns do not). */
  countsForTbsa: boolean;
}

/** Burn depth classification (OpenStax A&P 2e §5.4; Jeschke 2020 Nat Rev Dis Primers; standard burns teaching). */
export const BURN_DEPTHS: BurnDepth[] = [
  {
    id: 'superficial', label: 'Superficial (epidermal)', degree: 1, deepestLayer: 'stratum-basale', layers: 'Epidermis only',
    colour: 'Red, dry', blanching: 'Blanches, brisk refill', blisters: false, pain: 'Painful, tender',
    healing: 'Peels and heals in about a week', healingDays: [3, 7], scarring: 'None', grafting: 'no',
    example: 'Sunburn, brief scald', countsForTbsa: false,
  },
  {
    id: 'superficial-partial', label: 'Superficial partial thickness', degree: 2, deepestLayer: 'papillary-dermis', layers: 'Epidermis and papillary dermis',
    colour: 'Pink to red, moist, weeping', blanching: 'Blanches, brisk refill', blisters: true, pain: 'Very painful (nerve endings exposed)',
    healing: 'Re-epithelialises from hair follicles and sweat glands', healingDays: [7, 21], scarring: 'Minimal; pigment change possible', grafting: 'no',
    example: 'Scald from hot water', countsForTbsa: true,
  },
  {
    id: 'deep-partial', label: 'Deep partial thickness', degree: 2, deepestLayer: 'reticular-dermis', layers: 'Into the reticular dermis',
    colour: 'Blotchy red and white, drier', blanching: 'Sluggish or absent refill', blisters: true, pain: 'Reduced; pressure sensation only',
    healing: 'Slow, from the few surviving appendages', healingDays: [21, 60], scarring: 'Hypertrophic scarring and contracture likely', grafting: 'sometimes',
    example: 'Hot oil, flame, prolonged scald', countsForTbsa: true,
  },
  {
    id: 'full-thickness', label: 'Full thickness', degree: 3, deepestLayer: 'subcutaneous-fat', layers: 'Whole dermis destroyed, into the hypodermis',
    colour: 'White, waxy, leathery, brown or charred (eschar)', blanching: 'Does not blanch', blisters: false, pain: 'Painless — nerve endings destroyed',
    healing: 'Cannot regenerate; only contraction and ingrowth from the edges', healingDays: null, scarring: 'Severe; contractures', grafting: 'yes',
    example: 'Flame, electrical, chemical burns', countsForTbsa: true,
  },
  {
    id: 'fourth-degree', label: 'Fourth degree', degree: 4, deepestLayer: 'deep-fascia', layers: 'Through skin and fat into fascia, muscle or bone',
    colour: 'Black, charred, exposed deep tissue', blanching: 'Does not blanch', blisters: false, pain: 'Painless locally',
    healing: 'Needs debridement, reconstruction, sometimes amputation', healingDays: null, scarring: 'Severe; loss of function', grafting: 'yes',
    example: 'High-voltage electrical injury, prolonged flame contact', countsForTbsa: true,
  },
];

const LAYER_TO_DEPTH: Record<string, BurnDepthId> = {
  'stratum-corneum': 'superficial', 'stratum-lucidum': 'superficial', 'stratum-granulosum': 'superficial',
  'stratum-spinosum': 'superficial', 'stratum-basale': 'superficial', melanocytes: 'superficial', 'langerhans-cells': 'superficial',
  'papillary-dermis': 'superficial-partial',
  'reticular-dermis': 'deep-partial', 'collagen-bundles': 'deep-partial',
  'subcutaneous-fat': 'full-thickness',
  'deep-fascia': 'fourth-degree',
};

/** Burn depth from the deepest skin layer destroyed (structure ids). Unknown ids return null. */
export function burnDepthFromLayer(deepestLayerId: string): BurnDepth | null {
  const id = LAYER_TO_DEPTH[deepestLayerId];
  return id ? getBurnDepth(id) : null;
}

/**
 * Typical layer boundaries of THIN skin (e.g. forearm), mm below the surface: epidermis ≈ 0.1 mm,
 * papillary dermis to ≈ 0.4 mm, reticular dermis to ≈ 2 mm, hypodermis to ≈ 10 mm (very variable).
 * Thick skin of palms and soles has a 0.5–1.5 mm epidermis; the back has a dermis up to 3–4 mm.
 * Approximate (OpenStax A&P 2e ch. 5).
 */
export const THIN_SKIN_LAYER_BOTTOM_MM = { epidermis: 0.1, papillaryDermis: 0.4, reticularDermis: 2.0, hypodermis: 10 } as const;

/** Burn depth from the depth of tissue destruction, mm, using thin-skin layer boundaries. */
export function burnDepthFromMm(depthMm: number, layers: { epidermis: number; papillaryDermis: number; reticularDermis: number; hypodermis: number } = THIN_SKIN_LAYER_BOTTOM_MM): BurnDepth {
  const d = Math.max(0, depthMm);
  if (d <= layers.epidermis) return getBurnDepth('superficial');
  if (d <= layers.papillaryDermis) return getBurnDepth('superficial-partial');
  if (d <= layers.reticularDermis) return getBurnDepth('deep-partial');
  if (d <= layers.hypodermis) return getBurnDepth('full-thickness');
  return getBurnDepth('fourth-degree');
}

export function getBurnDepth(id: BurnDepthId): BurnDepth {
  return BURN_DEPTHS.find((b) => b.id === id)!;
}

// ---------------------------------------------------------------------------------------------
// Burns: area (%TBSA)
// ---------------------------------------------------------------------------------------------

/** Body regions used for %TBSA (matching the body-regions anchors of the body scene). */
export type BodyRegionId = 'head-neck' | 'arm-left' | 'arm-right' | 'trunk-anterior' | 'trunk-posterior' | 'leg-left' | 'leg-right' | 'perineum';
export const BODY_REGION_IDS: BodyRegionId[] = ['head-neck', 'arm-left', 'arm-right', 'trunk-anterior', 'trunk-posterior', 'leg-left', 'leg-right', 'perineum'];

/**
 * Wallace's rule of nines for adults (Wallace 1951): head and neck 9, each upper limb 9, anterior
 * trunk 18, posterior trunk 18, each lower limb 18, perineum 1 — total 100 %.
 */
export const RULE_OF_NINES_ADULT: Record<BodyRegionId, number> = {
  'head-neck': 9, 'arm-left': 9, 'arm-right': 9, 'trunk-anterior': 18, 'trunk-posterior': 18, 'leg-left': 18, 'leg-right': 18, perineum: 1,
};

/**
 * Paediatric (infant) rule of nines: a child's head is relatively larger and the legs smaller —
 * head and neck 18, each upper limb 9, anterior and posterior trunk 18 each, each lower limb 13.5,
 * perineum 1 (some versions use 14 per leg with no separate perineum). Add 1 % to the legs and take
 * 1 % from the head per year of age over 1 until adult proportions; better, use Lund–Browder.
 */
export const RULE_OF_NINES_CHILD: Record<BodyRegionId, number> = {
  'head-neck': 18, 'arm-left': 9, 'arm-right': 9, 'trunk-anterior': 18, 'trunk-posterior': 18, 'leg-left': 13.5, 'leg-right': 13.5, perineum: 1,
};

/** The patient's palm including the fingers ≈ 1 % TBSA (≈ 0.8 % without fingers) — for small or scattered burns. */
export const PALM_PERCENT_TBSA = 1;

/**
 * Lund–Browder age-dependent parts, % TBSA (Lund & Browder 1944, as reproduced in burns texts;
 * values from memory — approximate): A = ½ of head, B = ½ of one thigh, C = ½ of one lower leg.
 * Each row sums with the fixed parts to 100 %.
 */
export const LUND_BROWDER_AGE_TABLE: { ageYears: number; A: number; B: number; C: number }[] = [
  { ageYears: 0, A: 9.5, B: 2.75, C: 2.5 },
  { ageYears: 1, A: 8.5, B: 3.25, C: 2.5 },
  { ageYears: 5, A: 6.5, B: 4.0, C: 2.75 },
  { ageYears: 10, A: 5.5, B: 4.25, C: 3.0 },
  { ageYears: 15, A: 4.5, B: 4.5, C: 3.25 },
  { ageYears: 18, A: 3.5, B: 4.75, C: 3.5 },
];
/** Lund–Browder fixed parts, % TBSA (both surfaces): neck 2, each upper arm 4, forearm 3, hand 2.5, foot 3.5, anterior trunk 13, posterior trunk 13, each buttock 2.5, genitalia 1. */
export const LUND_BROWDER_FIXED = { neck: 2, upperArm: 4, forearm: 3, hand: 2.5, foot: 3.5, trunkAnterior: 13, trunkPosterior: 13, buttock: 2.5, genitalia: 1 } as const;

/** Lund–Browder region percentages for an age (linear interpolation between table rows), mapped to the lab's 8 regions. */
export function lundBrowder(ageYears: number): Record<BodyRegionId, number> {
  const t = LUND_BROWDER_AGE_TABLE;
  const a = clamp(ageYears, 0, t[t.length - 1]!.ageYears);
  let i = 0;
  while (i < t.length - 2 && a > t[i + 1]!.ageYears) i++;
  const r0 = t[i]!, r1 = t[i + 1]!, f = (a - r0.ageYears) / (r1.ageYears - r0.ageYears);
  const A = r0.A + f * (r1.A - r0.A), B = r0.B + f * (r1.B - r0.B), C = r0.C + f * (r1.C - r0.C);
  const F = LUND_BROWDER_FIXED;
  const arm = F.upperArm + F.forearm + F.hand;
  const leg = 2 * B + 2 * C + F.foot;
  return {
    'head-neck': 2 * A + F.neck, 'arm-left': arm, 'arm-right': arm, 'trunk-anterior': F.trunkAnterior,
    'trunk-posterior': F.trunkPosterior + 2 * F.buttock, 'leg-left': leg, 'leg-right': leg, perineum: F.genitalia,
  };
}

export type TbsaChart = 'adult' | 'child' | { lundBrowderAgeYears: number };

/** Region percentages for a chart. */
export function regionPercents(chart: TbsaChart = 'adult'): Record<BodyRegionId, number> {
  if (chart === 'adult') return RULE_OF_NINES_ADULT;
  if (chart === 'child') return RULE_OF_NINES_CHILD;
  return lundBrowder(chart.lundBrowderAgeYears);
}

export interface BurnArea {
  region: BodyRegionId;
  /** Fraction of that region burned (0…1; 1 = whole region). */
  fraction: number;
  depth: BurnDepthId;
}

export interface TbsaResult {
  /** All burned area, % TBSA. */
  totalPercent: number;
  /** Partial- and full-thickness area only (superficial erythema excluded), % TBSA — the figure used for fluids. */
  countedPercent: number;
  byRegion: Partial<Record<BodyRegionId, number>>;
}

/**
 * % TBSA of burns from region selections, plus any number of scattered palm-sized areas (each ≈ 1 %).
 * Superficial (epidermal) burns are reported but excluded from the counted figure. Clamped to 100 %.
 */
export function burnTbsa(areas: BurnArea[], chart: TbsaChart = 'adult', palms: { count: number; depth: BurnDepthId }[] = []): TbsaResult {
  const pct = regionPercents(chart);
  let total = 0, counted = 0;
  const byRegion: Partial<Record<BodyRegionId, number>> = {};
  for (const a of areas) {
    const v = pct[a.region] * clamp(a.fraction, 0, 1);
    byRegion[a.region] = (byRegion[a.region] ?? 0) + v;
    total += v;
    if (getBurnDepth(a.depth).countsForTbsa) counted += v;
  }
  for (const p of palms) {
    const v = Math.max(0, p.count) * PALM_PERCENT_TBSA;
    total += v;
    if (getBurnDepth(p.depth).countsForTbsa) counted += v;
  }
  return { totalPercent: Math.min(100, total), countedPercent: Math.min(100, counted), byRegion };
}

// ---------------------------------------------------------------------------------------------
// Parkland formula
// ---------------------------------------------------------------------------------------------

export interface ParklandResult {
  /** Crystalloid (Hartmann's / Ringer's lactate) for the first 24 h, mL. */
  total24hMl: number;
  /** Half in the first 8 h FROM THE TIME OF THE BURN, mL. */
  first8hMl: number;
  /** The other half over the next 16 h, mL. */
  next16hMl: number;
  first8hRateMlPerH: number;
  next16hRateMlPerH: number;
  /** Urine-output target, mL/h (0.5 mL/kg/h adult; 1 mL/kg/h child). */
  urineTargetMlPerH: number;
  /** Whether formal resuscitation is usually indicated (> 15 % adult, > 10 % child TBSA; UK practice). */
  indicated: boolean;
  note: string;
}

/**
 * Parkland formula (Baxter & Shires 1968): 4 mL × body mass (kg) × % TBSA of crystalloid in the first
 * 24 h, half in the first 8 h after the burn and half over the next 16 h. 70 kg, 20 % → 5600 mL
 * (2800 mL in 8 h = 350 mL/h, then 175 mL/h). It is only a starting estimate: infusion is titrated to
 * urine output, and over-resuscitation ("fluid creep") is harmful. Some guidelines (ATLS 10th ed.)
 * now start at 2 mL/kg/%TBSA for adult thermal burns. EDUCATIONAL ONLY.
 */
export function parkland(weightKg: number, tbsaPercent: number, opts: { child?: boolean; mlPerKgPerPct?: number } = {}): ParklandResult {
  const k = opts.mlPerKgPerPct ?? 4;
  const w = Math.max(0, weightKg), pct = clamp(tbsaPercent, 0, 100);
  const total = k * w * pct;
  return {
    total24hMl: total,
    first8hMl: total / 2,
    next16hMl: total / 2,
    first8hRateMlPerH: total / 2 / 8,
    next16hRateMlPerH: total / 2 / 16,
    urineTargetMlPerH: (opts.child ? 1 : 0.5) * w,
    indicated: pct > (opts.child ? 10 : 15),
    note: 'Educational estimate only. Timed from the burn, not from arrival; children also need maintenance fluid with glucose. Titrate to urine output and clinical response.',
  };
}
