/**
 * Cutaneous sensation for the skin lab: the mechanoreceptor and free-ending table, afferent fibre
 * classes and conduction times, two-point discrimination by body region, vibration tuning curves
 * (Meissner ≈ 30 Hz, Pacinian ≈ 250 Hz), the response of rapidly and slowly adapting receptors to a
 * pressure step, the dermatome map C2–S5 with its ISNCSCI key sensory points, and the thermosensitive
 * TRP channels behind warmth, cold, heat pain and cold pain. Pure functions, no DOM. Receptor ids are
 * those of docs/STRUCTURES.md; dermatome ids ('C2'…'S5') label the body-skin vertex groups.
 *
 * Main sources: Kandel ER et al. (2021) Principles of Neural Science, 6th ed., ch. 19 "Touch" and
 * ch. 20 "Pain"; Johansson RS & Vallbo ÅB (1979) J Physiol 286:283–300 and (1983) Trends Neurosci
 * 6:27–32 (mechanoreceptive units of the human hand); Weinstein S (1968) in Kenshalo DR (ed.) The Skin
 * Senses, pp. 195–222 (two-point thresholds); Bolanowski SJ et al. (1988) J Acoust Soc Am 84:1680
 * (four-channel model of vibrotaction); American Spinal Injury Association (2019) International
 * Standards for Neurological Classification of Spinal Cord Injury (ISNCSCI); OpenStax Anatomy &
 * Physiology 2e (2022) §14.1 (somatosensation) and §13.4 (dermatomes); Caterina MJ et al. (1997)
 * Nature 389:816 (TRPV1); McKemy DD et al. (2002) Nature 416:52 (TRPM8); Julius D (2013) Annu Rev Cell
 * Dev Biol 29:355 (TRP channels and thermosensation); Melzack R & Wall PD (1965) Science 150:971.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------------------------
// Afferent fibres
// ---------------------------------------------------------------------------------------------

export type FibreClass = 'Aα' | 'Aβ' | 'Aδ' | 'C';

export interface Fibre {
  id: FibreClass;
  myelinated: boolean;
  /** Axon diameter range, µm. */
  diameterUm: [number, number];
  /** Conduction velocity range, m/s. */
  velocityMs: [number, number];
  carries: string;
}

/** Primary afferent fibre classes (Kandel 6e ch. 18–19, table of fibre types; values approximate). */
export const FIBRES: Record<FibreClass, Fibre> = {
  'Aα': { id: 'Aα', myelinated: true, diameterUm: [12, 20], velocityMs: [72, 120], carries: 'Proprioception (muscle spindles, Golgi tendon organs) — not skin.' },
  'Aβ': { id: 'Aβ', myelinated: true, diameterUm: [6, 12], velocityMs: [36, 72], carries: 'Discriminative touch, vibration, pressure, stretch from the four low-threshold mechanoreceptors and hair follicles.' },
  'Aδ': { id: 'Aδ', myelinated: true, diameterUm: [1, 6], velocityMs: [4, 36], carries: 'Cool, sharp "first" pain, D-hair touch.' },
  C: { id: 'C', myelinated: false, diameterUm: [0.2, 1.5], velocityMs: [0.4, 2], carries: 'Warmth, dull burning "second" pain, itch, pleasant (C-tactile) touch.' },
};

/** Mean conduction velocity of a fibre class, m/s (midpoint of its range). */
export function meanVelocityMs(fibre: FibreClass): number {
  const [a, b] = FIBRES[fibre].velocityMs;
  return (a + b) / 2;
}

/** Conduction time over a distance, ms. */
export function conductionTimeMs(distanceM: number, velocityMs: number): number {
  return (1000 * Math.max(0, distanceM)) / velocityMs;
}

/**
 * First and second pain: after stubbing a toe (≈ 1–1.2 m from the spinal cord) the sharp, well-localised
 * Aδ "first pain" arrives in tens of ms, the dull, burning C-fibre "second pain" about a second later
 * (Kandel 6e ch. 20). Uses typical velocities Aδ 20 m/s and C 1 m/s (approximate).
 */
export function painArrivalMs(distanceM: number): { firstPainMs: number; secondPainMs: number; gapMs: number } {
  const firstPainMs = conductionTimeMs(distanceM, 20), secondPainMs = conductionTimeMs(distanceM, 1);
  return { firstPainMs, secondPainMs, gapMs: secondPainMs - firstPainMs };
}

// ---------------------------------------------------------------------------------------------
// Receptors
// ---------------------------------------------------------------------------------------------

export type ReceptorId = 'meissner-corpuscle' | 'merkel-discs' | 'pacinian-corpuscle' | 'ruffini-ending' | 'hair-follicle-plexus' | 'free-nerve-endings';
export type Adaptation = 'RA' | 'SA' | 'mixed';

export interface Receptor {
  id: ReceptorId;
  label: string;
  /** Afferent type in the human microneurography nomenclature (Johansson & Vallbo). */
  unitType: 'RA1 (FA I)' | 'SA1' | 'RA2 (FA II, PC)' | 'SA2' | 'hair RA' | 'nociceptor / thermoreceptor';
  adaptation: Adaptation;
  modality: string;
  /** Best-detected stimulus feature. */
  bestStimulus: string;
  /** Receptive field size. */
  receptiveField: 'small' | 'large';
  /** Typical receptive field diameter on the fingertip, mm (approximate). */
  receptiveFieldMm: [number, number];
  /** Where it lies (structure id of the layer). */
  layer: string;
  depth: string;
  fibre: FibreClass[];
  /** Units per cm² in the fingertip and palm (Johansson & Vallbo 1979; approximate). */
  densityPerCm2?: { fingertip: number; palm: number };
  /** Share of the ≈ 17 000 mechanoreceptive units of the glabrous hand, %. */
  handSharePct?: number;
  /** Vibration frequency band, Hz [low, high], and best frequency. */
  vibrationHz?: { band: [number, number]; best: number };
}

/** Cutaneous receptor table (Kandel 6e ch. 19 table 19-1 and fig. 19-3; Johansson & Vallbo 1979, 1983). */
export const RECEPTORS: Record<ReceptorId, Receptor> = {
  'meissner-corpuscle': {
    id: 'meissner-corpuscle', label: 'Meissner corpuscle', unitType: 'RA1 (FA I)', adaptation: 'RA',
    modality: 'Light touch, flutter, motion and slip of objects on the skin (grip control)',
    bestStimulus: 'Skin motion, low-frequency vibration', receptiveField: 'small', receptiveFieldMm: [3, 5],
    layer: 'papillary-dermis', depth: 'Dermal papillae, just under the epidermis of glabrous skin',
    fibre: ['Aβ'], densityPerCm2: { fingertip: 140, palm: 25 }, handSharePct: 43,
    vibrationHz: { band: [5, 50], best: 30 },
  },
  'merkel-discs': {
    id: 'merkel-discs', label: 'Merkel cell–neurite complex', unitType: 'SA1', adaptation: 'SA',
    modality: 'Sustained pressure, form, edges, curvature and texture (reading Braille)',
    bestStimulus: 'Points, edges and corners pressed into the skin', receptiveField: 'small', receptiveFieldMm: [2, 3],
    layer: 'stratum-basale', depth: 'Basal epidermis at the tips of the epidermal (rete) ridges',
    fibre: ['Aβ'], densityPerCm2: { fingertip: 70, palm: 8 }, handSharePct: 25,
    vibrationHz: { band: [0.3, 10], best: 3 },
  },
  'pacinian-corpuscle': {
    id: 'pacinian-corpuscle', label: 'Pacinian (lamellated) corpuscle', unitType: 'RA2 (FA II, PC)', adaptation: 'RA',
    modality: 'High-frequency vibration; vibrations transmitted through tools and objects',
    bestStimulus: 'Vibration ≈ 200–300 Hz (sensitive to < 10 nm skin motion)', receptiveField: 'large', receptiveFieldMm: [10, 100],
    layer: 'subcutaneous-fat', depth: 'Deep dermis and hypodermis; onion-like lamellae filter out slow pressure',
    fibre: ['Aβ'], densityPerCm2: { fingertip: 20, palm: 10 }, handSharePct: 13,
    vibrationHz: { band: [40, 1000], best: 250 },
  },
  'ruffini-ending': {
    id: 'ruffini-ending', label: 'Ruffini ending', unitType: 'SA2', adaptation: 'SA',
    modality: 'Skin stretch; hand shape and finger position (with joint and muscle receptors)',
    bestStimulus: 'Lateral stretch of the skin', receptiveField: 'large', receptiveFieldMm: [10, 50],
    layer: 'reticular-dermis', depth: 'Reticular dermis, spindle-shaped capsules aligned with collagen',
    fibre: ['Aβ'], densityPerCm2: { fingertip: 10, palm: 15 }, handSharePct: 19,
    vibrationHz: { band: [0.3, 30], best: 5 },
  },
  'hair-follicle-plexus': {
    id: 'hair-follicle-plexus', label: 'Hair follicle receptors', unitType: 'hair RA', adaptation: 'RA',
    modality: 'Hair movement: light touch, air currents, insects on hairy skin',
    bestStimulus: 'Deflection of the hair shaft', receptiveField: 'large', receptiveFieldMm: [10, 30],
    layer: 'reticular-dermis', depth: 'Lanceolate and circumferential endings around the hair follicle below the sebaceous gland',
    fibre: ['Aβ', 'Aδ', 'C'],
  },
  'free-nerve-endings': {
    id: 'free-nerve-endings', label: 'Free nerve endings', unitType: 'nociceptor / thermoreceptor', adaptation: 'mixed',
    modality: 'Pain (mechanical, thermal, chemical/polymodal), warmth, cold, itch',
    bestStimulus: 'Tissue-damaging or thermal stimuli; pruritogens (histamine)', receptiveField: 'small', receptiveFieldMm: [1, 5],
    layer: 'stratum-granulosum', depth: 'Unencapsulated terminals penetrating the epidermis up to the stratum granulosum',
    fibre: ['Aδ', 'C'],
  },
};

export const RECEPTOR_IDS = Object.keys(RECEPTORS) as ReceptorId[];

/** Approximate total of mechanoreceptive afferent units in the glabrous skin of one hand (Johansson & Vallbo 1979). */
export const HAND_MECHANORECEPTIVE_UNITS = 17000;

// ---------------------------------------------------------------------------------------------
// Two-point discrimination
// ---------------------------------------------------------------------------------------------

export type BodySiteId =
  | 'fingertip' | 'thumb' | 'lip' | 'nose' | 'cheek' | 'forehead' | 'palm' | 'hallux' | 'sole' | 'forearm' | 'upper-arm'
  | 'shoulder' | 'breast' | 'belly' | 'back' | 'thigh' | 'calf';

/**
 * Two-point discrimination thresholds, mm (Weinstein 1968; values read from his figure — approximate
 * to ±1–2 mm on the fingers and ±5 mm on the trunk and limbs). Fingertips ≈ 2–3 mm, lips ≈ 5 mm,
 * palm ≈ 10 mm, back, thigh and calf ≈ 40–45 mm. The gradient follows receptor density (Merkel and
 * Meissner units) and the size of the cortical representation (the homunculus), not skin area.
 */
export const TWO_POINT_THRESHOLD_MM: Record<BodySiteId, number> = {
  fingertip: 2.5, thumb: 3.5, lip: 5, nose: 8, cheek: 9, forehead: 15, palm: 10, hallux: 10, sole: 20,
  forearm: 35, 'upper-arm': 42, shoulder: 40, breast: 30, belly: 32, back: 40, thigh: 44, calf: 45,
};

/** Two-point threshold at a site, mm. */
export function twoPointThresholdMm(site: BodySiteId): number {
  return TWO_POINT_THRESHOLD_MM[site];
}

/**
 * Probability (0…1) of reporting "two points" for a given separation: a logistic psychometric
 * function equal to 0.5 at the threshold, with a slope proportional to it (Weber-like; slope approximate).
 */
export function twoPointProbability(site: BodySiteId, separationMm: number): number {
  const th = TWO_POINT_THRESHOLD_MM[site];
  if (separationMm <= 0) return 0;
  return 1 / (1 + Math.exp(-(separationMm - th) / (0.15 * th)));
}

/** Whether two points this far apart are perceived as two (separation ≥ threshold). */
export function feelsTwoPoints(site: BodySiteId, separationMm: number): boolean {
  return separationMm >= TWO_POINT_THRESHOLD_MM[site];
}

/** Sites sorted from finest (smallest threshold) to coarsest. */
export function sitesByAcuity(): BodySiteId[] {
  return (Object.keys(TWO_POINT_THRESHOLD_MM) as BodySiteId[]).sort((a, b) => TWO_POINT_THRESHOLD_MM[a] - TWO_POINT_THRESHOLD_MM[b]);
}

// ---------------------------------------------------------------------------------------------
// Vibration tuning
// ---------------------------------------------------------------------------------------------

export type MechanoreceptorId = 'meissner-corpuscle' | 'merkel-discs' | 'pacinian-corpuscle' | 'ruffini-ending';
export const MECHANORECEPTORS: MechanoreceptorId[] = ['meissner-corpuscle', 'merkel-discs', 'pacinian-corpuscle', 'ruffini-ending'];

/**
 * V-shaped tuning curves (threshold vs log frequency), shaped after the four psychophysical channels
 * of Bolanowski et al. (1988) and Kandel 6e fig. 19-6: best frequency, threshold there (µm peak skin
 * displacement), and slopes below/above in dB per octave. All approximate, for teaching.
 */
export const VIBRATION_TUNING: Record<MechanoreceptorId, { bestHz: number; minThresholdUm: number; slopeBelowDbPerOct: number; slopeAboveDbPerOct: number }> = {
  'meissner-corpuscle': { bestHz: 30, minThresholdUm: 5, slopeBelowDbPerOct: 6, slopeAboveDbPerOct: 12 },
  'merkel-discs': { bestHz: 3, minThresholdUm: 30, slopeBelowDbPerOct: 2, slopeAboveDbPerOct: 8 },
  'pacinian-corpuscle': { bestHz: 250, minThresholdUm: 0.1, slopeBelowDbPerOct: 12, slopeAboveDbPerOct: 10 },
  'ruffini-ending': { bestHz: 5, minThresholdUm: 40, slopeBelowDbPerOct: 3, slopeAboveDbPerOct: 6 },
};

/** Vibration detection threshold of a receptor type at a frequency, µm peak displacement. */
export function vibrationThresholdUm(receptor: MechanoreceptorId, freqHz: number): number {
  const t = VIBRATION_TUNING[receptor];
  const oct = Math.log2(Math.max(1e-3, freqHz) / t.bestHz);
  const db = oct < 0 ? -oct * t.slopeBelowDbPerOct : oct * t.slopeAboveDbPerOct;
  return t.minThresholdUm * 10 ** (db / 20);
}

/** Relative sensitivity 0…1 of a receptor at a frequency (1 at its best frequency). */
export function vibrationSensitivity(receptor: MechanoreceptorId, freqHz: number): number {
  return VIBRATION_TUNING[receptor].minThresholdUm / vibrationThresholdUm(receptor, freqHz);
}

/**
 * Response (0…1, fraction of maximal entrained firing) of a receptor to a sinusoidal vibration:
 * a sigmoid of the level above threshold in dB (half-maximal 10 dB above threshold; approximate).
 * Each spike phase-locks to the stimulus cycle, so the rate ≈ min(frequency, ~ 300–500 /s) × response.
 */
export function vibrationResponse(receptor: MechanoreceptorId, freqHz: number, amplitudeUm: number): number {
  if (amplitudeUm <= 0) return 0;
  const db = 20 * Math.log10(amplitudeUm / vibrationThresholdUm(receptor, freqHz));
  return 1 / (1 + Math.exp(-(db - 10) / 4));
}

/** The receptor with the lowest threshold — the one that "hears" a vibration first. */
export function mostSensitiveReceptor(freqHz: number): MechanoreceptorId {
  let best: MechanoreceptorId = 'meissner-corpuscle', th = Infinity;
  for (const r of MECHANORECEPTORS) {
    const v = vibrationThresholdUm(r, freqHz);
    if (v < th) { th = v; best = r; }
  }
  return best;
}

/** Best (lowest-threshold) frequency of a receptor found by scanning 0.5–1000 Hz on a log grid. */
export function bestFrequencyHz(receptor: MechanoreceptorId): number {
  let best = 1, th = Infinity;
  for (let i = 0; i <= 400; i++) {
    const f = 0.5 * 2000 ** (i / 400);
    const v = vibrationThresholdUm(receptor, f);
    if (v < th) { th = v; best = f; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Pressure step: rapid vs slow adaptation
// ---------------------------------------------------------------------------------------------

/** Adaptation time constants and sustained fractions for the step response (approximate; Kandel 6e fig. 19-4). */
export const STEP_RESPONSE: Record<MechanoreceptorId | 'hair-follicle-plexus', { onTauMs: number; sustained: number; offBurst: number; offTauMs: number }> = {
  'meissner-corpuscle': { onTauMs: 30, sustained: 0, offBurst: 0.6, offTauMs: 30 },
  'pacinian-corpuscle': { onTauMs: 8, sustained: 0, offBurst: 0.8, offTauMs: 8 },
  'hair-follicle-plexus': { onTauMs: 40, sustained: 0, offBurst: 0.4, offTauMs: 40 },
  'merkel-discs': { onTauMs: 150, sustained: 0.45, offBurst: 0, offTauMs: 1 },
  'ruffini-ending': { onTauMs: 400, sustained: 0.7, offBurst: 0, offTauMs: 1 },
};

export interface PressureStep {
  /** Time the probe is pressed, ms. */
  onMs: number;
  /** Time it is lifted, ms. */
  offMs: number;
  /** Indentation 0…1 (relative). */
  amplitude?: number;
}

/**
 * Normalised firing rate (0…1) at time `tMs` for a step indentation held from `onMs` to `offMs`:
 * rapidly adapting units (Meissner, Pacinian, hair) fire only at the onset and offset — they signal
 * change; slowly adapting units (Merkel, Ruffini) keep firing while the pressure lasts — they signal
 * magnitude and duration. Merkel SA1 firing decays to a lower plateau than Ruffini SA2.
 */
export function stepResponse(receptor: keyof typeof STEP_RESPONSE, tMs: number, step: PressureStep): number {
  const p = STEP_RESPONSE[receptor];
  const a = clamp(step.amplitude ?? 1, 0, 1);
  if (tMs < step.onMs) return 0;
  if (tMs < step.offMs) {
    const dt = tMs - step.onMs;
    return a * (p.sustained + (1 - p.sustained) * Math.exp(-dt / p.onTauMs));
  }
  const dt = tMs - step.offMs;
  return a * p.offBurst * Math.exp(-dt / p.offTauMs);
}

/** Sampled step response for plotting: every `dtMs` from 0 to `durationMs`. */
export function stepResponseSeries(receptor: keyof typeof STEP_RESPONSE, durationMs: number, dtMs: number, step: PressureStep): { tMs: number; rate: number }[] {
  const out: { tMs: number; rate: number }[] = [];
  for (let t = 0; t <= durationMs + 1e-9; t += dtMs) out.push({ tMs: t, rate: stepResponse(receptor, t, step) });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Dermatomes
// ---------------------------------------------------------------------------------------------

export type DermatomeId =
  | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8'
  | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9' | 'T10' | 'T11' | 'T12'
  | 'L1' | 'L2' | 'L3' | 'L4' | 'L5'
  | 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

export interface Dermatome {
  id: DermatomeId;
  region: 'cervical' | 'thoracic' | 'lumbar' | 'sacral';
  /** ISNCSCI key sensory point tested for this level. */
  keyPoint: string;
  /** Area supplied (summary). */
  area: string;
}

/**
 * Dermatomes C2–S5 with the ISNCSCI (ASIA 2019) key sensory points. C1 usually has no dermatome.
 * Adjacent dermatomes overlap, so cutting one dorsal root causes little sensory loss; shingles
 * (herpes zoster) reactivates in one dorsal root ganglion and erupts along its dermatome.
 */
export const DERMATOMES: Dermatome[] = [
  { id: 'C2', region: 'cervical', keyPoint: 'At least 1 cm lateral to the occipital protuberance', area: 'Back of the scalp, angle of the jaw spared (trigeminal)' },
  { id: 'C3', region: 'cervical', keyPoint: 'Supraclavicular fossa, midclavicular line', area: 'Neck' },
  { id: 'C4', region: 'cervical', keyPoint: 'Top of the acromioclavicular joint', area: 'Shoulder cape, above the clavicle' },
  { id: 'C5', region: 'cervical', keyPoint: 'Lateral antecubital fossa, proximal to the elbow crease', area: 'Lateral (radial) upper arm' },
  { id: 'C6', region: 'cervical', keyPoint: 'Thumb, dorsal surface of the proximal phalanx', area: 'Lateral forearm, thumb and index finger' },
  { id: 'C7', region: 'cervical', keyPoint: 'Middle finger, dorsal surface of the proximal phalanx', area: 'Middle finger' },
  { id: 'C8', region: 'cervical', keyPoint: 'Little finger, dorsal surface of the proximal phalanx', area: 'Little and ring finger, medial hand' },
  { id: 'T1', region: 'thoracic', keyPoint: 'Medial (ulnar) antecubital fossa, proximal to the medial epicondyle', area: 'Medial forearm' },
  { id: 'T2', region: 'thoracic', keyPoint: 'Apex of the axilla', area: 'Axilla and medial upper arm' },
  { id: 'T3', region: 'thoracic', keyPoint: '3rd intercostal space, midclavicular line', area: 'Upper chest' },
  { id: 'T4', region: 'thoracic', keyPoint: '4th intercostal space — nipple line', area: 'Chest at the nipples' },
  { id: 'T5', region: 'thoracic', keyPoint: '5th intercostal space, midway between T4 and T6', area: 'Lower chest' },
  { id: 'T6', region: 'thoracic', keyPoint: '6th intercostal space — level of the xiphisternum', area: 'Xiphoid level' },
  { id: 'T7', region: 'thoracic', keyPoint: '7th intercostal space, midway between T6 and T8', area: 'Upper abdomen, costal margin' },
  { id: 'T8', region: 'thoracic', keyPoint: '8th intercostal space, midway between T6 and T10', area: 'Upper abdomen' },
  { id: 'T9', region: 'thoracic', keyPoint: '9th intercostal space, midway between T8 and T10', area: 'Abdomen above the umbilicus' },
  { id: 'T10', region: 'thoracic', keyPoint: '10th intercostal space — umbilicus', area: 'Umbilicus' },
  { id: 'T11', region: 'thoracic', keyPoint: '11th intercostal space, midway between T10 and T12', area: 'Lower abdomen' },
  { id: 'T12', region: 'thoracic', keyPoint: 'Inguinal ligament at its midpoint', area: 'Suprapubic region, groin' },
  { id: 'L1', region: 'lumbar', keyPoint: 'Half the distance between T12 and L2', area: 'Upper anterior thigh below the inguinal ligament' },
  { id: 'L2', region: 'lumbar', keyPoint: 'Anterior–medial thigh, midway between inguinal ligament and medial femoral condyle', area: 'Anterior and medial thigh' },
  { id: 'L3', region: 'lumbar', keyPoint: 'Medial femoral condyle above the knee', area: 'Lower thigh and medial knee' },
  { id: 'L4', region: 'lumbar', keyPoint: 'Medial malleolus', area: 'Medial leg (shin) and medial ankle' },
  { id: 'L5', region: 'lumbar', keyPoint: 'Dorsum of the foot at the 3rd metatarsophalangeal joint', area: 'Lateral leg, dorsum of the foot, big toe' },
  { id: 'S1', region: 'sacral', keyPoint: 'Lateral heel (calcaneus)', area: 'Lateral foot, little toe, sole' },
  { id: 'S2', region: 'sacral', keyPoint: 'Midline of the popliteal fossa', area: 'Back of the thigh and calf' },
  { id: 'S3', region: 'sacral', keyPoint: 'Ischial tuberosity or infragluteal fold', area: 'Medial buttock' },
  { id: 'S4', region: 'sacral', keyPoint: 'Perianal area < 1 cm lateral to the mucocutaneous junction (S4–5 tested together)', area: 'Perineum, around the anus (outer ring)' },
  { id: 'S5', region: 'sacral', keyPoint: 'Perianal area < 1 cm lateral to the mucocutaneous junction (S4–5 tested together)', area: 'Perianal skin (innermost ring)' },
];

export const DERMATOME_IDS = DERMATOMES.map((d) => d.id);

export function getDermatome(id: DermatomeId): Dermatome {
  return DERMATOMES.find((d) => d.id === id)!;
}

export type LandmarkId =
  | 'occiput' | 'neck' | 'shoulder-tip' | 'lateral-arm' | 'thumb' | 'index-finger' | 'middle-finger' | 'ring-finger' | 'little-finger'
  | 'medial-forearm' | 'axilla' | 'nipple' | 'xiphoid' | 'umbilicus' | 'inguinal-ligament' | 'anterior-thigh' | 'knee'
  | 'medial-leg' | 'medial-malleolus' | 'big-toe' | 'dorsum-foot' | 'lateral-foot' | 'little-toe' | 'heel' | 'sole'
  | 'popliteal-fossa' | 'buttock' | 'perianal';

/** Classic dermatome landmarks (OpenStax A&P 2e §13.4; ISNCSCI 2019). */
export const LANDMARK_DERMATOME: Record<LandmarkId, DermatomeId> = {
  occiput: 'C2', neck: 'C3', 'shoulder-tip': 'C4', 'lateral-arm': 'C5', thumb: 'C6', 'index-finger': 'C6', 'middle-finger': 'C7',
  'ring-finger': 'C8', 'little-finger': 'C8', 'medial-forearm': 'T1', axilla: 'T2', nipple: 'T4', xiphoid: 'T6', umbilicus: 'T10',
  'inguinal-ligament': 'T12', 'anterior-thigh': 'L2', knee: 'L3', 'medial-leg': 'L4', 'medial-malleolus': 'L4', 'big-toe': 'L5',
  'dorsum-foot': 'L5', 'lateral-foot': 'S1', 'little-toe': 'S1', heel: 'S1', sole: 'S1', 'popliteal-fossa': 'S2', buttock: 'S3', perianal: 'S4',
};

/** Dermatome supplying a landmark. */
export function dermatomeForLandmark(landmark: LandmarkId): DermatomeId {
  return LANDMARK_DERMATOME[landmark];
}

/** Craniocaudal order index of a dermatome (C2 = 0 … S5 = 28). */
export function dermatomeIndex(id: DermatomeId): number {
  return DERMATOME_IDS.indexOf(id);
}

/**
 * Sensory level after a complete spinal cord injury: every dermatome caudal to the most caudal intact
 * level is lost (a teaching simplification of ISNCSCI). Returns the lost dermatomes.
 */
export function dermatomesBelow(intactLevel: DermatomeId): DermatomeId[] {
  return DERMATOME_IDS.slice(dermatomeIndex(intactLevel) + 1);
}

// ---------------------------------------------------------------------------------------------
// Temperature, pain and itch
// ---------------------------------------------------------------------------------------------

export interface ThermoTrp {
  id: 'TRPA1' | 'TRPM8' | 'TRPV4' | 'TRPV3' | 'TRPV1' | 'TRPV2';
  /** Activation range, °C [low, high]. */
  rangeC: [number, number];
  sensation: string;
  agonists: string;
  fibre: FibreClass[];
}

/**
 * Thermosensitive TRP channels of skin afferents (Julius 2013; Caterina 1997; McKemy 2002; Kandel
 * 6e ch. 19–20). Thresholds approximate; TRPA1's role in noxious cold is debated.
 */
export const THERMO_TRPS: ThermoTrp[] = [
  { id: 'TRPA1', rangeC: [-Infinity, 17], sensation: 'Noxious cold, burning pain', agonists: 'Mustard oil (allyl isothiocyanate), cinnamaldehyde, garlic', fibre: ['C'] },
  { id: 'TRPM8', rangeC: [8, 25], sensation: 'Cool to cold', agonists: 'Menthol, icilin, eucalyptol', fibre: ['Aδ', 'C'] },
  { id: 'TRPV4', rangeC: [27, 35], sensation: 'Warmth', agonists: 'Hypotonicity', fibre: ['C'] },
  { id: 'TRPV3', rangeC: [33, 39], sensation: 'Warmth', agonists: 'Camphor, thymol (expressed in keratinocytes)', fibre: ['C'] },
  { id: 'TRPV1', rangeC: [43, Infinity], sensation: 'Heat pain, burning', agonists: 'Capsaicin (chilli), protons (acid), resiniferatoxin', fibre: ['Aδ', 'C'] },
  { id: 'TRPV2', rangeC: [52, Infinity], sensation: 'Intense heat pain', agonists: '2-APB, probenecid', fibre: ['Aδ'] },
];

/** TRP channels active at a skin temperature, °C. */
export function activeTrpChannels(skinTempC: number): ThermoTrp['id'][] {
  return THERMO_TRPS.filter((c) => skinTempC >= c.rangeC[0] && skinTempC < c.rangeC[1]).map((c) => c.id);
}

export type ThermalSensation = 'noxious-cold' | 'cold' | 'cool' | 'neutral' | 'warm' | 'hot' | 'heat-pain';

/**
 * Sensation evoked by holding skin at a temperature (static; adaptation makes ≈ 30–36 °C feel neutral):
 * < 15 noxious cold, 15–25 cold, 25–30 cool, 30–36 neutral, 36–40 warm, 40–43 hot, ≥ 43 heat pain
 * (TRPV1 threshold). Bands approximate (Kandel 6e ch. 19).
 */
export function thermalSensation(skinTempC: number): ThermalSensation {
  if (skinTempC < 15) return 'noxious-cold';
  if (skinTempC < 25) return 'cold';
  if (skinTempC < 30) return 'cool';
  if (skinTempC < 36) return 'neutral';
  if (skinTempC < 40) return 'warm';
  if (skinTempC < 43) return 'hot';
  return 'heat-pain';
}

/** Pain, itch and gating notes for the lab's information panel. */
export const PAIN_ITCH_NOTES = {
  nociceptors: 'Nociceptors are free endings of Aδ and C fibres. Mechanical nociceptors (Aδ) respond to sharp or crushing stimuli; polymodal C nociceptors respond to heat, chemicals and mechanical damage. Silent nociceptors wake up in inflammation.',
  firstSecondPain: 'First pain is sharp and well localised (Aδ, ≈ 5–30 m/s); second pain is dull, burning and poorly localised (C, ≈ 0.5–2 m/s), arriving about a second later from the foot.',
  sensitisation: 'Injured tissue releases bradykinin, prostaglandins, protons, ATP and nerve growth factor, lowering nociceptor thresholds (peripheral sensitisation): a sunburn makes warm water feel painful because TRPV1 now opens below 43 °C.',
  itch: 'Itch travels in dedicated C fibres: histaminergic (H1 receptors; insect bites, urticaria) and non-histaminergic (MrgprX1, PAR2 — eczema, cholestasis). Scratching activates spinal inhibitory interneurons that suppress itch.',
  gateControl: 'Gate control (Melzack & Wall 1965): Aβ touch input excites dorsal-horn inhibitory interneurons that reduce nociceptive transmission — why rubbing a bumped elbow helps.',
  pathway: 'Pain and temperature cross within one or two segments and ascend in the anterolateral (spinothalamic) tract; fine touch and vibration ascend uncrossed in the dorsal columns and cross in the medulla (medial lemniscus).',
} as const;
