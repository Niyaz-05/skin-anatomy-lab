/**
 * Temperature regulation for the skin lab: a two-node (core + skin shell) human heat balance with the
 * four routes of heat exchange (radiation, convection, conduction, evaporation) plus respiration, the
 * thermoregulatory effectors that act through the skin (sweating from the `eccrine-gland`, skin blood
 * flow through the `superficial-plexus` / `deep-plexus`, piloerection by the `arrector-pili`) and
 * shivering, and a per-minute simulation for animation. Pure functions with units in the names; no
 * DOM, no three.js. Heat flows are in watts and positive = heat LOST from the body unless noted.
 *
 * The controller follows the form of Gagge's two-node model (core, skin and mean-body temperature
 * error signals driving vasomotion, sweating and shivering) with gains simplified for teaching; the
 * heat-transfer coefficients are the standard linearised ones. It is an educational model, not a
 * clinical or occupational heat-stress tool.
 *
 * Main sources: Parsons K (2014) Human Thermal Environments, 3rd ed. (heat balance, clo, MET, routes,
 * wet-bulb); ASHRAE Handbook — Fundamentals (2017) ch. 9 "Thermal Comfort" (coefficients, respiratory
 * loss, Gagge two-node model); Gagge AP, Stolwijk JAJ & Nishi Y (1971) ASHRAE Trans 77:247–262;
 * Guyton AC & Hall JE (2021) Textbook of Medical Physiology, 14th ed., "Body Temperature Regulation
 * and Fever"; OpenStax Anatomy & Physiology 2e (2022) ch. 5 "The Integumentary System" (§5.3
 * functions: thermoregulation); Rowell LB (1983) Circ Res 52:367 (skin blood flow in heat stress);
 * Stull R (2011) J Appl Meteorol Climatol 50:2267 (wet-bulb formula); Sherwood SC & Huber M (2010)
 * PNAS 107:9552 and Vecellio DJ et al. (2022) J Appl Physiol 132:340 (wet-bulb survivability).
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** One metabolic equivalent, W per m² of body surface (ASHRAE 2017 ch. 9: 1 met = 58.2 W/m²). */
export const MET_W_PER_M2 = 58.2;
/** One clo of clothing insulation, m²·K/W (ASHRAE 2017; Parsons 2014). */
export const CLO_M2K_PER_W = 0.155;
/** Latent heat of vaporisation of sweat at skin temperature, J/kg (≈ 2.43 MJ/kg at 30–35 °C). */
export const LATENT_HEAT_SWEAT_J_PER_KG = 2.43e6;
/** Mean specific heat of body tissue, J/(kg·K) (≈ 3.47–3.49 kJ/kg/K; ASHRAE 2017, approximate). */
export const BODY_SPECIFIC_HEAT_J_PER_KG_K = 3490;
/** Volumetric heat capacity of blood, W per (L/min) per K: 1.163 W·h/(L·K) × 60 (Gagge 1971). */
export const BLOOD_HEAT_W_PER_LPM_K = 1.163 * 60;
/** Lewis relation for air, K/kPa: evaporative coefficient = 16.5 × convective coefficient. */
export const LEWIS_RATIO_K_PER_KPA = 16.5;
/** Stefan–Boltzmann constant, W/(m²·K⁴). */
export const STEFAN_BOLTZMANN = 5.67e-8;

/**
 * Thermoregulatory set points of the two-node model (Gagge 1971; ASHRAE 2017 ch. 9): core 36.8 °C
 * (the "≈ 37 °C" of textbooks; oral ≈ 36.8 ± 0.4 °C), skin 33.7 °C, mean body 36.49 °C.
 */
export const SET_POINTS_C = { core: 36.8, skin: 33.7, body: 36.49 } as const;
/** Fraction of body mass in the skin (shell) node — fixed here; Gagge lets it vary (approximate). */
export const SKIN_MASS_FRACTION = 0.1;

// ---------------------------------------------------------------------------------------------
// Body, activity, clothing
// ---------------------------------------------------------------------------------------------

/** DuBois body surface area, m²: A = 0.202 · m^0.425 · h^0.725 (DuBois & DuBois 1916). 70 kg, 1.75 m → ≈ 1.85 m². */
export function duBoisAreaM2(massKg: number, heightM: number): number {
  return 0.202 * massKg ** 0.425 * heightM ** 0.725;
}

/** Metabolic heat production, W, for an activity level in MET and a body surface area. */
export function metabolicW(met: number, areaM2: number): number {
  return met * MET_W_PER_M2 * areaM2;
}

export type ActivityId = 'sleeping' | 'seated' | 'standing' | 'walking' | 'brisk-walking' | 'cycling' | 'running';
export interface Activity {
  id: ActivityId;
  label: string;
  /** Metabolic rate, MET. */
  met: number;
  /** Mechanical efficiency (external work / metabolic rate); most of the energy becomes heat. */
  efficiency: number;
}
/**
 * Activity levels (ASHRAE 2017 ch. 9 table 4; Ainsworth BE et al. 2011 Compendium of Physical
 * Activities — values approximate). Resting adult ≈ 80–105 W; hard running > 1 kW.
 */
export const ACTIVITIES: Record<ActivityId, Activity> = {
  sleeping: { id: 'sleeping', label: 'Sleeping', met: 0.7, efficiency: 0 },
  seated: { id: 'seated', label: 'Seated, quiet', met: 1.0, efficiency: 0 },
  standing: { id: 'standing', label: 'Standing, relaxed', met: 1.2, efficiency: 0 },
  walking: { id: 'walking', label: 'Walking 3 km/h', met: 2.0, efficiency: 0 },
  'brisk-walking': { id: 'brisk-walking', label: 'Walking 6.5 km/h', met: 3.8, efficiency: 0 },
  cycling: { id: 'cycling', label: 'Cycling, moderate (~100 W)', met: 6.0, efficiency: 0.2 },
  running: { id: 'running', label: 'Running 10 km/h', met: 10, efficiency: 0 },
};

/** Typical clothing ensembles, clo (ISO 9920 / ASHRAE 2017; approximate). */
export const CLOTHING_CLO = {
  nude: 0,
  shorts: 0.1,
  summer: 0.5,
  'indoor-trousers-shirt': 1.0,
  'business-suit': 1.3,
  'winter-outdoor': 2.0,
  'polar-expedition': 3.5,
} as const;

/** Clothing area factor (ratio of clothed to nude surface), f_cl = 1 + 0.31·I_cl (ASHRAE 2017). */
export function clothingAreaFactor(clo: number): number {
  return 1 + 0.31 * Math.max(0, clo);
}

export interface BodyParams {
  massKg: number;
  heightM: number;
  /** Activity level, MET. */
  met: number;
  /** Mechanical efficiency 0…1 (fraction of metabolism done as external work). */
  efficiency: number;
  /** Clothing insulation, clo. */
  clo: number;
  /** Maximal sweat rate, L/h (≈ 1–1.5 unacclimatised, up to ≈ 2 or more after heat acclimatisation; Guyton & Hall 14e — approximate). */
  maxSweatLph: number;
  /** Maximal skin blood flow, L/min (≈ 6–8 L/min in severe heat stress, ~60 % of cardiac output; Rowell 1983). */
  maxSkinBloodFlowLpm: number;
  /** Maximal sustained shivering heat, W (peak ≈ 4–5× resting metabolism; sustainable for hours ≈ 2.5–3× — approximate, Haman F 2006 Appl Physiol Nutr Metab 31:784). */
  maxShiveringW: number;
  /** Minimal (vasoconstricted) core-to-skin tissue conductance, W/(m²·K). Gagge's 5.28 is paired with a shell that thickens in the cold; with a fixed shell ≈ 9 gives realistic cold-water cooling (approximate; subcutaneous fat lowers it). */
  tissueConductanceWm2K: number;
  /** Shift of the hypothalamic set point, K (fever: prostaglandin E2 in the preoptic area raises it). */
  setPointShiftC: number;
}

/** A 70 kg, 1.75 m adult seated at rest in indoor clothing (1 clo). */
export const DEFAULT_BODY: BodyParams = {
  massKg: 70,
  heightM: 1.75,
  met: 1.0,
  efficiency: 0,
  clo: 1.0,
  maxSweatLph: 1.5,
  maxSkinBloodFlowLpm: 7.5,
  maxShiveringW: 250,
  tissueConductanceWm2K: 9,
  setPointShiftC: 0,
};

// ---------------------------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------------------------

export interface Contact {
  /** Fraction of the body surface in contact (0…1); it is removed from radiation, convection and evaporation. */
  fraction: number;
  /** Temperature of the surface or water, °C. */
  tempC: number;
  medium: 'ground' | 'water';
}

export interface Environment {
  /** Air (dry-bulb) temperature, °C. */
  airTempC: number;
  /** Mean radiant temperature, °C (default = air temperature; sunshine raises it). */
  radiantTempC?: number;
  /** Relative humidity, % (0–100). */
  relHumidityPct: number;
  /** Air speed (wind), m/s. */
  windMs: number;
  /** Conductive contact with the ground or immersion in water. */
  contact?: Contact;
}

/**
 * Contact heat-transfer coefficients, W/(m²·K): lying on cold ground through clothing ≈ 15; still
 * water ≈ 100 (water conducts ≈ 25× better than air, so a body cools several times faster in water
 * than in air of the same temperature; Parsons 2014). Approximate.
 */
export const CONTACT_COEFF_W_M2K = { ground: 15, water: 100 } as const;

/** Saturated water-vapour pressure, kPa, at a temperature in °C (Tetens/Magnus formula; 20 °C → 2.34, 100 °C → ≈ 101). */
export function saturationVapourPressureKpa(tempC: number): number {
  return 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

/** Partial pressure of water vapour in the air, kPa. */
export function vapourPressureKpa(env: Pick<Environment, 'airTempC' | 'relHumidityPct'>): number {
  return (clamp(env.relHumidityPct, 0, 100) / 100) * saturationVapourPressureKpa(env.airTempC);
}

/** Convective heat-transfer coefficient, W/(m²·K): max(3.1 natural convection, 8.3·v^0.6) (ASHRAE 2017 ch. 9). */
export function convectiveCoefficientWm2K(windMs: number): number {
  return Math.max(3.1, 8.3 * Math.max(0, windMs) ** 0.6);
}

/**
 * Linearised radiative coefficient, W/(m²·K): h_r = 4εσ(A_r/A_D)(273.15 + (t_cl + t_r)/2)³ with skin
 * emissivity ε ≈ 0.95 and effective radiating area ≈ 0.72 of the surface (seated/standing; ASHRAE). ≈ 4.7 at room temperature.
 */
export function radiativeCoefficientWm2K(surfaceC: number, radiantC: number): number {
  return 4 * 0.95 * STEFAN_BOLTZMANN * 0.72 * (273.15 + (surfaceC + radiantC) / 2) ** 3;
}

/**
 * Wet-bulb temperature, °C, from air temperature and relative humidity (Stull 2011 empirical fit,
 * valid ≈ 5–99 % RH, −20…50 °C; 20 °C at 50 % → ≈ 13.7 °C). The wet-bulb temperature is the lowest
 * temperature that evaporation can cool a wet surface to — so it caps how well sweating can work.
 */
export function wetBulbC(airTempC: number, relHumidityPct: number): number {
  const T = airTempC, RH = clamp(relHumidityPct, 0, 100);
  return T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) + Math.atan(T + RH) - Math.atan(RH - 1.676331)
    + 0.00391838 * RH ** 1.5 * Math.atan(0.023101 * RH) - 4.686035;
}

export type WetBulbRisk = 'safe' | 'caution' | 'danger' | 'unsurvivable';
/**
 * Wet-bulb safety note. Skin must stay ≈ 35 °C to shed metabolic heat, so a sustained wet-bulb
 * temperature of 35 °C is the theoretical limit of human survivability even at rest in shade with
 * unlimited water (Sherwood & Huber 2010). Laboratory data put the practical limit for young healthy
 * people nearer 31 °C (Vecellio et al. 2022), lower for the elderly, the ill and anyone working.
 * Bands: < 26 safe, 26–31 caution, 31–35 danger, ≥ 35 unsurvivable for more than a few hours (approximate).
 */
export function wetBulbRisk(wetBulbTempC: number): { risk: WetBulbRisk; note: string } {
  if (wetBulbTempC >= 35) return { risk: 'unsurvivable', note: 'Wet-bulb ≥ 35 °C: evaporation cannot remove even resting metabolic heat; core temperature rises without limit.' };
  if (wetBulbTempC >= 31) return { risk: 'danger', note: 'Wet-bulb 31–35 °C: above the measured limit of compensable heat stress for young healthy adults at rest.' };
  if (wetBulbTempC >= 26) return { risk: 'caution', note: 'Wet-bulb 26–31 °C: hard work becomes uncompensable; rest, shade and fluids needed.' };
  return { risk: 'safe', note: 'Wet-bulb < 26 °C: sweating can usually keep the body in balance at rest.' };
}

// ---------------------------------------------------------------------------------------------
// Thermoregulatory effectors (controller)
// ---------------------------------------------------------------------------------------------

export interface ThermoSignals {
  warmCore: number; coldCore: number; warmSkin: number; coldSkin: number; warmBody: number;
}

/**
 * Error signals of the controller, K: core and skin temperature relative to their set points and the
 * mean body temperature T_b = α·T_sk + (1 − α)·T_cr relative to its set point (Gagge 1971). A fever
 * shifts the core and body set points.
 */
export function thermoSignals(coreC: number, skinC: number, setPointShiftC = 0): ThermoSignals {
  const core = SET_POINTS_C.core + setPointShiftC, body = SET_POINTS_C.body + setPointShiftC, skin = SET_POINTS_C.skin;
  const tb = SKIN_MASS_FRACTION * skinC + (1 - SKIN_MASS_FRACTION) * coreC;
  return {
    warmCore: Math.max(0, coreC - core), coldCore: Math.max(0, core - coreC),
    warmSkin: Math.max(0, skinC - skin), coldSkin: Math.max(0, skin - skinC),
    warmBody: Math.max(0, tb - body),
  };
}

/**
 * Skin blood flow, L/min: SKBF = (6.3 + 120·warm_core)/(1 + 0.5·cold_skin + cold_core) L/(m²·h)
 * (Gagge form, ASHRAE 2017 ch. 9, plus a core-cold term so that a fever's raised set point
 * vasoconstricts — the pale, cold skin of the "chills"; that term is approximate), floored at 0.5 L/(m²·h) (near-zero in full vasoconstriction) and capped at
 * `maxSkinBloodFlowLpm` (≈ 7.5 L/min in severe heat; Rowell 1983). Neutral ≈ 0.2 L/min. Warm blood
 * in the superficial plexus loses heat through the thin epidermis; arteriovenous anastomoses in the
 * hands, feet, lips, nose and ears switch it on and off (sympathetic noradrenergic tone).
 */
export function skinBloodFlowLpm(coreC: number, skinC: number, areaM2: number, p: Pick<BodyParams, 'maxSkinBloodFlowLpm' | 'setPointShiftC'> = DEFAULT_BODY): number {
  const s = thermoSignals(coreC, skinC, p.setPointShiftC);
  const perM2h = Math.max(0.5, (6.3 + 120 * s.warmCore) / (1 + 0.5 * s.coldSkin + s.coldCore));
  return Math.min(p.maxSkinBloodFlowLpm, (perM2h * areaM2) / 60);
}

/**
 * Thermoregulatory sweat rate, L/h: 170·warm_body·exp(warm_skin/10.7) g/(m²·h) (Gagge form, ASHRAE
 * 2017), capped at `maxSweatLph`. Eccrine glands (≈ 2–4 million, densest on palms, soles and
 * forehead) are sympathetic but cholinergic (acetylcholine on M3 receptors).
 */
export function sweatRateLph(coreC: number, skinC: number, areaM2: number, p: Pick<BodyParams, 'maxSweatLph' | 'setPointShiftC'> = DEFAULT_BODY): number {
  const s = thermoSignals(coreC, skinC, p.setPointShiftC);
  const gPerH = 170 * s.warmBody * Math.exp(s.warmSkin / 10.7) * areaM2;
  return Math.min(p.maxSweatLph, gPerH / 1000);
}

/**
 * Shivering thermogenesis, W: 19.4·cold_skin·cold_core W/m² (Gagge form, ASHRAE 2017) plus a
 * core-only term 40·(cold_core − 0.3 K) W/m² (approximate; it drives the shivering of a rising fever even
 * with warm skin), capped at
 * `maxShiveringW`, and fading out as the core falls from 32 to 30 °C (shivering fails in moderate
 * hypothermia, after which cooling accelerates). Shivering is driven from the posterior hypothalamus;
 * brown-fat non-shivering thermogenesis is important in infants but small in adults (Guyton & Hall 14e).
 */
export function shiveringW(coreC: number, skinC: number, areaM2: number, p: Pick<BodyParams, 'maxShiveringW' | 'setPointShiftC'> = DEFAULT_BODY): number {
  const s = thermoSignals(coreC, skinC, p.setPointShiftC);
  const failing = clamp((coreC - 30) / 2, 0, 1);
  const perM2 = 19.4 * s.coldSkin * s.coldCore + 40 * Math.max(0, s.coldCore - 0.3);
  return Math.min(p.maxShiveringW, perM2 * areaM2) * failing;
}

/**
 * Piloerection ("goosebumps"), 0…1: contraction of the `arrector-pili` smooth muscle (sympathetic,
 * α1-adrenergic) pulls the `hair-shaft` upright. In furry mammals it traps an insulating layer of
 * air; in humans it is vestigial and adds almost no insulation. Driven here by cold skin (onset ≈ 2 K,
 * full ≈ 5 K below the skin set point) and by a core below its set point, as in the chills of a rising
 * fever (thresholds approximate) — emotion and fear trigger it too.
 */
export function piloerection(skinC: number, coreC: number, setPointShiftC = 0): number {
  const s = thermoSignals(coreC, skinC, setPointShiftC);
  return clamp((s.coldSkin - 2) / 3 + s.coldCore, 0, 1);
}

// ---------------------------------------------------------------------------------------------
// Heat balance
// ---------------------------------------------------------------------------------------------

export interface ThermoState {
  coreC: number;
  skinC: number;
}
/** Thermoneutral starting state (the controller's set points). */
export const NEUTRAL_STATE: ThermoState = { coreC: SET_POINTS_C.core, skinC: SET_POINTS_C.skin };

export interface HeatRoutes {
  /** Net long-wave radiation from the clothed surface, W (negative = radiant heat gain, e.g. sun, hot walls). */
  radiationW: number;
  /** Convection to the air, W (wind raises it; negative when air is hotter than the surface). */
  convectionW: number;
  /** Conduction to a contacting surface or water, W. */
  conductionW: number;
  /** Evaporation of sweat and insensible diffusion from the skin, W (always ≥ 0). */
  evaporationW: number;
  /** Respiratory heat loss (warming and humidifying inspired air), W. */
  respirationW: number;
}

export interface HeatBalance {
  areaM2: number;
  /** Total metabolic rate M, W. */
  metabolicW: number;
  /** External mechanical work, W. */
  workW: number;
  shiveringW: number;
  /** Heat production = M − W + shivering, W. */
  heatProductionW: number;
  routes: HeatRoutes;
  /** Sum of all routes, W. */
  totalLossW: number;
  /** Heat storage S = production − loss, W (> 0 body warming, < 0 cooling). */
  storageW: number;
  /** Maximal evaporation the environment allows from fully wet skin, W. */
  maxEvaporationW: number;
  /**
   * Evaporation needed for balance (production − dry losses − respiration), W. When the air is
   * hotter than the skin (≳ 35 °C) dry routes become heat GAINS and this exceeds metabolic heat:
   * evaporation is then the only route left.
   */
  requiredEvaporationW: number;
  /** Skin wettedness, E_sk / E_max (0…1); > ≈ 0.8 is very uncomfortable and sweat drips. */
  wettedness: number;
  sweatLph: number;
  /** Sweat that drips off unevaporated (no cooling), L/h. */
  drippingLph: number;
  skinBloodFlowLpm: number;
  /** Heat carried from core to skin by conduction and blood, W. */
  coreToSkinW: number;
  piloerection: number;
  clothingSurfaceC: number;
  /** Operative temperature (mean of air and radiant temperatures weighted by h_c, h_r), °C. */
  operativeC: number;
}

/**
 * Instantaneous heat balance of the body: M − W = R + C + K + E + Res + S (Parsons 2014 ch. 2).
 *  - Dry heat: (T_sk − T_o)/(R_cl + 1/(f_cl·h)), split into radiation h_r and convection h_c.
 *  - Evaporation: E_max = (p_sk,sat − p_a)/(R_e,cl + 1/(f_cl·h_e)); actual E = sweat + 6 % diffusion, ≤ E_max.
 *  - Respiration: 0.0014·M·(34 − T_a) + 0.0173·M·(5.87 − p_a) (ASHRAE 2017).
 *  - Conduction: h_k·A_contact·(T_sk − T_surface).
 */
export function heatBalance(state: ThermoState, env: Environment, body: Partial<BodyParams> = {}): HeatBalance {
  const p: BodyParams = { ...DEFAULT_BODY, ...body };
  const A = duBoisAreaM2(p.massKg, p.heightM);
  const contact = env.contact;
  const contactFrac = contact ? clamp(contact.fraction, 0, 1) : 0;
  const airArea = A * (1 - contactFrac);
  const ta = env.airTempC, tr = env.radiantTempC ?? env.airTempC, tsk = state.skinC;

  // Dry heat through clothing (iterate the clothing surface temperature).
  const fcl = clothingAreaFactor(p.clo), rcl = CLO_M2K_PER_W * Math.max(0, p.clo);
  const hc = convectiveCoefficientWm2K(env.windMs);
  let tcl = tsk, hr = radiativeCoefficientWm2K(tcl, tr), to = ta;
  for (let i = 0; i < 6; i++) {
    hr = radiativeCoefficientWm2K(tcl, tr);
    const h = hr + hc;
    to = (hr * tr + hc * ta) / h;
    tcl = to + (tsk - to) / (1 + fcl * h * rcl);
  }
  const radiationW = airArea * fcl * hr * (tcl - tr);
  const convectionW = airArea * fcl * hc * (tcl - ta);
  const conductionW = contact ? A * contactFrac * CONTACT_COEFF_W_M2K[contact.medium] * (tsk - contact.tempC) : 0;

  // Metabolism and respiration.
  const M = metabolicW(p.met, A);
  const workW = M * clamp(p.efficiency, 0, 0.3);
  const pa = vapourPressureKpa(env);
  const respirationW = 0.0014 * M * (34 - ta) + 0.0173 * M * (5.87 - pa);

  // Effectors.
  const shiv = shiveringW(state.coreC, tsk, A, p);
  const sweat = sweatRateLph(state.coreC, tsk, A, p);
  const skbf = skinBloodFlowLpm(state.coreC, tsk, A, p);

  // Evaporation.
  const he = LEWIS_RATIO_K_PER_KPA * hc;
  const recl = rcl / (LEWIS_RATIO_K_PER_KPA * 0.34); // clothing vapour resistance, permeability index ≈ 0.34
  const maxEvaporationW = Math.max(0, (airArea * (saturationVapourPressureKpa(tsk) - pa)) / (recl + 1 / (fcl * he)));
  const sweatW = (sweat * LATENT_HEAT_SWEAT_J_PER_KG) / 3600; // 1 L ≈ 1 kg
  const evaporationW = Math.min(maxEvaporationW, sweatW + 0.06 * Math.max(0, maxEvaporationW - sweatW));
  const evaporatedSweatW = Math.min(sweatW, evaporationW);
  const drippingLph = Math.max(0, sweat - (evaporatedSweatW * 3600) / LATENT_HEAT_SWEAT_J_PER_KG);

  const heatProductionW = M - workW + shiv;
  const routes: HeatRoutes = { radiationW, convectionW, conductionW, evaporationW, respirationW };
  const totalLossW = radiationW + convectionW + conductionW + evaporationW + respirationW;
  const requiredEvaporationW = heatProductionW - radiationW - convectionW - conductionW - respirationW;
  const coreToSkinW = (p.tissueConductanceWm2K * A + BLOOD_HEAT_W_PER_LPM_K * skbf) * (state.coreC - tsk);

  return {
    areaM2: A, metabolicW: M, workW, shiveringW: shiv, heatProductionW, routes, totalLossW,
    storageW: heatProductionW - totalLossW, maxEvaporationW, requiredEvaporationW,
    wettedness: maxEvaporationW > 0 ? clamp(evaporationW / maxEvaporationW, 0, 1) : 1,
    sweatLph: sweat, drippingLph, skinBloodFlowLpm: skbf, coreToSkinW,
    piloerection: piloerection(tsk, state.coreC, p.setPointShiftC), clothingSurfaceC: tcl, operativeC: to,
  };
}

/**
 * Advance the two-node model by `dtS` seconds (internally in ≤ 2 s explicit steps, which keeps the
 * small, well-perfused skin node stable):
 *   C_core·dT_cr/dt = (M − W + shivering) − Res − Q_core→skin
 *   C_skin·dT_sk/dt = Q_core→skin − (R + C + K + E)
 */
export function thermoStep(state: ThermoState, env: Environment, dtS: number, body: Partial<BodyParams> = {}): ThermoState {
  const p: BodyParams = { ...DEFAULT_BODY, ...body };
  const cCore = (1 - SKIN_MASS_FRACTION) * p.massKg * BODY_SPECIFIC_HEAT_J_PER_KG_K;
  const cSkin = SKIN_MASS_FRACTION * p.massKg * BODY_SPECIFIC_HEAT_J_PER_KG_K;
  const n = Math.max(1, Math.ceil(dtS / 2));
  const h = dtS / n;
  let s = { ...state };
  for (let i = 0; i < n; i++) {
    const b = heatBalance(s, env, p);
    const coreNet = b.heatProductionW - b.routes.respirationW - b.coreToSkinW;
    const skinNet = b.coreToSkinW - (b.routes.radiationW + b.routes.convectionW + b.routes.conductionW + b.routes.evaporationW);
    s = { coreC: s.coreC + (coreNet * h) / cCore, skinC: s.skinC + (skinNet * h) / cSkin };
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// Thermal states
// ---------------------------------------------------------------------------------------------

export type ThermalStateId =
  | 'severe-hypothermia' | 'moderate-hypothermia' | 'mild-hypothermia' | 'normal' | 'elevated' | 'heat-exhaustion' | 'heat-stroke';

export interface ThermalStateInfo {
  id: ThermalStateId;
  label: string;
  /** Core temperature range, °C [min, max). */
  rangeC: [number, number];
  signs: string;
}

/**
 * Core-temperature bands (classical hypothermia staging: mild 32–35, moderate 28–32, severe < 28 °C;
 * heat illness per Guyton & Hall 14e and standard emergency teaching). Heat exhaustion is a clinical
 * diagnosis (core usually ≈ 38.5–40 °C, mental state intact; 38–39.5 °C is normal in hard exercise, so
 * the band starts at 39 °C here); heat stroke is core > 40 °C WITH central
 * nervous system dysfunction. Fever differs from hyperthermia: the set point itself is raised.
 */
export const THERMAL_STATES: ThermalStateInfo[] = [
  { id: 'severe-hypothermia', label: 'Severe hypothermia', rangeC: [-Infinity, 28], signs: 'Unconscious, shivering stopped, fixed pupils possible, risk of ventricular fibrillation and asystole; may appear dead ("not dead until warm and dead").' },
  { id: 'moderate-hypothermia', label: 'Moderate hypothermia', rangeC: [28, 32], signs: 'Shivering fails, drowsy and confused, slow pulse and breathing, atrial fibrillation and J (Osborn) waves; paradoxical undressing can occur.' },
  { id: 'mild-hypothermia', label: 'Mild hypothermia', rangeC: [32, 35], signs: 'Vigorous shivering, pale cold skin (vasoconstriction), goosebumps, clumsiness, cold diuresis.' },
  { id: 'normal', label: 'Normal', rangeC: [35, 37.5], signs: 'Thermoregulation in control: small changes in skin blood flow and sweating keep the core near 37 °C.' },
  { id: 'elevated', label: 'Elevated (heat strain)', rangeC: [37.5, 39], signs: 'Flushed skin from vasodilation, heavy sweating, raised heart rate; normal during hard exercise (core 38–39.5 °C).' },
  { id: 'heat-exhaustion', label: 'Heat exhaustion', rangeC: [39, 40], signs: 'Water and salt depletion: weakness, headache, nausea, dizziness, fainting, heavy sweating, cool clammy skin; mind clear.' },
  { id: 'heat-stroke', label: 'Heat stroke', rangeC: [40, Infinity], signs: 'Thermoregulatory failure: confusion, seizures or coma; skin hot and often dry (classic) or still sweating (exertional); multi-organ failure. Medical emergency — cool immediately.' },
];

/** Classify a core temperature into a thermal state. */
export function classifyCoreTemp(coreC: number): ThermalStateId {
  return (THERMAL_STATES.find((s) => coreC >= s.rangeC[0] && coreC < s.rangeC[1]) ?? THERMAL_STATES[3]!).id;
}

// ---------------------------------------------------------------------------------------------
// Simulation for animation
// ---------------------------------------------------------------------------------------------

export interface ThermoSample {
  tMin: number;
  coreC: number;
  skinC: number;
  sweatLph: number;
  skinBloodFlowLpm: number;
  shiveringW: number;
  piloerection: number;
  heatProductionW: number;
  routes: HeatRoutes;
  storageW: number;
  wettedness: number;
  state: ThermalStateId;
}

function sample(tMin: number, s: ThermoState, env: Environment, body: Partial<BodyParams>): ThermoSample {
  const b = heatBalance(s, env, body);
  return {
    tMin, coreC: s.coreC, skinC: s.skinC, sweatLph: b.sweatLph, skinBloodFlowLpm: b.skinBloodFlowLpm,
    shiveringW: b.shiveringW, piloerection: b.piloerection, heatProductionW: b.heatProductionW, routes: b.routes,
    storageW: b.storageW, wettedness: b.wettedness, state: classifyCoreTemp(s.coreC),
  };
}

/**
 * Per-minute simulation, minutes 0…`minutes` inclusive (minutes + 1 samples), starting from `start`
 * (thermoneutral by default) — drives the lab's thermometer, sweat beads, vessel colour, shivering
 * and goosebump animations.
 */
export function simulateThermo(env: Environment, minutes: number, body: Partial<BodyParams> = {}, start: ThermoState = NEUTRAL_STATE): ThermoSample[] {
  const out: ThermoSample[] = [sample(0, start, env, body)];
  let s = { ...start };
  for (let m = 1; m <= Math.max(0, Math.floor(minutes)); m++) {
    s = thermoStep(s, env, 60, body);
    out.push(sample(m, s, env, body));
  }
  return out;
}
