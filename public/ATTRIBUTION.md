# Attribution and asset provenance

## 3D skin model — `models/skin.glb`

### Source

**BodyParts3D 4.0**, © The **Database Center for Life Science** (DBCLS), licensed **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/). https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html

- Taken as converted by *Human Atlas* (github.com/Niyaz-05/human-atlas, commit `76f069640f2c3dd40a58d1556896ac25008f592e`); `atlas.json` sha256 `c359f4bcd2cba90b7411d66d5e9fc04dc81294d46cd5c1e8b212c824f2e5bbee`; chunk hashes in `src/skin/generated/provenance.json`.
- Used parts: Skin (FJ2810) → `body-skin`; Hair of head (FJ2813) → `scalp-hair`; Pubic hair (FJ2815) → `pubic-hair`.

Neither DBCLS nor BodyParts3D has reviewed or endorsed this lab.

### Changes made (as CC BY 4.0 requires)

`tools/make-skin.mjs`:
- Welded the three parts; simplified the skin surface to about 28,000 triangles (quadric simplification, meshoptimizer).
- Added two per-vertex attributes to the skin: `_REGION` (rule-of-nines region) and `_DERMATOME` (an approximate C2–S5 dermatome map, after Lee et al. 2008 and Keegan & Garrett 1948), both classified from vertex position.

### Parts modelled for this lab (not from BodyParts3D)

The skin block — the five epidermal strata, melanocytes and Langerhans cells, papillary and reticular dermis with collagen bundles, subcutaneous fat with fibrous septa, deep fascia, the hair follicle (shaft, root sheaths, bulb, papilla), arrector pili, sebaceous, eccrine and apocrine glands, Meissner, Merkel, Pacinian, Ruffini, free and follicular nerve endings, the superficial and deep vascular plexuses with capillary loops, lymphatics and a cutaneous nerve — is built in code from standard adult histological dimensions. It is a teaching model: arrangements are simplified, some counts are reduced and a few fine structures are drawn thicker than life (listed below).

| Dimension | Model | Typical adult value | Sources |
|---|---|---|---|
| thinEpidermisMm | 0.121849 | 0.07–0.12 mm (thin, hairy skin) | ross-8, openstax-ch5 |
| thickEpidermisMm | 0.777071 | 0.6–1.5 mm (palms, soles; 5 strata) | ross-8, openstax-ch5 |
| corneumMm | 0.018 / 0.4 | thin skin 10–20 µm; palm 0.2–0.6 mm | ross-8 |
| lucidumMm | 0.035 | thick skin only, 20–40 µm | ross-8, openstax-ch5 |
| basaleMm | 0.011 / 0.016 | one cell, ~10–15 µm | ross-8 |
| dermisMm | 1.902304 / 2.271963 | 1–3 mm (thicker on palms and back) | ross-8, openstax-ch5 |
| hypodermisMm | 3.211876 / 2.206492 | very variable (mm to cm); cut to fit the block | openstax-ch5 |
| frictionRidgeSpacingMm | 0.46 | ~0.4–0.5 mm | ross-8 |
| hairShaftDiameterUm | 72 | terminal hair 50–100 µm | ross-8 |
| follicleAngleDeg | 55 | ~30–60° to the surface | ross-8 |
| meissnerSizeUm | ~45 × 95 | 30–80 × 80–150 µm, in dermal papillae of glabrous skin | ross-8, kandel-6 |
| pacinianSizeMm | 1.04 × 0.64; 0.84 × 0.52 | ~1 × 0.6 mm (up to 4 mm), 20–60 lamellae, deep dermis/hypodermis | ross-8, kandel-6 |
| ruffiniLengthMm | 0.76 | 0.5–2 mm spindles in the dermis | kandel-6 |
| eccrineCoilMm | ~0.3–0.4 | coil 0.3–0.5 mm, deep dermis | ross-8 |
| capillaryLoopUm | ~9 (arterial limb 8, venous 10) | 5–10 µm; one loop per papilla | ross-8 |
| exaggerations | free nerve fibres drawn 8 µm (real 0.5–2 µm); Merkel complexes ×1.3; follicle-plexus fibres 9–14 µm; cells at 1/7 density; 4 eccrine glands; 2 Pacinian corpuscles with 5–6 lamellae | for visibility at block scale |  |

Sources: openstax-ch5 = Betts JG et al., *Anatomy and Physiology 2e*, ch. 5 "The Integumentary System", OpenStax 2022 (CC BY 4.0); ross-8 = Ross MH, Pawlina W, *Histology: A Text and Atlas*, 8th ed., Wolters Kluwer 2020; kandel-6 = Kandel ER et al., *Principles of Neural Science*, 6th ed., McGraw-Hill 2021 (touch receptors); lee-2008 = Lee MWL, McPhee RW, Stringer MD, An evidence-based approach to human dermatomes, *Clin Anat* 2008;21:363–373; keegan-1948 = Keegan JJ, Garrett FD, The segmental distribution of the cutaneous nerves in the limbs of man, *Anat Rec* 1948;102:409–437. Cited for dimensions only; no text or figures are copied.

`tools/bake-shading.mjs` then adds a per-vertex `_TISSUE` attribute (ambient occlusion and a noise value) for the real-tissue look.

<!-- output:start -->
The output is `models/skin.glb` (7,872,904 bytes, 365,974 triangles, sha256 `b213486268ed2b50fe6a968f647c4c9064c4843cc970ec9c69682c1744229543`).
<!-- output:end -->
