import type { AnatomicalStructure, SimulationDefinition } from '../contract/schema';
import { anchors, sliceAtForMm } from './anchors';

/**
 * The skin lab as data. Statements follow the cited sources: OpenStax A&P 2e ch. 5 for the core
 * anatomy and physiology, Ross & Pawlina (Histology, 8e) for microscopic structure and dimensions,
 * Kandel (Principles of Neural Science, 6e) for the receptors, Braverman (2000) for the
 * microcirculation, Lee et al. (2008) and Keegan & Garrett (1948) for dermatomes; clinical notes are
 * standard teaching facts (Bolognia, Dermatology 4e). Text is written for this lab; nothing is copied.
 */

const OS = 'openstax-ch5';
const HIST = [OS, 'ross-8'] as const;
const RECEP = ['kandel-6', 'ross-8', 'zimmerman-2014'] as const;
const VESS = ['braverman-2000', 'ross-8', OS] as const;

type M = Omit<AnatomicalStructure, 'kind' | 'synonyms' | 'related' | 'side'> & { synonyms?: string[]; related?: string[]; side?: AnatomicalStructure['side'] };
const mesh = (s: M): AnatomicalStructure => ({ side: 'midline', ...s, kind: 'mesh', synonyms: s.synonyms ?? [], related: s.related ?? [] });
const group = (s: Omit<M, 'organ'> & { members: string[] }): AnatomicalStructure => ({ side: 'midline', ...s, kind: 'group', synonyms: s.synonyms ?? [], related: s.related ?? [] });

const MODELLED = 'Modelled for this lab at true histological scale (1 unit = 1 mm); shapes simplified (see Source & credits).';
const T = anchors['layer-thickness-mm'];
const um = (mm: number) => `${Math.round(mm * 1000)} µm`;

const structures: AnatomicalStructure[] = [
  // ── Groups ────────────────────────────────────────────────────────────────
  group({
    id: 'skin-surface', label: 'Skin of the whole body', synonyms: ['integument', 'cutis', 'body surface'], layer: 'body',
    members: ['body-skin', 'scalp-hair', 'pubic-hair'],
    summary: 'The integument: the body’s largest organ, about 1.8 m² and 15 % of body weight in an adult, with its hair.',
    function: 'A self-renewing barrier against water loss, microbes, chemicals and ultraviolet light; a sense organ; a heat exchanger that sets how much heat leaves the body; an immune outpost; and the site of vitamin D synthesis.',
    clinical: 'Burn size is estimated as a percentage of this surface (rule of nines, Lund–Browder chart, or the patient’s palm ≈ 1 %).',
    related: ['epidermis', 'dermis'], sources: [OS, 'bodyparts3d'],
  }),
  group({
    id: 'epidermis', label: 'Epidermis', synonyms: ['cuticle', 'keratinised stratified squamous epithelium'], layer: 'epidermis',
    members: ['stratum-corneum', 'stratum-lucidum', 'stratum-granulosum', 'stratum-spinosum', 'stratum-basale', 'melanocytes', 'langerhans-cells'],
    summary: `Avascular keratinised stratified squamous epithelium: about ${um(T.thin.epidermis)} on thin skin and ${T.thick.epidermis.toFixed(1)} mm on palms and soles, where a fifth layer, the stratum lucidum, appears.`,
    function: 'Keratinocytes made in the basal layer move up over about four weeks, filling with keratin and lipids and dying to form the cornified barrier. Melanocytes shade the dividing cells with melanin; Langerhans cells sample antigens; Merkel cells serve touch. Nourishment diffuses up from the dermal capillaries.',
    clinical: 'Superficial (first-degree) burns and abrasions limited to the epidermis heal without a scar, because the basal cells and the hair follicles survive to regrow it.',
    related: ['dermis'], sources: [...HIST],
  }),
  group({
    id: 'dermis', label: 'Dermis', synonyms: ['corium', 'true skin'], layer: 'dermis',
    members: ['papillary-dermis', 'reticular-dermis', 'collagen-bundles'],
    summary: 'Connective tissue under the epidermis, 1–3 mm thick: a thin loose papillary layer and a thick, dense irregular reticular layer.',
    function: 'Gives skin its strength, elasticity and pliability (collagen and elastic fibres in a hydrated ground substance), and holds the vessels, nerves, receptors, glands and follicles.',
    clinical: 'Partial-thickness burns damage the dermis; deep ones heal slowly from surviving follicles and glands with scarring, and full-thickness burns destroy it, needing grafts.',
    related: ['epidermis', 'hypodermis'], sources: [...HIST],
  }),
  group({
    id: 'hypodermis', label: 'Hypodermis (subcutis)', synonyms: ['subcutaneous tissue', 'subcutis', 'superficial fascia', 'panniculus'], layer: 'hypodermis',
    members: ['subcutaneous-fat', 'fibrous-septa', 'deep-fascia'],
    summary: 'Fat lobules separated by fibrous septa, between the dermis and the deep fascia. Not part of the skin proper, but it anchors it.',
    function: 'Insulates, stores energy, cushions bony points and lets the skin glide over deeper structures; the septa (retinacula cutis) tether the dermis to the fascia.',
    clinical: 'Subcutaneous injections (insulin, heparin, some vaccines) are given here; inflammation of the septa or lobules is panniculitis.',
    related: ['dermis'], sources: [OS, 'ross-8'],
  }),
  group({
    id: 'hair-unit', label: 'Pilosebaceous unit', synonyms: ['hair follicle unit', 'pilosebaceous apparatus'], layer: 'appendages',
    members: ['hair-shaft', 'inner-root-sheath', 'hair-follicle', 'hair-bulb', 'hair-papilla', 'arrector-pili', 'sebaceous-gland', 'apocrine-gland', 'hair-follicle-plexus'],
    summary: 'The hair follicle with its shaft, its sebaceous gland and arrector pili muscle (and, in the axilla and groin, an apocrine gland).',
    function: 'Grows hair in cycles (anagen, catagen, telogen), oils the hair and skin, senses hair deflection, and holds the stem cells (in the bulge) that rebuild the follicle and help resurface wounds.',
    clinical: 'Acne starts in this unit (follicular plugging, sebum, Cutibacterium acnes, inflammation); folliculitis and boils (furuncles) are infections of the follicle.',
    related: ['epidermis', 'dermis'], sources: [...HIST],
  }),
  group({
    id: 'skin-glands', label: 'Skin glands', synonyms: ['cutaneous glands', 'sweat glands', 'exocrine glands of skin'], layer: 'appendages',
    members: ['sebaceous-gland', 'eccrine-gland', 'apocrine-gland'],
    summary: 'Sebaceous (holocrine, oil), eccrine (merocrine, watery sweat) and apocrine (thicker secretion into hair follicles) glands.',
    function: 'Eccrine sweat cools the body by evaporation and wets the palms for grip; sebum waterproofs and softens; apocrine secretion, broken down by bacteria, gives body odour.',
    related: ['hair-unit'], sources: [...HIST],
  }),
  group({
    id: 'cutaneous-receptors', label: 'Cutaneous receptors', synonyms: ['mechanoreceptors', 'sensory receptors', 'touch receptors'], layer: 'receptors',
    members: ['meissner-corpuscle', 'merkel-discs', 'pacinian-corpuscle', 'ruffini-ending', 'free-nerve-endings', 'hair-follicle-plexus'],
    summary: 'Low-threshold mechanoreceptors (Meissner, Merkel, Pacinian, Ruffini, follicle endings) and free nerve endings (pain, temperature, itch).',
    function: 'Each type encodes a feature of touch: Merkel (sustained pressure, edges, texture; slowly adapting type I), Meissner (flutter and slip; rapidly adapting I), Pacinian (high-frequency vibration; RA II), Ruffini (skin stretch; SA II). Their depth and receptive field size set their resolution.',
    clinical: 'Two-point discrimination and vibration sense (128 Hz tuning fork) test these pathways; vibration loss is an early sign of diabetic neuropathy.',
    related: ['cutaneous-nerve'], sources: [...RECEP],
  }),
  group({
    id: 'cutaneous-vessels', label: 'Cutaneous circulation', synonyms: ['skin blood supply', 'dermal plexuses', 'microcirculation'], layer: 'vessels',
    members: ['superficial-plexus', 'deep-plexus', 'lymphatic-vessels'],
    summary: 'Two horizontal plexuses joined by communicating vessels, with capillary loops in the papillae, and a parallel lymphatic network.',
    function: 'Skin blood flow far exceeds its own needs because it is the body’s radiator: it ranges from about 0.25 L/min in the cold to 6–8 L/min in severe heat stress, set mainly by sympathetic tone on the arterioles and arteriovenous anastomoses.',
    clinical: 'Capillary refill time and skin colour (pallor, cyanosis, flushing) are bedside signs of perfusion.',
    related: ['cutaneous-nerve'], sources: [...VESS],
  }),

  // ── Body ──────────────────────────────────────────────────────────────────
  mesh({
    id: 'body-skin', label: 'Skin (whole body)', synonyms: ['integument', 'body surface', 'rule of nines', 'dermatomes'], layer: 'body', organ: 'skin-surface',
    summary: 'The skin surface of an adult male (BodyParts3D), about 1.8 m². Colour it by rule-of-nines region or by dermatome, or click a region to open the skin block.',
    function: 'Each region’s share of the surface is the basis of burn assessment: head and neck 9 %, each upper limb 9 %, front and back of the trunk 18 % each, each lower limb 18 %, perineum 1 %. Each dermatome is the strip of skin supplied by one spinal nerve root.',
    clinical: 'Shingles (herpes zoster) erupts in one dermatome; a sensory level on the trunk points to the level of a spinal cord lesion (T4 nipple, T10 umbilicus).',
    modelNote: 'Region and dermatome colours are classified from vertex position on this mesh; boundaries are approximate and real dermatomes overlap.',
    related: ['scalp-hair', 'pubic-hair'], sources: ['bodyparts3d', OS, 'lee-2008', 'keegan-1948', 'wallace-1951'],
  }),
  mesh({
    id: 'scalp-hair', label: 'Hair of the head', synonyms: ['scalp hair', 'capilli'], layer: 'body', organ: 'skin-surface',
    summary: 'About 100 000 terminal hairs, each growing about 1 cm a month during an anagen phase lasting years.',
    function: 'Protects the scalp from ultraviolet light and heat loss.',
    clinical: 'Telogen effluvium (shedding months after illness or childbirth) and androgenetic alopecia are the commonest causes of hair loss.',
    related: ['hair-shaft'], sources: ['bodyparts3d', OS],
  }),
  mesh({
    id: 'pubic-hair', label: 'Pubic hair', synonyms: ['pubes'], layer: 'body', organ: 'skin-surface',
    summary: 'Terminal hair that develops at puberty under androgen control, with apocrine glands in its follicles.',
    function: 'A secondary sexual characteristic; apocrine secretions here and in the axilla carry body odour.',
    related: ['apocrine-gland'], sources: ['bodyparts3d', OS],
  }),

  // ── Epidermis ─────────────────────────────────────────────────────────────
  mesh({
    id: 'stratum-corneum', label: 'Stratum corneum', synonyms: ['horny layer', 'cornified layer', 'keratin layer'], layer: 'epidermis', organ: 'epidermis',
    summary: `15–30 layers of flat, dead, anucleate corneocytes: about ${um(T.thin.corneum)} on thin skin and ${um(T.thick.corneum)} on the palm in this block.`,
    function: 'The main barrier: keratin-filled corneocytes held in lipid lamellae (ceramides, cholesterol, fatty acids) — the “bricks and mortar” — stop water loss and entry of microbes and chemicals. Cells are shed (desquamation) from the surface continuously.',
    clinical: 'Calluses and corns are a thickened corneum over pressure points; eczema, ichthyosis and psoriasis are disorders of this barrier.',
    modelNote: 'Thickness true to life; the surface shows the creases of thin skin and the friction ridges of thick skin, with pores and the hair’s ostium.',
    related: ['stratum-lucidum', 'stratum-granulosum'], sources: [...HIST],
  }),
  mesh({
    id: 'stratum-lucidum', label: 'Stratum lucidum', synonyms: ['clear layer'], layer: 'epidermis', organ: 'epidermis',
    summary: `A thin, clear, eosinophilic band of flattened dead cells (${um(T.thick.lucidum)}) found only in thick skin.`,
    function: 'Cells packed with eleidin, an intermediate product of keratinisation; adds to the barrier where friction is greatest (palms, soles).',
    modelNote: MODELLED,
    related: ['stratum-corneum', 'stratum-granulosum'], sources: [...HIST],
  }),
  mesh({
    id: 'stratum-granulosum', label: 'Stratum granulosum', synonyms: ['granular layer'], layer: 'epidermis', organ: 'epidermis',
    summary: '1–5 layers of flattening keratinocytes with dark keratohyalin granules and lamellar bodies.',
    function: 'Here cells die in a programmed way: keratohyalin (profilaggrin) bundles keratin filaments, lamellar bodies release the barrier lipids, and tight junctions seal the layer.',
    clinical: 'Loss-of-function variants of filaggrin weaken the barrier and predispose to atopic eczema and ichthyosis vulgaris.',
    modelNote: MODELLED,
    related: ['stratum-spinosum', 'stratum-corneum'], sources: [...HIST],
  }),
  mesh({
    id: 'stratum-spinosum', label: 'Stratum spinosum', synonyms: ['prickle cell layer', 'spinous layer', 'Malpighian layer'], layer: 'epidermis', organ: 'epidermis',
    summary: 'Several layers of polyhedral keratinocytes joined by desmosomes, which shrinkage in sections turns into “spines”; it fills the rete ridges between the dermal papillae.',
    function: 'Gives the epidermis tensile strength (keratin filaments anchored at desmosomes); its cells start making keratin and lamellar bodies. Langerhans cells sit among them.',
    clinical: 'Autoantibodies against desmosomal desmoglein split this layer in pemphigus vulgaris; squamous cell carcinoma arises from these keratinocytes.',
    modelNote: MODELLED,
    related: ['stratum-basale', 'langerhans-cells'], sources: [...HIST],
  }),
  mesh({
    id: 'stratum-basale', label: 'Stratum basale', synonyms: ['basal layer', 'stratum germinativum', 'germinal layer'], layer: 'epidermis', organ: 'epidermis',
    summary: 'One layer of cuboidal to columnar keratinocyte stem and progenitor cells on the basement membrane, with melanocytes and Merkel cells among them.',
    function: 'Renews the epidermis by mitosis; its cells hold melanin taken up from melanocytes as caps over their nuclei. Hemidesmosomes anchor it to the basement membrane, which follows every dermal papilla (the dermal–epidermal junction).',
    clinical: 'Basal cell carcinoma, the commonest human cancer, arises from these cells; in bullous pemphigoid antibodies attack the hemidesmosomes and the epidermis lifts off whole.',
    modelNote: MODELLED,
    related: ['melanocytes', 'merkel-discs', 'papillary-dermis'], sources: [...HIST],
  }),
  mesh({
    id: 'melanocytes', label: 'Melanocytes', synonyms: ['pigment cells', 'dendritic melanocytes'], layer: 'epidermis', organ: 'epidermis',
    summary: 'Neural-crest-derived dendritic cells in the basal layer, about 1 for every 4–10 basal keratinocytes (≈1 000–1 500 per mm²).',
    function: 'Make melanin in melanosomes and pass them along their dendrites to about 36 keratinocytes each (the epidermal melanin unit). Skin colour depends on melanosome number, size and type (eumelanin, pheomelanin), not on the number of melanocytes.',
    clinical: 'Melanoma arises from melanocytes (check moles with ABCDE); vitiligo is their autoimmune loss; albinism is a failure of melanin synthesis.',
    modelNote: 'Instanced cells at about one-seventh of the real density, so the block stays light to draw.',
    related: ['stratum-basale', 'langerhans-cells'], sources: [...HIST],
  }),
  mesh({
    id: 'langerhans-cells', label: 'Langerhans cells', synonyms: ['epidermal dendritic cells', 'intraepidermal macrophages'], layer: 'epidermis', organ: 'epidermis',
    summary: 'Bone-marrow-derived dendritic cells in the stratum spinosum, recognised by Birbeck granules.',
    function: 'Capture antigens that cross the barrier and carry them through the lymphatics to regional lymph nodes, where they present them to T cells.',
    clinical: 'They start allergic contact dermatitis (for example to nickel); ultraviolet light depletes them, one reason sunburn suppresses skin immunity.',
    modelNote: 'Instanced cells at about one-seventh of the real density.',
    related: ['stratum-spinosum', 'lymphatic-vessels'], sources: [...HIST],
  }),

  // ── Dermis ────────────────────────────────────────────────────────────────
  mesh({
    id: 'papillary-dermis', label: 'Papillary dermis', synonyms: ['papillary layer', 'dermal papillae', 'stratum papillare'], layer: 'dermis', organ: 'dermis',
    summary: 'Loose connective tissue (fine type I and III collagen, elastic fibres) forming the dermal papillae that interlock with the epidermal rete ridges.',
    function: 'The interlocking ridges resist shear between epidermis and dermis. The papillae carry capillary loops that nourish the avascular epidermis, Meissner corpuscles and free nerve endings. In thick skin they lie in double rows under each friction ridge.',
    clinical: 'Shearing at the junction raises blisters; flattening of the papillae with age makes skin tear and bruise easily.',
    modelNote: MODELLED,
    related: ['stratum-basale', 'reticular-dermis', 'superficial-plexus', 'meissner-corpuscle'], sources: [...HIST],
  }),
  mesh({
    id: 'reticular-dermis', label: 'Reticular dermis', synonyms: ['reticular layer', 'stratum reticulare'], layer: 'dermis', organ: 'dermis',
    summary: 'Dense irregular connective tissue with thick interwoven collagen bundles and coarse elastic fibres; most of the dermis’s thickness.',
    function: 'Provides strength and recoil. The predominant direction of its bundles gives skin its tension (cleavage, Langer’s) lines.',
    clinical: 'Incisions along tension lines heal with finer scars; over-stretching tears the bundles as striae (stretch marks).',
    modelNote: MODELLED,
    related: ['papillary-dermis', 'collagen-bundles', 'deep-plexus'], sources: [...HIST],
  }),
  mesh({
    id: 'collagen-bundles', label: 'Collagen bundles', synonyms: ['collagen fibres', 'type I collagen'], layer: 'dermis', organ: 'dermis',
    summary: 'Bundles of type I collagen fibrils, tens of micrometres thick, interwoven in layers roughly parallel to the surface.',
    function: 'Bear the tensile load of the skin; fibroblasts make and remodel them, with elastic fibres returning the skin to shape.',
    clinical: 'Ultraviolet A breaks down dermal collagen (photoageing, wrinkles); defective collagen makes skin hyperextensible in Ehlers–Danlos syndrome.',
    modelNote: 'A representative sample of bundles; the texture on the cut faces stands for the rest.',
    related: ['reticular-dermis'], sources: [...HIST],
  }),

  // ── Hypodermis ────────────────────────────────────────────────────────────
  mesh({
    id: 'subcutaneous-fat', label: 'Subcutaneous fat', synonyms: ['adipose tissue', 'fat lobules', 'white fat'], layer: 'hypodermis', organ: 'hypodermis',
    summary: 'Lobules of large unilocular adipocytes (50–150 µm), each cell a thin rim of cytoplasm around one lipid droplet, with capillaries between them.',
    function: 'Insulates (fat conducts heat about a third as well as muscle), stores energy as triglyceride, cushions, and secretes hormones such as leptin.',
    clinical: 'Its thickness varies hugely by site, sex and body fat; it is measured with skinfold callipers.',
    modelNote: MODELLED,
    related: ['fibrous-septa', 'deep-fascia', 'pacinian-corpuscle'], sources: [OS, 'ross-8'],
  }),
  mesh({
    id: 'fibrous-septa', label: 'Fibrous septa', synonyms: ['retinacula cutis', 'interlobular septa', 'skin ligaments'], layer: 'hypodermis', organ: 'hypodermis',
    summary: 'Sheets of connective tissue dividing the fat into lobules and tying the dermis to the deep fascia; vessels and nerves run in them.',
    function: 'Anchor the skin (firmly on the palms, soles and scalp, loosely elsewhere) and carry the vessels and nerves to and from the dermis.',
    clinical: 'Cellulite reflects fat bulging between septa; on the palm their tight anchorage limits swelling, so infections there are very painful.',
    modelNote: 'Voronoi sheets ~0.1 mm thick between lobules ~1.5 mm across (real lobules are often larger).',
    related: ['subcutaneous-fat', 'deep-fascia'], sources: [OS, 'ross-8'],
  }),
  mesh({
    id: 'deep-fascia', label: 'Deep fascia', synonyms: ['investing fascia', 'fascia profunda'], layer: 'hypodermis', organ: 'hypodermis',
    summary: 'A dense, silvery sheet of collagen wrapping the muscles beneath the subcutaneous tissue.',
    function: 'Contains and separates muscle groups and gives attachment to muscles; perforating vessels and nerves pierce it to reach the skin.',
    clinical: 'Necrotising fasciitis spreads along the fascial planes; swelling inside an unyielding fascial compartment causes compartment syndrome.',
    modelNote: MODELLED,
    related: ['subcutaneous-fat', 'deep-plexus'], sources: ['ross-8', OS],
  }),

  // ── Appendages ────────────────────────────────────────────────────────────
  mesh({
    id: 'hair-shaft', label: 'Hair shaft', synonyms: ['hair', 'shaft', 'cortex', 'medulla', 'cuticle of hair'], layer: 'appendages', organ: 'hair-unit',
    summary: 'A column of fully keratinised dead cells — medulla, cortex and cuticle — about 70 µm thick in this terminal hair, emerging at about 55° to the surface.',
    function: 'Insulation, protection and touch: deflecting a hair stimulates the follicle’s nerve endings. Its colour comes from melanin added in the bulb.',
    clinical: 'Hair shaft disorders (for example trichorrhexis nodosa) make hair fragile; hair can record drug exposure over months.',
    modelNote: MODELLED,
    related: ['hair-follicle', 'hair-bulb'], sources: [...HIST],
  }),
  mesh({
    id: 'inner-root-sheath', label: 'Inner root sheath', synonyms: ['IRS', 'Henle layer', 'Huxley layer'], layer: 'appendages', organ: 'hair-unit',
    summary: 'Three thin layers (cuticle, Huxley, Henle) that keratinise with trichohyalin granules around the growing hair and break down at the isthmus.',
    function: 'Moulds and guides the shaft as it hardens; its cuticle interlocks with the hair’s own cuticle.',
    modelNote: MODELLED,
    related: ['hair-shaft', 'hair-follicle'], sources: ['ross-8'],
  }),
  mesh({
    id: 'hair-follicle', label: 'Hair follicle (outer root sheath)', synonyms: ['follicle', 'outer root sheath', 'ORS', 'infundibulum', 'bulge', 'connective tissue sheath'], layer: 'appendages', organ: 'hair-unit',
    summary: 'A tube of epidermis that dips obliquely into the dermis: the outer root sheath, a glassy membrane and a connective-tissue sheath. Regions: infundibulum (to the sebaceous duct), isthmus (to the arrector pili) and the lower follicle.',
    function: 'The bulge, at the arrector pili insertion, holds the follicle’s stem cells, which regrow the follicle each cycle and migrate out to resurface wounds.',
    clinical: 'Because follicles reach deep into the dermis, partial-thickness burns and donor sites re-epithelialise from them; their loss in full-thickness injury means grafting.',
    modelNote: MODELLED,
    related: ['hair-shaft', 'sebaceous-gland', 'arrector-pili', 'hair-follicle-plexus'], sources: [...HIST],
  }),
  mesh({
    id: 'hair-bulb', label: 'Hair bulb (matrix)', synonyms: ['bulb', 'hair matrix', 'matrix cells'], layer: 'appendages', organ: 'hair-unit',
    summary: 'The onion-shaped base of an anagen follicle, here at the dermis–hypodermis junction: rapidly dividing matrix cells, with melanocytes, cupped around the dermal papilla.',
    function: 'Matrix cells divide fast and differentiate into the hair and inner root sheath; melanocytes here colour the hair.',
    clinical: 'Its rapid division makes it vulnerable to chemotherapy (anagen effluvium); grey hair follows the loss of bulb melanocytes.',
    modelNote: MODELLED,
    related: ['hair-papilla', 'hair-shaft'], sources: [...HIST],
  }),
  mesh({
    id: 'hair-papilla', label: 'Dermal papilla of the hair', synonyms: ['follicular papilla', 'hair papilla', 'dermal papilla'], layer: 'appendages', organ: 'hair-unit',
    summary: 'A knot of specialised fibroblasts and capillaries invaginating the bulb from below.',
    function: 'Signals to the matrix and so controls the hair’s size and cycle; its capillaries feed the bulb. Androgen receptors here mediate hormonal effects on hair.',
    clinical: 'In androgenetic alopecia, dihydrotestosterone shrinks the papilla and the follicle miniaturises.',
    modelNote: MODELLED,
    related: ['hair-bulb', 'deep-plexus'], sources: ['ross-8'],
  }),
  mesh({
    id: 'arrector-pili', label: 'Arrector pili', synonyms: ['arrector pili muscle', 'erector pili', 'goosebumps muscle'], layer: 'appendages', organ: 'hair-unit',
    summary: 'A band of smooth muscle from the follicle’s connective-tissue sheath at the bulge to the papillary dermis, on the side towards which the hair leans.',
    function: 'Sympathetic (adrenergic) stimulation by cold or fear contracts it: the hair stands up, the skin dimples (goosebumps) and the sebaceous gland, lying between muscle and follicle, is squeezed.',
    clinical: 'Piloerection is part of the autonomic response to cold; in humans its insulating value is small.',
    modelNote: MODELLED,
    related: ['hair-follicle', 'sebaceous-gland', 'cutaneous-nerve'], sources: [...HIST],
  }),
  mesh({
    id: 'sebaceous-gland', label: 'Sebaceous gland', synonyms: ['oil gland', 'sebum gland'], layer: 'appendages', organ: 'hair-unit',
    summary: 'Branched acinar glands opening into the follicle canal; holocrine — whole lipid-filled cells (sebocytes) break down to form sebum.',
    function: 'Sebum (triglycerides, wax esters, squalene) waterproofs and softens hair and skin and is mildly antimicrobial. Androgens drive its output, which rises at puberty.',
    clinical: 'Acne vulgaris: excess sebum and follicular plugging, Cutibacterium acnes and inflammation; isotretinoin shrinks the glands.',
    modelNote: MODELLED,
    related: ['hair-follicle', 'arrector-pili'], sources: [...HIST],
  }),
  mesh({
    id: 'eccrine-gland', label: 'Eccrine sweat gland', synonyms: ['merocrine sweat gland', 'sweat gland', 'sweat pore', 'acrosyringium'], layer: 'appendages', organ: 'skin-glands',
    summary: 'A coiled tubular gland in the deep dermis with a duct that rises to the epidermis and spirals through it to a pore; 2–4 million over the body, densest on palms and soles.',
    function: 'Sympathetic cholinergic nerves drive secretion of a near-isotonic fluid that the duct makes hypotonic by reabsorbing Na⁺ and Cl⁻. Evaporating 1 L of sweat removes about 2.4 MJ (≈580 kcal); maximal rates exceed 1–2 L per hour.',
    clinical: 'In cystic fibrosis the duct cannot reabsorb Cl⁻ (sweat chloride test); hyperhidrosis is excess sweating; blocked ducts cause miliaria (prickly heat).',
    modelNote: 'Four glands shown (one in thin skin, three in thick skin, each opening on a ridge crest); real density is 100–600 per cm².',
    related: ['superficial-plexus', 'cutaneous-nerve'], sources: [...HIST],
  }),
  mesh({
    id: 'apocrine-gland', label: 'Apocrine sweat gland', synonyms: ['apocrine gland', 'scent gland', 'axillary gland'], layer: 'appendages', organ: 'skin-glands',
    summary: 'A large coiled gland with wide lumens in the deep dermis or subcutis of the axilla, groin and areola, opening into a hair follicle above the sebaceous duct.',
    function: 'From puberty it secretes a viscous, protein- and lipid-rich fluid that skin bacteria break down into odorous compounds. Ceruminous and mammary glands are modified apocrine glands.',
    clinical: 'Hidradenitis suppurativa is a chronic inflammatory disease of follicles in apocrine areas.',
    modelNote: MODELLED,
    related: ['hair-follicle', 'sebaceous-gland'], sources: [...HIST],
  }),

  // ── Receptors ─────────────────────────────────────────────────────────────
  mesh({
    id: 'meissner-corpuscle', label: 'Meissner corpuscles', synonyms: ['tactile corpuscle', 'RA I', 'rapidly adapting type I', 'FA I'], layer: 'receptors', organ: 'cutaneous-receptors',
    summary: 'Encapsulated stacks of flattened Schwann (lamellar) cells with an axon winding between them, in the dermal papillae of glabrous skin (about 1 in 4 papillae on the fingertips).',
    function: 'Rapidly adapting (RA I) Aβ receptors with small receptive fields: they signal motion and low-frequency vibration (flutter, ~5–50 Hz) and slip of objects in the grip.',
    clinical: 'Their density falls with age, one reason fingertip sensitivity declines.',
    modelNote: 'Placed in papillae of the thick skin, including several on the standard thick-skin section.',
    related: ['papillary-dermis', 'merkel-discs', 'cutaneous-nerve'], sources: [...RECEP],
  }),
  mesh({
    id: 'merkel-discs', label: 'Merkel cell–neurite complexes', synonyms: ['Merkel discs', 'Merkel cells', 'SA I', 'slowly adapting type I', 'touch dome'], layer: 'receptors', organ: 'cutaneous-receptors',
    summary: 'Merkel cells in the basal layer, each on a disc-shaped Aβ nerve terminal; at the tips of rete ridges in glabrous skin and in touch domes beside hairs.',
    function: 'Slowly adapting (SA I): fire steadily during sustained pressure and resolve edges, curvature and texture finely — the main channel for reading Braille. Merkel cells are themselves touch-sensitive (Piezo2).',
    clinical: 'Merkel cell carcinoma is a rare, aggressive skin cancer, often linked to a polyomavirus.',
    modelNote: 'A row along a primary rete ridge (thick skin) and a touch dome beside the hair; drawn ×1.3 to show at block scale.',
    related: ['stratum-basale', 'meissner-corpuscle'], sources: [...RECEP],
  }),
  mesh({
    id: 'pacinian-corpuscle', label: 'Pacinian corpuscles', synonyms: ['lamellar corpuscle', 'Vater–Pacini corpuscle', 'RA II', 'FA II'], layer: 'receptors', organ: 'cutaneous-receptors',
    summary: 'Large (≈1 mm) onion-like corpuscles in the deep dermis and subcutis: 20–60 concentric lamellae separated by fluid around an unmyelinated axon terminal.',
    function: 'Rapidly adapting (RA II): the lamellae filter out slow pressure, so the terminal responds only to transients and high-frequency vibration (best ~200–300 Hz, sub-micrometre thresholds) over large receptive fields.',
    clinical: 'Loss of vibration sense, tested with a 128 Hz tuning fork, is an early sign of peripheral neuropathy.',
    modelNote: 'Two corpuscles, drawn with 6 and 5 lamellae instead of dozens; both lie on standard sections.',
    related: ['subcutaneous-fat', 'cutaneous-nerve'], sources: [...RECEP],
  }),
  mesh({
    id: 'ruffini-ending', label: 'Ruffini endings', synonyms: ['bulbous corpuscle', 'SA II', 'slowly adapting type II'], layer: 'receptors', organ: 'cutaneous-receptors',
    summary: 'Spindle-shaped capsules in the reticular dermis whose branched terminals are entwined with collagen fibres running through them.',
    function: 'Slowly adapting (SA II): signal skin stretch along their axis, which helps sense finger position and the direction of forces on the skin.',
    modelNote: MODELLED,
    related: ['reticular-dermis', 'collagen-bundles'], sources: [...RECEP],
  }),
  mesh({
    id: 'free-nerve-endings', label: 'Free nerve endings', synonyms: ['nociceptors', 'thermoreceptors', 'pain receptors', 'C fibres', 'A-delta fibres', 'itch'], layer: 'receptors', organ: 'cutaneous-receptors',
    summary: 'Unencapsulated terminals of thin Aδ and C fibres that lose their Schwann cells at the basement membrane and end among keratinocytes, up to the granular layer.',
    function: 'Nociception, temperature and itch: TRP channels open at set temperatures (TRPM8 cool, TRPV1 >43 °C and capsaicin), others at tissue damage or pruritogens. Aδ fibres carry fast, sharp first pain; C fibres slow, burning second pain.',
    clinical: 'Small-fibre neuropathy (often diabetic) is diagnosed by counting these intraepidermal fibres in a skin biopsy.',
    modelNote: 'Fibres drawn about 8 µm thick (real 0.5–2 µm) so they can be seen.',
    related: ['stratum-spinosum', 'cutaneous-nerve'], sources: [...RECEP],
  }),
  mesh({
    id: 'hair-follicle-plexus', label: 'Hair follicle plexus', synonyms: ['peritrichial endings', 'lanceolate endings', 'root hair plexus'], layer: 'receptors', organ: 'cutaneous-receptors',
    summary: 'A palisade of longitudinal lanceolate endings and circumferential fibres around the follicle below the sebaceous gland.',
    function: 'Detects hair deflection — light touch on hairy skin, such as an insect walking; slowly and rapidly adapting fibres and C-tactile fibres (pleasant, affective touch) all end here.',
    modelNote: MODELLED,
    related: ['hair-follicle', 'cutaneous-nerve'], sources: [...RECEP],
  }),

  // ── Vessels ───────────────────────────────────────────────────────────────
  mesh({
    id: 'superficial-plexus', label: 'Superficial (subpapillary) plexus', synonyms: ['subpapillary plexus', 'capillary loops', 'papillary capillaries', 'arterioles', 'venules'], layer: 'vessels', organ: 'cutaneous-vessels',
    summary: 'A horizontal network of arterioles (red) and venules (blue) at the papillary–reticular junction, sending one capillary loop up into each dermal papilla.',
    function: 'Nourishes the epidermis by diffusion and exchanges heat at the surface. Most of the skin’s colour comes from blood in the subpapillary venules.',
    clinical: 'Blanching on pressure (diascopy) separates dilated vessels (erythema, which blanches) from bleeding into the skin (purpura, which does not).',
    modelNote: 'Capillary loops are drawn in the papillae along the standard sections and in a sample elsewhere; loops ~9 µm thick.',
    related: ['deep-plexus', 'papillary-dermis', 'lymphatic-vessels'], sources: [...VESS],
  }),
  mesh({
    id: 'deep-plexus', label: 'Deep (cutaneous) plexus', synonyms: ['cutaneous plexus', 'dermal-subdermal plexus', 'perforators', 'communicating vessels', 'arteriovenous anastomoses'], layer: 'vessels', organ: 'cutaneous-vessels',
    summary: 'Larger arterioles and venules at the dermis–hypodermis junction, fed by perforators through the deep fascia and joined to the superficial plexus by communicating (candelabra) vessels.',
    function: 'Supplies the hair bulbs, sweat glands and fat. Arteriovenous anastomoses (glomus bodies), most numerous in the fingers, ears and nose, open in heat to shunt warm blood to the skin and close in the cold.',
    clinical: 'Skin flaps in reconstructive surgery are designed around these perforators and plexuses.',
    modelNote: MODELLED,
    related: ['superficial-plexus', 'hair-papilla', 'eccrine-gland'], sources: [...VESS],
  }),
  mesh({
    id: 'lymphatic-vessels', label: 'Lymphatic vessels', synonyms: ['lymphatics', 'initial lymphatics', 'lymph capillaries'], layer: 'vessels', organ: 'cutaneous-vessels',
    summary: 'Blind-ended initial lymphatics in the papillary dermis drain into a plexus below the venous plexus and on through valved collectors to the deep plexus and the regional nodes.',
    function: 'Return tissue fluid and protein to the blood and carry antigen-loaded Langerhans and dendritic cells to lymph nodes.',
    clinical: 'Lymphoedema follows their obstruction or removal; cellulitis spreads along them as red streaks (lymphangitis).',
    modelNote: MODELLED,
    related: ['superficial-plexus', 'langerhans-cells'], sources: ['ross-8', 'braverman-2000'],
  }),

  // ── Nerves ────────────────────────────────────────────────────────────────
  mesh({
    id: 'cutaneous-nerve', label: 'Cutaneous nerve', synonyms: ['dermal nerve', 'subepidermal plexus', 'sensory nerve', 'sympathetic fibres'], layer: 'nerves',
    summary: 'A mixed nerve in the subcutis whose branches form a dermal and a subepidermal plexus and reach every receptor; fine sympathetic fibres supply vessels, glands and arrector pili.',
    function: 'Carries touch (Aβ), pain and temperature (Aδ, C) to the dorsal root ganglion of one spinal segment — hence dermatomes — and carries sympathetic commands for sweating, vasoconstriction and piloerection.',
    clinical: 'Peripheral nerve injury leaves an area of numbness matching the nerve’s cutaneous territory, smaller than its dermatome because neighbouring roots overlap.',
    modelNote: MODELLED,
    related: ['cutaneous-receptors', 'free-nerve-endings', 'arrector-pili'], sources: [...RECEP, OS],
  }),
];

const XF = anchors['standard-sections']['thin-follicle'].at;
const ZG = anchors['standard-sections']['thick-gland'].at;
const FOLLICLE_CUT = { axis: 'sagittal' as const, at: sliceAtForMm('x', XF) };
const THICK_CUT = { axis: 'coronal' as const, at: sliceAtForMm('z', ZG) };

export const skinDefinition: SimulationDefinition = {
  schemaVersion: 1,
  id: 'human-skin',
  title: 'Human Skin — Interactive 3D Learning Lab',
  domain: 'biology',
  simulationType: '3d-anatomy',
  audience: 'University students of anatomy, histology, physiology, medicine and nursing',
  summary: 'The integumentary system from the whole body to the microscope: the body surface with its rule-of-nines regions and dermatomes, and a 6 × 4 mm block of thin and thick skin at true histological scale — five epidermal strata, dermis, hypodermis, the pilosebaceous unit, sweat glands, touch receptors, vascular plexuses, lymphatics and nerves.',
  learningObjectives: [
    { id: 'layers', text: 'Name the layers of the skin and the strata of the epidermis, and relate each to its function and thickness in thin and thick skin.' },
    { id: 'junction', text: 'Explain how dermal papillae, rete ridges and friction ridges bind the epidermis to the dermis and nourish it.' },
    { id: 'appendages', text: 'Describe the hair follicle, arrector pili, sebaceous, eccrine and apocrine glands, and how they are built and controlled.' },
    { id: 'receptors', text: 'Match each cutaneous receptor to its depth, adaptation and the touch feature it encodes.' },
    { id: 'circulation', text: 'Describe the superficial and deep plexuses and their role in nutrition and thermoregulation.' },
    { id: 'burns', text: 'Estimate burn size with the rule of nines and relate burn depth to the layers destroyed and to healing.' },
    { id: 'dermatomes', text: 'Locate the main dermatomes and use them to localise a spinal level.' },
  ],
  assets: [{ id: 'skin-v1', role: 'anatomy-model' }],
  layers: [
    { id: 'body', label: 'Body surface', description: 'The skin and hair of the whole body (BodyParts3D), shown in the body view.', visibleByDefault: true },
    { id: 'epidermis', label: 'Epidermis', description: 'The five strata, melanocytes and Langerhans cells.', visibleByDefault: true },
    { id: 'dermis', label: 'Dermis', description: 'Papillary and reticular dermis with collagen bundles.', visibleByDefault: true },
    { id: 'hypodermis', label: 'Hypodermis', description: 'Fat lobules, fibrous septa and the deep fascia.', visibleByDefault: true },
    { id: 'appendages', label: 'Appendages', description: 'Hair follicle, arrector pili and the sebaceous, eccrine and apocrine glands.', visibleByDefault: true },
    { id: 'receptors', label: 'Receptors', description: 'Meissner, Merkel, Pacinian and Ruffini endings, free nerve endings and the follicle plexus.', visibleByDefault: true },
    { id: 'vessels', label: 'Vessels', description: 'Superficial and deep plexuses with capillary loops, and the lymphatics.', visibleByDefault: true },
    { id: 'nerves', label: 'Nerves', description: 'The cutaneous nerve and its plexuses.', visibleByDefault: true },
  ],
  structures,
  cameraPresets: [
    { id: 'block-oblique', label: 'Block', view: 'block', direction: [0.95, 0.8, 1.3] },
    { id: 'block-section-x', label: 'Side section', view: 'block', direction: [-1, 0.3, 0.2] },
    { id: 'block-section-z', label: 'Front section', view: 'block', direction: [0.18, 0.28, 1] },
    { id: 'block-top', label: 'Top', view: 'block', direction: [0, 1, 0.02], up: [0, 0, -1] },
    { id: 'block-thick', label: 'Thick skin', view: 'block', direction: [0.5, 0.9, 1.1], frame: ['stratum-lucidum'] },
    { id: 'block-follicle', label: 'Hair follicle', view: 'block', direction: [-1, 0.18, 0.1], box: [[-1.8, -2.75, -1.85], [-1.7, 0.3, 1.45]] },
    { id: 'block-glands', label: 'Sweat gland', view: 'block', direction: [0.12, 0.2, 1], box: [[1.05, -3.35, 0.35], [2.25, 0.05, 0.45]] },
    { id: 'block-receptors', label: 'Receptors', view: 'block', direction: [0.15, 0.25, 1], box: [[1.15, -1.35, 0.35], [2.15, 0.05, 0.45]] },
    { id: 'block-wound', label: 'Wound', view: 'block', direction: [0.12, 0.3, 1], box: [[-2.4, -3.4, 1.6], [1.6, 0.2, 2.0]] },
    { id: 'block-burn', label: 'Burn', view: 'block', direction: [0.25, 0.45, 1], box: [[-3, -2.4, 1.0], [3, 0.3, 2.0]] },
    { id: 'body-front', label: 'Front', view: 'body', direction: [0, 0.05, 1] },
    { id: 'body-back', label: 'Back', view: 'body', direction: [0, 0.05, -1] },
    { id: 'body-side', label: 'Side', view: 'body', direction: [-1, 0.05, 0] },
  ],
  defaultCamera: 'block-oblique',
  routes: [
    {
      id: 'touch-pathway', label: 'A light touch on the fingertip',
      description: 'From a Meissner corpuscle in a dermal papilla to the somatosensory cortex along the dorsal column–medial lemniscus pathway.',
      steps: [
        { structure: 'stratum-corneum', label: 'Skin indented', note: 'A ridge of thick skin is pressed and the papillae beneath are deformed.' },
        { structure: 'meissner-corpuscle', label: 'Meissner corpuscle', note: 'Lamellar cells transmit the deformation; mechanically gated channels (Piezo2) depolarise the terminal.' },
        { structure: 'cutaneous-nerve', label: 'Aβ fibre in the cutaneous nerve', note: 'Action potentials travel at 35–75 m/s in large myelinated fibres.' },
        { offModel: 'dorsal-root-ganglion', label: 'Dorsal root ganglion', note: 'The cell body of the first-order neuron, in one spinal segment (its dermatome).' },
        { offModel: 'spinal-cord', label: 'Dorsal column', note: 'Ascends without synapsing on the same side.' },
        { offModel: 'brainstem', label: 'Medulla: dorsal column nuclei', note: 'Second-order neurons cross (sensory decussation) and form the medial lemniscus.' },
        { offModel: 'thalamus', label: 'Thalamus (VPL)', note: 'Third-order neurons project to the cortex.' },
        { offModel: 'somatosensory-cortex', label: 'Primary somatosensory cortex', note: 'The fingertip has a large representation in the postcentral gyrus.' },
      ],
      facts: ['Fingertip two-point threshold is about 2–3 mm; on the back it is 40 mm or more.', 'Meissner corpuscles respond best to flutter at about 5–50 Hz.'],
      assumptions: ['The pathway beyond the skin is shown in text only.', 'Conduction velocities are typical adult values.'],
      sources: ['kandel-6', OS],
    },
    {
      id: 'heat-loss', label: 'Losing heat through the skin',
      description: 'How the body sheds heat when it is too warm: the hypothalamus opens the skin’s vessels and drives the sweat glands.',
      steps: [
        { offModel: 'hypothalamus', label: 'Hypothalamus', note: 'Warm core and skin signals raise heat loss.' },
        { offModel: 'sympathetic-chain', label: 'Sympathetic outflow', note: 'Vasoconstrictor tone falls; cholinergic sympathetic fibres to the sweat glands fire.' },
        { structure: 'deep-plexus', label: 'Deep plexus and anastomoses open', note: 'Arteriovenous anastomoses and arterioles dilate.' },
        { structure: 'superficial-plexus', label: 'Warm blood near the surface', note: 'Skin blood flow can rise to 6–8 L/min.' },
        { structure: 'eccrine-gland', label: 'Sweat secreted', note: 'Up to 1–2 L/h; each litre evaporated removes about 2.4 MJ.' },
        { offModel: 'environment', label: 'Heat to the environment', note: 'By radiation, convection and evaporation; evaporation alone works when the air is hotter than the skin.' },
      ],
      facts: ['At rest in a comfortable room about 60 % of heat is lost by radiation.', 'Humid air limits evaporation; a wet-bulb temperature near 35 °C is beyond human tolerance.'],
      assumptions: ['Rates are typical for a heat-acclimatised adult.'],
      sources: [OS, 'braverman-2000'],
    },
  ],
  tour: [
    { id: 'body', title: 'The largest organ', body: 'Skin covers about 1.8 m² and weighs around 4 kg. It is a barrier, a sense organ, a radiator and an immune outpost. Rotate the body; the next steps zoom into a block of skin 6 × 4 mm across, drawn at true scale, and then put it to work.', focus: ['skin-surface'], camera: 'body-front', view: 'body' },
    { id: 'block', title: 'A block of skin', body: 'Thin, hairy skin on the left; thick skin of the palm on the right, with friction ridges. From the top down: epidermis, dermis, and the fatty hypodermis on the deep fascia. Everything is at true scale — 1 mm of skin is 1 cm here.', focus: [], camera: 'block-oblique', view: 'block' },
    { id: 'layers', title: 'Three layers', body: `Epidermis ${um(T.thin.epidermis)} (thin) to ${T.thick.epidermis.toFixed(1)} mm (thick); dermis ${T.thin.dermis.toFixed(1)}–${T.thick.dermis.toFixed(1)} mm; then the hypodermis — fat lobules between fibrous septa on the deep fascia — whose thickness varies more than any other layer.`, focus: ['epidermis', 'dermis', 'hypodermis'], camera: 'block-oblique', colourBy: 'layer' },
    { id: 'strata', title: 'The epidermal strata', body: 'Cut across the thick skin: stratum basale on the papillae, the spinosum filling the rete ridges, a dark granulosum, the clear lucidum, and a thick corneum — the barrier of dead, keratin-filled cells. Keratinocytes take about four weeks to travel from the basal layer to the surface.', focus: ['stratum-basale', 'stratum-spinosum', 'stratum-granulosum', 'stratum-lucidum', 'stratum-corneum'], camera: 'block-section-z', slice: THICK_CUT },
    { id: 'cells', title: 'Melanocytes and Langerhans cells', body: 'With the upper epidermis peeled away, the basal layer shows its melanocytes, which feed melanin to the keratinocytes around them. Langerhans cells patrol the spinous layer for antigens.', focus: ['melanocytes', 'langerhans-cells'], camera: 'block-top', peel: 2 },
    { id: 'papillae', title: 'Dermal papillae', body: 'Remove the whole epidermis and the dermal papillae appear: low and scattered under thin skin, in neat double rows under each friction ridge of thick skin. Each carries a capillary loop; some hold Meissner corpuscles.', focus: ['papillary-dermis'], camera: 'block-thick', peel: 3 },
    { id: 'follicle', title: 'The hair follicle', body: 'This section runs along the follicle: the shaft rising from the bulb, wrapped in the inner and outer root sheaths. The sebaceous gland empties into it; the arrector pili runs from the bulge to the papillary dermis.', focus: ['hair-follicle', 'hair-shaft', 'hair-bulb', 'sebaceous-gland', 'arrector-pili'], camera: 'block-follicle', slice: FOLLICLE_CUT },
    { id: 'eccrine', title: 'Eccrine sweat glands', body: 'A coiled secretory tubule in the deep dermis, a straight duct up to the tip of a rete ridge, then a spiral through the epidermis to a pore on a ridge crest. Sweat evaporating from the skin is the main way we lose heat in hot conditions.', focus: ['eccrine-gland'], camera: 'block-glands', slice: THICK_CUT },
    { id: 'receptors', title: 'Touch receptors', body: 'Meissner corpuscles in the papillae signal flutter and slip; Merkel complexes at the rete ridge tips signal pressure and form; Ruffini endings signal stretch; deep in the fat, Pacinian corpuscles feel only rapid vibration. Free nerve endings reach into the epidermis for pain and temperature.', focus: ['meissner-corpuscle', 'merkel-discs', 'pacinian-corpuscle', 'ruffini-ending', 'free-nerve-endings'], mode: 'touch', params: { touchView: 'receptors', receptor: 'meissner-corpuscle' }, camera: 'block-oblique' },
    { id: 'vessels', title: 'Two vascular plexuses', body: 'A deep plexus at the dermis–hypodermis junction and a superficial plexus under the papillae, joined by communicating vessels; capillary loops rise into each papilla. Skin blood flow can rise from about 0.2 to 7 L/min to dump heat.', focus: ['superficial-plexus', 'deep-plexus'], camera: 'block-oblique', peel: 5 },
    { id: 'heat', title: 'Hot and humid', body: 'At 35 °C and 85 % humidity the air is barely cooler than skin, so radiation and convection lose little: sweating is the only route left. Watch the superficial vessels dilate and sweat climb the ducts — but humid air limits evaporation, sweat drips off unused and the core creeps up.', focus: [], mode: 'temperature', params: { tempPreset: 'humid', speed: 10 }, camera: 'block-oblique' },
    { id: 'cold', title: 'Cold water', body: 'Water conducts heat about 25 times better than air. The vessels clamp down (pale skin), the arrector pili stand the hair up and raise goosebumps, and shivering adds heat — yet the skin falls towards the water temperature within minutes.', focus: [], mode: 'temperature', params: { tempPreset: 'cold-water', speed: 10 }, camera: 'block-oblique' },
    { id: 'incision', title: 'Healing by first intention', body: 'A clean sutured cut fills with clot; within 24–48 h the epidermis bridges it. Neutrophils arrive first, then macrophages; fibroblasts lay down collagen. At a week, when sutures come out, the scar has only about 10 % of normal strength.', focus: [], mode: 'wounds', params: { woundView: 'healing', woundType: 'incision', day: 2 }, camera: 'block-wound' },
    { id: 'deep-wound', title: 'Healing by second intention', body: 'A gaping wound fills from its base with red, granular granulation tissue, contracts by myofibroblasts and is resurfaced from the edges. The scar that remains has no hair follicles or sweat glands and reaches at most about 80 % of normal strength.', focus: [], mode: 'wounds', params: { woundView: 'healing', woundType: 'deep', day: 14 }, camera: 'block-wound' },
    { id: 'burn-depth', title: 'Burn depth', body: 'A superficial partial-thickness burn destroys the epidermis and the papillary dermis: blisters, moist pink skin, severe pain. It heals in 2–3 weeks from the surviving follicles and glands. Deeper burns destroy those too and need grafts.', focus: [], mode: 'wounds', params: { woundView: 'burns', burnDepth: 'superficial-partial' }, camera: 'block-burn' },
    { id: 'nines', title: 'Rule of nines', body: 'Burn size is estimated as a percentage of body surface: head and neck 9 %, each arm 9 %, front and back of the trunk 18 % each, each leg 18 %, perineum 1 %. Here a whole arm and the front of the trunk: 27 %, enough to need intravenous fluids (Parkland formula).', focus: [], mode: 'wounds', params: { woundView: 'burns', burnDepth: 'deep-partial', burnRegions: 'arm-left:1,trunk-anterior:1' }, camera: 'body-front', view: 'body' },
    { id: 'vibration', title: 'Tuned to vibration', body: 'Each mechanoreceptor has a tuning curve. At 250 Hz only the Pacinian corpuscles respond — they detect skin movements smaller than a micrometre, which is how we feel a tool buzz. At 30 Hz the Meissner corpuscles take over.', focus: [], mode: 'touch', params: { touchView: 'vibration', vibHz: 250, vibUm: 2 }, camera: 'block-oblique' },
    { id: 'two-point', title: 'Two-point discrimination', body: 'Two points 2–3 mm apart feel separate on a fingertip; on the back they must be about 4 cm apart. Acuity follows receptor density and the size of the body part in the somatosensory cortex.', focus: [], mode: 'touch', params: { touchView: 'two-point', site: 'fingertip', separationMm: 3 }, camera: 'body-front', view: 'body' },
    { id: 'dermatomes', title: 'Dermatomes', body: 'Each spinal nerve root supplies a strip of skin. Landmarks: C6 thumb, C7 middle finger, T4 nipple, T10 umbilicus (shown), L4 medial leg, S1 lateral foot. Shingles follows one dermatome; a sensory level on the trunk localises a cord lesion.', focus: [], mode: 'touch', params: { touchView: 'dermatomes', dermatome: 'T10' }, camera: 'body-front', view: 'body' },
    { id: 'pain', title: 'Heat, cold and pain', body: 'Above about 43 °C TRPV1 channels open in free nerve endings: heat becomes pain. Stub a toe and the sharp first pain (Aδ fibres) arrives in tens of milliseconds, the dull second pain (C fibres) about a second later.', focus: [], mode: 'touch', params: { touchView: 'thermal', thermalC: 46 }, camera: 'block-oblique' },
    { id: 'sun', title: 'Sunburn and melanin', body: 'Fair type II skin reaches one minimal erythema dose in about 15–20 minutes at UV index 9. The papillary dermis reddens as its capillaries dilate. Darker skin carries more melanin in the basal layer and keratinocytes, a built-in sunscreen — yet the same skin makes vitamin D more slowly.', focus: [], mode: 'life', params: { lifeView: 'sun', phototype: 'II', uvIndex: 9, sunMinutes: 45 }, camera: 'block-oblique' },
    { id: 'ageing', title: 'Ageing skin', body: 'By 80 the epidermis is thinner, the rete ridges and dermal papillae have flattened (so the skin tears and blisters easily) and dermal collagen has fallen by more than half. Sun-exposed skin adds solar elastosis. The modes let you explore all of this yourself.', focus: [], mode: 'life', params: { lifeView: 'age', age: 80, photoaged: true }, camera: 'block-section-z' },
  ],
  sources: [
    { id: OS, citation: 'Betts JG et al. Anatomy and Physiology 2e, chapter 5: The Integumentary System. OpenStax, Rice University; 2022.', url: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/5-introduction', license: 'CC BY 4.0' },
    { id: 'bodyparts3d', citation: 'BodyParts3D 4.0, The Database Center for Life Science (DBCLS): skin, hair of head and pubic hair, via the Human Atlas build.', url: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html', license: 'CC BY 4.0' },
    { id: 'ross-8', citation: 'Ross MH, Pawlina W. Histology: A Text and Atlas, 8th ed., chapter 15 (Integumentary System). Wolters Kluwer; 2020.' },
    { id: 'kandel-6', citation: 'Kandel ER et al. Principles of Neural Science, 6th ed., chapter 19 (Touch). McGraw-Hill; 2021.' },
    { id: 'zimmerman-2014', citation: 'Zimmerman A, Bai L, Ginty DD. The gentle touch receptors of mammalian skin. Science. 2014;346:950–954.', url: 'https://doi.org/10.1126/science.1254229' },
    { id: 'braverman-2000', citation: 'Braverman IM. The cutaneous microcirculation. J Investig Dermatol Symp Proc. 2000;5:3–9.', url: 'https://doi.org/10.1046/j.1087-0024.2000.00010.x' },
    { id: 'lee-2008', citation: 'Lee MWL, McPhee RW, Stringer MD. An evidence-based approach to human dermatomes. Clin Anat. 2008;21:363–373.', url: 'https://doi.org/10.1002/ca.20636' },
    { id: 'keegan-1948', citation: 'Keegan JJ, Garrett FD. The segmental distribution of the cutaneous nerves in the limbs of man. Anat Rec. 1948;102:409–437.', url: 'https://doi.org/10.1002/ar.1091020403' },
    { id: 'wallace-1951', citation: 'Wallace AB. The exposure treatment of burns. Lancet. 1951;257(6653):501–504 (rule of nines).', url: 'https://doi.org/10.1016/S0140-6736(51)91975-7' },
    { id: 'lund-browder-1944', citation: 'Lund CC, Browder NC. The estimation of areas of burns. Surg Gynecol Obstet. 1944;79:352–358 (age table reproduced in burns texts; values approximate).' },
    { id: 'weinstein-1968', citation: 'Weinstein S. Intensive and extensive aspects of tactile sensitivity as a function of body part, sex and laterality. In: Kenshalo DR, ed. The Skin Senses. Springfield, IL: Thomas; 1968 (two-point thresholds; values read from the figure, approximate; page range not verified).' },
    { id: 'johansson-vallbo-1979', citation: 'Johansson RS, Vallbo ÅB. Tactile sensibility in the human hand: relative and absolute densities of four types of mechanoreceptive units in glabrous skin. J Physiol. 1979;286:283–300.', url: 'https://doi.org/10.1113/jphysiol.1979.sp012619' },
    { id: 'fitzpatrick-1988', citation: 'Fitzpatrick TB. The validity and practicality of sun-reactive skin types I through VI. Arch Dermatol. 1988;124:869–871.', url: 'https://doi.org/10.1001/archderm.1988.01670060015008' },
    { id: 'gurtner-2008', citation: 'Gurtner GC, Werner S, Barrandon Y, Longaker MT. Wound repair and regeneration. Nature. 2008;453:314–321.', url: 'https://doi.org/10.1038/nature07039' },
    { id: 'abbasi-2004', citation: 'Abbasi NR et al. Early diagnosis of cutaneous melanoma: revisiting the ABCD criteria. JAMA. 2004;292:2771–2776.', url: 'https://doi.org/10.1001/jama.292.22.2771' },
    { id: 'gagge-1971', citation: 'Gagge AP, Stolwijk JAJ, Nishi Y. An effective temperature scale based on a simple model of human physiological regulatory response. ASHRAE Trans. 1971;77:247–262 (two-node model).' },
    { id: 'holick-2007', citation: 'Holick MF. Vitamin D deficiency. N Engl J Med. 2007;357:266–281.', url: 'https://doi.org/10.1056/NEJMra070553' },
  ],
  disclaimers: [
    'A teaching model, not a clinical tool: arrangements are simplified, some counts are reduced and a few fine structures are drawn thicker than life (see Source & credits).',
    'Layer thicknesses are typical adult values; real skin varies with body site, age, sex and individual.',
    'Rule-of-nines regions and dermatomes on the body are approximations classified from the mesh; real dermatomes overlap and vary.',
  ],
};
