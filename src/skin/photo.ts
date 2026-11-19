/**
 * Skin and light for the skin lab: Fitzpatrick skin phototypes with their minimal erythema dose,
 * the CIE erythema action spectrum and the WHO UV index, minutes to sunburn with and without
 * sunscreen, a clear-sky noon UV index by latitude and date, a semi-quantitative vitamin D estimate,
 * melanin and melanosome biology, intrinsic ageing vs photoageing, and disorder cards (acne, atopic
 * eczema, psoriasis, vitiligo, basal cell carcinoma, squamous cell carcinoma, melanoma) with an
 * ABCDE melanoma checker. Pure functions, no DOM. Structure ids are those of docs/STRUCTURES.md.
 *
 * EDUCATIONAL ONLY — the ABCDE checker is a teaching aid, not a diagnostic tool.
 *
 * Main sources: Fitzpatrick TB (1988) The validity and practicality of sun-reactive skin types I
 * through VI, Arch Dermatol 124:869–871; CIE S 007/E-1998 = ISO 17166:1999 (erythema reference action
 * spectrum and standard erythema dose); WHO (2002) Global Solar UV Index: A Practical Guide; Madronich
 * S (2007) Photochem Photobiol 83:1537–1538 (analytic clear-sky UV index); Diffey BL (2002) Methods
 * 28:4–13 (sources and measurement of UV; MED by skin type); Holick MF (2007) Vitamin D deficiency,
 * N Engl J Med 357:266–281; Webb AR, Kline L & Holick MF (1988) J Clin Endocrinol Metab 67:373
 * ("vitamin D winter"); Abbasi NR et al. (2004) Early diagnosis of cutaneous melanoma: revisiting the
 * ABCD criteria, JAMA 292:2771–2776; OpenStax Anatomy & Physiology 2e (2022) ch. 5 (§5.1 layers and
 * pigmentation, §5.3 vitamin D, §5.4 disorders and ageing); Kumar V et al. (2018) Robbins Basic
 * Pathology 10e, ch. 22 "Skin"; Yaar M & Gilchrest BA (2007) Br J Dermatol 157:874 (photoageing).
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------------------------
// UV spectrum
// ---------------------------------------------------------------------------------------------

export type UvBand = 'UVC' | 'UVB' | 'UVA' | 'visible' | 'other';

/** UV band of a wavelength, nm (CIE: UVC 100–280, UVB 280–315, UVA 315–400). Ozone absorbs essentially all solar UVC. */
export function uvBand(nm: number): UvBand {
  if (nm >= 100 && nm < 280) return 'UVC';
  if (nm >= 280 && nm < 315) return 'UVB';
  if (nm >= 315 && nm < 400) return 'UVA';
  if (nm >= 400 && nm <= 780) return 'visible';
  return 'other';
}

/**
 * CIE reference erythema action spectrum (ISO 17166 / CIE S 007), relative effectiveness:
 * 1 for 250–298 nm; 10^(0.094·(298 − λ)) for 298–328 nm; 10^(0.015·(140 − λ)) for 328–400 nm; 0
 * outside 250–400 nm. UVB is ≈ 1000× more erythemogenic than UVA per joule.
 */
export function erythemaActionSpectrum(nm: number): number {
  if (nm < 250 || nm > 400) return 0;
  if (nm <= 298) return 1;
  if (nm <= 328) return 10 ** (0.094 * (298 - nm));
  return 10 ** (0.015 * (140 - nm));
}

/** One standard erythema dose (SED) = 100 J/m² of erythemally weighted UV (CIE). */
export const SED_J_PER_M2 = 100;

/** Erythemally weighted irradiance, W/m², for a UV index: UVI = 40 m²/W × E_ery (WHO 2002), so E = 0.025·UVI. */
export function erythemalIrradianceWm2(uvIndex: number): number {
  return Math.max(0, uvIndex) / 40;
}

export type UvCategory = 'low' | 'moderate' | 'high' | 'very-high' | 'extreme';

/** WHO UV index exposure categories: 0–2 low, 3–5 moderate, 6–7 high, 8–10 very high, 11+ extreme (WHO 2002). */
export function uvIndexCategory(uvIndex: number): { category: UvCategory; advice: string } {
  const u = Math.round(uvIndex);
  if (u <= 2) return { category: 'low', advice: 'No protection needed for most people.' };
  if (u <= 5) return { category: 'moderate', advice: 'Seek shade around midday; shirt, hat, sunscreen.' };
  if (u <= 7) return { category: 'high', advice: 'Protection required: shade at midday, cover up, SPF 30+.' };
  if (u <= 10) return { category: 'very-high', advice: 'Extra protection: avoid midday sun, shirt, hat, sunglasses, SPF 30+.' };
  return { category: 'extreme', advice: 'Avoid being outside at midday; unprotected fair skin burns in minutes.' };
}

/**
 * Clear-sky noon UV index (Madronich 2007): UVI ≈ 12.5·μ₀^2.42·(Ω/300)^−1.23, μ₀ = cos(solar zenith
 * angle), Ω = total ozone in Dobson units. Ignores altitude (+≈ 10 % per km), cloud, snow and aerosol.
 * The noon zenith angle is |latitude − solar declination| with declination ≈ 23.44°·sin(2π(284 + day)/365).
 */
export function clearSkyNoonUvIndex(latitudeDeg: number, dayOfYear: number, ozoneDu = 300): number {
  const decl = solarDeclinationDeg(dayOfYear);
  const sza = Math.abs(latitudeDeg - decl);
  if (sza >= 90) return 0;
  const mu = Math.cos((sza * Math.PI) / 180);
  return 12.5 * mu ** 2.42 * (ozoneDu / 300) ** -1.23;
}

/** Solar declination, degrees (Cooper 1969 approximation). */
export function solarDeclinationDeg(dayOfYear: number): number {
  return 23.44 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
}

/** Noon solar elevation, degrees above the horizon. */
export function noonSolarElevationDeg(latitudeDeg: number, dayOfYear: number): number {
  return 90 - Math.abs(latitudeDeg - solarDeclinationDeg(dayOfYear));
}

// ---------------------------------------------------------------------------------------------
// Fitzpatrick skin types and sunburn
// ---------------------------------------------------------------------------------------------

export type FitzpatrickType = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI';
export const FITZPATRICK_TYPES: FitzpatrickType[] = ['I', 'II', 'III', 'IV', 'V', 'VI'];

export interface SkinPhototype {
  type: FitzpatrickType;
  /** Burning and tanning history (Fitzpatrick 1988). */
  reaction: string;
  description: string;
  /** Typical minimal erythema dose, J/m² erythemally weighted (approximate; ranges overlap widely). */
  medJPerM2: number;
  /** The same in standard erythema doses. */
  medSed: number;
}

/**
 * Fitzpatrick sun-reactive skin types (Fitzpatrick 1988). MED values are typical figures used in
 * photobiology texts (e.g. Diffey 2002): I ≈ 200, II ≈ 250, III ≈ 350, IV ≈ 450, V ≈ 600, VI ≈ 1000
 * J/m² — approximate; individual MEDs vary roughly two- to threefold within a type.
 */
export const PHOTOTYPES: Record<FitzpatrickType, SkinPhototype> = {
  I: { type: 'I', reaction: 'Always burns, never tans', description: 'Very fair skin, often red or blond hair, freckles, blue eyes', medJPerM2: 200, medSed: 2 },
  II: { type: 'II', reaction: 'Burns easily, tans minimally', description: 'Fair skin, light hair and eyes', medJPerM2: 250, medSed: 2.5 },
  III: { type: 'III', reaction: 'Burns moderately, tans gradually', description: 'Light-brown (medium) skin', medJPerM2: 350, medSed: 3.5 },
  IV: { type: 'IV', reaction: 'Burns minimally, always tans well', description: 'Moderate brown (olive) skin', medJPerM2: 450, medSed: 4.5 },
  V: { type: 'V', reaction: 'Rarely burns, tans profusely', description: 'Dark-brown skin', medJPerM2: 600, medSed: 6 },
  VI: { type: 'VI', reaction: 'Never burns (deeply pigmented)', description: 'Deeply pigmented dark-brown to black skin', medJPerM2: 1000, medSed: 10 },
};

/**
 * Minutes of exposure to reach one MED (just-perceptible sunburn at 24 h) at a constant UV index:
 * t = MED / (UVI/40) seconds, multiplied by the sunscreen SPF (an SPF is by definition the ratio of
 * MEDs with and without the product at 2 mg/cm²). People typically apply 0.5–1 mg/cm², giving a
 * fraction of the labelled protection — `applicationFraction` scales the SPF linearly as a rough
 * guide (protection actually falls more steeply). Example: type II, UVI 10 → ≈ 17 min; SPF 30 → ≈ 8 h.
 */
export function minutesToErythema(type: FitzpatrickType, uvIndex: number, spf = 1, applicationFraction = 1): number {
  const e = erythemalIrradianceWm2(uvIndex);
  if (e <= 0) return Infinity;
  const effSpf = Math.max(1, 1 + (Math.max(1, spf) - 1) * clamp(applicationFraction, 0, 1));
  return (PHOTOTYPES[type].medJPerM2 / e / 60) * effSpf;
}

/** Erythemal dose received, in MEDs, for a time at a UV index. */
export function dosesInMed(type: FitzpatrickType, uvIndex: number, minutes: number, spf = 1): number {
  const t = minutesToErythema(type, uvIndex, spf);
  return Number.isFinite(t) ? Math.max(0, minutes) / t : 0;
}

/** Sunburn grade from the dose in MEDs (approximate clinical grading): < 1 none, 1–2 just pink, 2–4 red/painful, ≥ 4 blistering. */
export function sunburnGrade(med: number): 'none' | 'faint' | 'moderate' | 'severe-blistering' {
  if (med < 1) return 'none';
  if (med < 2) return 'faint';
  if (med < 4) return 'moderate';
  return 'severe-blistering';
}

// ---------------------------------------------------------------------------------------------
// Vitamin D
// ---------------------------------------------------------------------------------------------

/**
 * Semi-quantitative vitamin D3 estimate, IU-equivalent of an oral dose. Holick (2007): one MED to the
 * whole body in a bathing suit ≈ 10 000–25 000 IU orally (15 000 used here); arms and legs at ½ MED
 * ≈ 3000 IU. Dose scales with the fraction of skin exposed and with the exposure in MEDs, saturating
 * near 1 MED per session because previtamin D3 photoisomerises to inactive lumisterol and tachysterol.
 * MED-based scaling makes darker skin need longer for the same yield (melanin competes for UVB).
 * Very approximate; age (less 7-dehydrocholesterol), glass (blocks UVB) and sunscreen cut synthesis.
 */
export function vitaminDEstimateIU(type: FitzpatrickType, uvIndex: number, minutes: number, exposedSkinFraction: number): number {
  const med = dosesInMed(type, uvIndex, minutes);
  const effective = 1 - Math.exp(-med / 0.6); // saturating, ≈ 0.81 at 1 MED (shape approximate)
  return 15000 * clamp(exposedSkinFraction, 0, 1) * effective / (1 - Math.exp(-1 / 0.6));
}

export type VitaminDSeason = 'good' | 'limited' | 'negligible';

/**
 * Whether midday sun can make vitamin D: with the sun low the atmospheric path is long and ozone
 * removes the 290–315 nm UVB. Webb et al. (1988) found no cutaneous synthesis in Boston (42 °N) from
 * November to February and in Edmonton (52 °N) from October to March. Rule here: noon solar elevation
 * < 35° negligible, 35–50° limited, > 50° good (thresholds approximate; cf. the "shadow rule").
 */
export function vitaminDSeason(latitudeDeg: number, dayOfYear: number): { season: VitaminDSeason; elevationDeg: number; note: string } {
  const el = noonSolarElevationDeg(latitudeDeg, dayOfYear);
  if (el < 35) return { season: 'negligible', elevationDeg: el, note: '"Vitamin D winter": too little UVB reaches the ground even at noon; diet or supplements needed.' };
  if (el <= 50) return { season: 'limited', elevationDeg: el, note: 'Some synthesis around midday on clear days.' };
  return { season: 'good', elevationDeg: el, note: 'Short midday exposures (well under the time to burn) make useful amounts.' };
}

/** The vitamin D pathway (OpenStax A&P 2e §5.3). */
export const VITAMIN_D_PATHWAY = [
  '7-dehydrocholesterol in the stratum basale and stratum spinosum absorbs UVB (≈ 290–315 nm, peak ≈ 295–297 nm).',
  'It opens to previtamin D3, which heat-isomerises over hours to cholecalciferol (vitamin D3).',
  'Liver: 25-hydroxylation to calcidiol (25(OH)D, the circulating store measured in blood tests).',
  'Kidney: 1α-hydroxylation (stimulated by PTH) to calcitriol (1,25(OH)₂D), the active hormone.',
  'Calcitriol increases intestinal calcium and phosphate absorption; deficiency causes rickets (children) and osteomalacia (adults).',
] as const;

// ---------------------------------------------------------------------------------------------
// Melanin
// ---------------------------------------------------------------------------------------------

/** Melanin and melanosome biology (OpenStax A&P 2e §5.1; Robbins 10e ch. 22). */
export const MELANIN_NOTES = {
  melanocytes: 'Melanocytes (structure `melanocytes`) sit in the stratum basale, about one per 4–10 basal keratinocytes; each supplies ≈ 36 keratinocytes through its dendrites (the epidermal melanin unit).',
  sameNumber: 'All skin types have roughly the same number of melanocytes per area. Colour differences come from melanosome size, number, packaging and the type of melanin.',
  melanosomes: 'Dark skin: large, single, eumelanin-rich melanosomes dispersed through the keratinocytes and degraded slowly. Light skin: smaller melanosomes clustered in membrane-bound groups and degraded faster.',
  types: 'Eumelanin is brown-black and photoprotective; pheomelanin is red-yellow, contains sulphur (cysteine), protects poorly and can generate reactive oxygen species under UV — red hair and freckles reflect MC1R variants favouring pheomelanin.',
  synthesis: 'Tyrosinase converts tyrosine to DOPA and dopaquinone inside melanosomes; albinism (OCA1) is loss of tyrosinase.',
  caps: 'Transferred melanosomes gather over the keratinocyte nucleus as supranuclear caps, shading DNA from UV.',
  tanning: 'Immediate pigment darkening (UVA, minutes, oxidation of existing melanin) → persistent pigment darkening (hours) → delayed tanning (from ≈ 2–3 days): UVB DNA damage activates p53 → POMC → α-MSH, which acts on MC1R to boost eumelanin synthesis. A tan gives only about SPF 2–4.',
  otherColours: 'Haemoglobin (pink, red, cyanosis blue), carotene (yellow, stratum corneum and fat) and bilirubin (jaundice) also colour skin.',
} as const;

// ---------------------------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------------------------

export interface AgeingStage {
  decade: 20 | 30 | 40 | 50 | 60 | 70 | 80;
  intrinsic: string[];
  photoageing: string[];
}

/**
 * Skin ageing by decade: intrinsic (chronological, genetic, hormonal — seen on sun-protected skin
 * such as the inner upper arm) vs extrinsic photoageing (chronic UV on face, neck, forearms, backs of
 * hands). Ages are typical and approximate (OpenStax A&P 2e §5.4; Yaar & Gilchrest 2007).
 */
export const AGEING_BY_DECADE: AgeingStage[] = [
  { decade: 20, intrinsic: ['Peak dermal collagen; epidermal turnover ≈ 4 weeks'], photoageing: ['Early freckling and uneven pigment on exposed skin'] },
  { decade: 30, intrinsic: ['Collagen falls ≈ 1 % per year; fine expression lines'], photoageing: ['Solar lentigines begin; fine wrinkles around the eyes'] },
  { decade: 40, intrinsic: ['Slower turnover and repair; drier skin as sebum falls'], photoageing: ['Deeper wrinkles, mottled pigment, telangiectasia'] },
  { decade: 50, intrinsic: ['Menopause: oestrogen loss accelerates collagen loss (≈ 30 % in the first 5 years)'], photoageing: ['Solar elastosis (yellow, thickened, leathery skin); actinic keratoses'] },
  { decade: 60, intrinsic: ['Thinner, flatter dermal–epidermal junction (rete ridges flatten): skin tears and blisters more easily'], photoageing: ['Coarse deep wrinkles; precancers and basal cell carcinomas become common'] },
  { decade: 70, intrinsic: ['Fewer melanocytes and Langerhans cells; fewer sweat glands — worse thermoregulation'], photoageing: ['Purpura from fragile vessels (senile purpura); cutis rhomboidalis on the neck'] },
  { decade: 80, intrinsic: ['Thin, lax, dry skin; slower wound healing; less subcutaneous fat'], photoageing: ['Highest rates of squamous cell carcinoma and lentigo maligna melanoma'] },
];

/** Intrinsic vs photoageing, tissue level (Yaar & Gilchrest 2007). */
export const INTRINSIC_VS_PHOTO = {
  intrinsic: 'Fine wrinkles, smooth pale thin skin, atrophic dermis with fewer fibroblasts and less collagen, flattened dermal–epidermal junction.',
  photo: 'Coarse wrinkles, leathery yellowish skin, mottled pigment and lentigines, telangiectasia; histology shows solar elastosis (masses of abnormal elastic material in the dermis), driven by UV-induced matrix metalloproteinases and reactive oxygen species. Up to ≈ 80 % of visible facial ageing is attributed to sun (approximate).',
} as const;

/** Relative dermal collagen content vs age (1 at ≤ 20 y, −1 %/year thereafter, floor 0.3; approximate, Shuster S et al. 1975 Br J Dermatol 93:639). */
export function relativeCollagen(ageYears: number): number {
  return clamp(1 - 0.01 * Math.max(0, ageYears - 20), 0.3, 1);
}

/** Epidermal turnover time, days: ≈ 28 d in young adults, rising to ≈ 40–60 d in the elderly (linear, approximate). */
export function epidermalTurnoverDays(ageYears: number): number {
  return clamp(28 + 0.45 * Math.max(0, ageYears - 25), 28, 60);
}

// ---------------------------------------------------------------------------------------------
// Disorders
// ---------------------------------------------------------------------------------------------

export type DisorderId = 'acne' | 'atopic-eczema' | 'psoriasis' | 'vitiligo' | 'basal-cell-carcinoma' | 'squamous-cell-carcinoma' | 'melanoma';

export interface DisorderCard {
  id: DisorderId;
  name: string;
  category: 'inflammatory' | 'autoimmune' | 'neoplastic';
  /** Structures involved (STRUCTURES.md ids). */
  structures: string[];
  pathophysiology: string;
  features: string;
  epidemiology: string;
  note: string;
}

/** Disorder cards (Robbins Basic Pathology 10e ch. 22; OpenStax A&P 2e §5.4). Epidemiological figures approximate. */
export const DISORDERS: Record<DisorderId, DisorderCard> = {
  acne: {
    id: 'acne', name: 'Acne vulgaris', category: 'inflammatory',
    structures: ['sebaceous-gland', 'hair-follicle'],
    pathophysiology: 'A disease of the pilosebaceous unit: androgens increase sebum; follicular hyperkeratinisation plugs the follicle (comedo); Cutibacterium acnes proliferates in the sebum and triggers inflammation; rupture of the follicle wall releases contents into the dermis.',
    features: 'Open (black) and closed (white) comedones, papules, pustules, nodules and cysts on the face, chest and back; scarring in severe disease.',
    epidemiology: 'Affects ≈ 85 % of adolescents to some degree.',
    note: 'Blackheads are dark from oxidised melanin and lipid, not dirt. Isotretinoin shrinks sebaceous glands but is highly teratogenic.',
  },
  'atopic-eczema': {
    id: 'atopic-eczema', name: 'Atopic eczema (dermatitis)', category: 'inflammatory',
    structures: ['stratum-corneum', 'stratum-granulosum', 'langerhans-cells'],
    pathophysiology: 'Barrier defect plus type 2 (Th2: IL-4, IL-13, IL-31) inflammation. Loss-of-function mutations in filaggrin (stratum granulosum, keratohyalin granules) weaken the stratum corneum, letting water out and allergens and Staphylococcus aureus in.',
    features: 'Intensely itchy, dry, ill-defined red patches; on the cheeks and extensors in infants, flexures (elbows, knees) in children and adults; lichenification from scratching.',
    epidemiology: 'Up to ≈ 20 % of children, many outgrow it; part of the atopic march with asthma and hay fever.',
    note: 'Treated with emollients to restore the barrier, topical steroids or calcineurin inhibitors, and biologics such as dupilumab (IL-4Rα) in severe disease.',
  },
  psoriasis: {
    id: 'psoriasis', name: 'Psoriasis', category: 'autoimmune',
    structures: ['stratum-corneum', 'stratum-spinosum', 'stratum-basale', 'papillary-dermis', 'superficial-plexus'],
    pathophysiology: 'T-cell-mediated (IL-23/Th17, TNF) inflammation drives keratinocyte hyperproliferation: epidermal turnover shortens from ≈ 28 days to ≈ 3–5 days, so cells reach the surface with nuclei still present (parakeratosis) and the granular layer is lost; dermal papillae elongate with dilated capillaries.',
    features: 'Well-demarcated red plaques with silvery scale on extensor surfaces (elbows, knees), scalp and lower back; pinpoint bleeding when scale is removed (Auspitz sign); Koebner phenomenon; nail pitting and onycholysis.',
    epidemiology: '≈ 2–3 % of people of European descent; psoriatic arthritis in up to ≈ 30 %.',
    note: 'Associated with metabolic syndrome and cardiovascular disease. Biologics target TNF, IL-17 and IL-23.',
  },
  vitiligo: {
    id: 'vitiligo', name: 'Vitiligo', category: 'autoimmune',
    structures: ['melanocytes', 'stratum-basale'],
    pathophysiology: 'Autoimmune destruction of melanocytes by cytotoxic CD8+ T cells (interferon-γ / CXCL10 axis), on a background of melanocyte oxidative stress.',
    features: 'Sharply defined, milk-white (depigmented, not hypopigmented) macules, often symmetrical on the face, hands, around orifices and at sites of trauma; enhanced under Wood’s (UVA) lamp; white hairs in patches.',
    epidemiology: '≈ 0.5–2 % worldwide in all skin types; more visible in darker skin.',
    note: 'Associated with autoimmune thyroid disease, type 1 diabetes and pernicious anaemia. Depigmented skin burns easily (no melanin).',
  },
  'basal-cell-carcinoma': {
    id: 'basal-cell-carcinoma', name: 'Basal cell carcinoma', category: 'neoplastic',
    structures: ['stratum-basale', 'papillary-dermis', 'reticular-dermis'],
    pathophysiology: 'Malignant tumour of basal-layer (follicular-type) keratinocytes; UV-induced mutations activate the Hedgehog pathway (PTCH1 loss, SMO activation). Nests of basaloid cells with peripheral palisading.',
    features: 'Pearly, translucent papule with rolled edges and telangiectasia on sun-exposed skin (face, especially nose); can ulcerate centrally (rodent ulcer).',
    epidemiology: 'The most common human cancer (≈ 80 % of non-melanoma skin cancers).',
    note: 'Locally invasive but metastasises extremely rarely; Mohs surgery spares tissue on the face.',
  },
  'squamous-cell-carcinoma': {
    id: 'squamous-cell-carcinoma', name: 'Squamous cell carcinoma', category: 'neoplastic',
    structures: ['stratum-spinosum', 'stratum-granulosum', 'stratum-corneum', 'papillary-dermis', 'reticular-dermis'],
    pathophysiology: 'Malignant tumour of keratinocytes of the spinous layer; cumulative UV (TP53 mutations with C→T "UV signature"), often via actinic keratosis then carcinoma in situ (Bowen disease). Keratin pearls on histology.',
    features: 'Scaly, crusted or ulcerated, often tender nodule on chronically sun-damaged skin (scalp, ears, lower lip, backs of hands); may arise in chronic ulcers or burn scars (Marjolin ulcer).',
    epidemiology: 'Second most common skin cancer; risk ≈ 65–100× higher in organ-transplant recipients on immunosuppression (approximate).',
    note: 'Metastasis risk is low (≈ 2–5 %) but higher on the lip and ear, in immunosuppression and in tumours > 2 cm.',
  },
  melanoma: {
    id: 'melanoma', name: 'Melanoma', category: 'neoplastic',
    structures: ['melanocytes', 'stratum-basale', 'papillary-dermis', 'reticular-dermis'],
    pathophysiology: 'Malignant tumour of melanocytes. Intermittent intense UV (blistering sunburns in childhood) is a major risk; ≈ 50 % carry BRAF V600E, ≈ 20 % NRAS mutations. Radial growth phase (in epidermis) precedes vertical growth into the dermis, when metastasis becomes possible.',
    features: 'A changing pigmented lesion: Asymmetry, irregular Border, Colour variegation (shades of brown, black, red, white, blue), Diameter > 6 mm, Evolving. Subtypes: superficial spreading (commonest), nodular, lentigo maligna, acral lentiginous (palms, soles, nails — commonest type in darker skin).',
    epidemiology: 'Fewer than 5 % of skin cancers but most skin-cancer deaths.',
    note: 'Breslow thickness (mm from the granular layer to the deepest tumour cell) is the strongest prognostic factor. BRAF/MEK inhibitors and immune checkpoint inhibitors (anti-PD-1, anti-CTLA-4) transformed treatment of metastatic disease.',
  },
};

// ---------------------------------------------------------------------------------------------
// ABCDE melanoma checker
// ---------------------------------------------------------------------------------------------

export interface LesionDescription {
  /** One half does not mirror the other. */
  asymmetric: boolean;
  /** Ragged, notched, blurred or irregular border. */
  irregularBorder: boolean;
  /** Number of distinct colours (tan, dark brown, black, red, white, blue-grey). */
  colourCount: number;
  /** Largest diameter, mm. */
  diameterMm: number;
  /** Changing in size, shape, colour, elevation or symptoms (itch, bleeding) over weeks to months. */
  evolving: boolean;
}

export type AbcdeLetter = 'A' | 'B' | 'C' | 'D' | 'E';

export interface AbcdeResult {
  flags: Record<AbcdeLetter, boolean>;
  count: number;
  concern: 'low' | 'moderate' | 'high';
  reasons: string[];
  message: string;
}

/** Diameter above which the D criterion is positive, mm (Abbasi 2004: > 6 mm, about a pencil eraser). */
export const ABCDE_DIAMETER_MM = 6;

/**
 * ABCDE criteria (Abbasi et al. 2004, adding E — evolving — to the 1985 ABCD of Friedman et al.):
 * A asymmetry, B border irregularity, C colour variegation (≥ 2 distinct colours here), D diameter
 * > 6 mm, E evolving. Concern: E alone or any 2+ criteria → high; one criterion → moderate; none → low.
 * Evolution is the most important single feature; small (< 6 mm) and nodular melanomas exist
 * (nodular ones follow "EFG": elevated, firm, growing), so any changing lesion deserves review.
 * TEACHING AID ONLY.
 */
export function abcdeCheck(lesion: LesionDescription): AbcdeResult {
  const flags: Record<AbcdeLetter, boolean> = {
    A: lesion.asymmetric,
    B: lesion.irregularBorder,
    C: lesion.colourCount >= 2,
    D: lesion.diameterMm > ABCDE_DIAMETER_MM,
    E: lesion.evolving,
  };
  const reasons: string[] = [];
  if (flags.A) reasons.push('Asymmetry: the two halves do not match.');
  if (flags.B) reasons.push('Border: irregular, ragged or blurred edge.');
  if (flags.C) reasons.push(`Colour: ${lesion.colourCount} different colours (variegation).`);
  if (flags.D) reasons.push(`Diameter: ${lesion.diameterMm} mm, larger than ${ABCDE_DIAMETER_MM} mm.`);
  if (flags.E) reasons.push('Evolving: the lesion is changing — the most important warning sign.');
  const count = Object.values(flags).filter(Boolean).length;
  const concern: AbcdeResult['concern'] = flags.E || count >= 2 ? 'high' : count === 1 ? 'moderate' : 'low';
  const message = concern === 'high'
    ? 'Several warning features: in real life this lesion should be examined promptly by a doctor (dermoscopy, possible excision).'
    : concern === 'moderate'
      ? 'One warning feature: worth having checked and photographed to monitor for change.'
      : 'No ABCDE features — but any new, changing or "ugly duckling" lesion (unlike your other moles) still deserves review.';
  return { flags, count, concern, reasons, message };
}
