# Skin lab: structure ids (contract)

The model `public/models/skin.glb` holds two glTF scenes in one file, built by `tools/make-skin.mjs` (then `tools/bake-shading.mjs`):

- **`body`** — the BodyParts3D body surface and hair, in **metres**, unchanged frame: +x = patient's left, +y up, +z anterior, origin on the floor between the feet (right-handed; the viewer draws it as is).
- **`block`** — a cut-away block of skin modelled in code at **1 model unit = 1 mm**: x ∈ [−3, 3] (thin, hairy skin at −x; thick, palmar skin at +x; boundary at x = 0.6, blended over 0.35–0.85), z ∈ [−2, 2], +y out of the skin, origin at the centre of the skin surface; the deep fascia's lower face is at y ≈ −5.55 (right-handed). The viewer scales the block by 0.01 into world units (1 mm → 1 cm), so the block and the body each fill the view at similar camera settings.

Every node carries `extras.scene` (`body` | `block`) and `extras.layer`. `src/skin/definition.ts` describes every id. `melanocytes` and `langerhans-cells` are instanced (`EXT_mesh_gpu_instancing`). Vessel meshes carry `COLOR_0` (arterial red → capillary purple → venous blue).

| Layer | Mesh ids |
|---|---|
| `body` | `body-skin`, `scalp-hair`, `pubic-hair` |
| `epidermis` | `stratum-corneum`, `stratum-lucidum`, `stratum-granulosum`, `stratum-spinosum`, `stratum-basale`, `melanocytes`, `langerhans-cells` |
| `dermis` | `papillary-dermis`, `reticular-dermis`, `collagen-bundles` |
| `hypodermis` | `subcutaneous-fat`, `fibrous-septa`, `deep-fascia` |
| `appendages` | `hair-shaft`, `inner-root-sheath`, `hair-follicle`, `hair-bulb`, `hair-papilla`, `arrector-pili`, `sebaceous-gland`, `eccrine-gland`, `apocrine-gland` |
| `receptors` | `meissner-corpuscle`, `merkel-discs`, `pacinian-corpuscle`, `ruffini-ending`, `free-nerve-endings`, `hair-follicle-plexus` |
| `vessels` | `superficial-plexus`, `deep-plexus`, `lymphatic-vessels` |
| `nerves` | `cutaneous-nerve` |

Notes on ids: `stratum-lucidum` exists on the thick-skin side only (x ≥ 0.45). `hair-follicle` is the outer root sheath with the connective-tissue sheath; `inner-root-sheath` runs from the bulb to the isthmus; `hair-papilla` is the dermal papilla of the hair. `eccrine-gland` holds four glands (coil + dermal duct + spiral intra-epidermal duct + pore); `pacinian-corpuscle`, `ruffini-ending` and `meissner-corpuscle` hold several corpuscles each. `superficial-plexus` includes the capillary loops in the papillae; `deep-plexus` includes the communicating (candelabra) vessels, the perforators and the branches to the hair papilla, glands and fat. `fibrous-septa` were added to the original contract so the hypodermis reads as lobules.

Groups (no geometry): `skin-surface` (body), `epidermis`, `dermis`, `hypodermis`, `hair-unit`, `skin-glands`, `cutaneous-receptors`, `cutaneous-vessels`.

## Anchors

In `src/skin/generated/geometry.json` → `anchors` (block frame, millimetres, unless noted). Every structure in `structures` also has `scene`, `bounds`, `centroid` and `surfaceAnchor` in its scene's units.

- Layer depths (y of the interface; negative = below the surface): `depth-epidermis-top`, `depth-dermal-junction` (mean over the region), `depth-dermis-hypodermis`, `depth-fascia`, each `{ thin, thick }`; `layer-heights` (every interface at the `thin-site` and `thick-site`); `layer-thickness-mm` (`{ thin, thick }` × corneum, lucidum, granulosum, basale, epidermis, papillaryDermis, dermis, hypodermis, fascia).
- `receptors`: `meissner-corpuscle`, `merkel-discs`, `pacinian-corpuscle`, `ruffini-ending`, `free-nerve-endings` (lists of `{ p, depthMm }`), `hair-follicle-plexus` and `touch-dome` (`{ p, depthMm }`).
- `sweat-pore` (list of `{ gland, p, thick }`), `sweat-coils`, `hair-exit`, `follicle-bulb`, `follicle-axis`, `follicle-angle-deg`, `sebaceous-gland`, `apocrine-opening`, `arrector-insertion`, `arrector-origin`.
- `superficial-plexus-lines` (`arterioles`, `venules`) and `deep-plexus-lines` (`arteries`, `veins`): centre-line polylines.
- `thick-thin-boundary` (`x`, `transition`, `line`), `block-bounds-mm`, `thin-site`, `thick-site`, `standard-sections` (the two cuts that show the follicle and the thick-skin gland: `{ axis, at }` in mm).
- Body scene (metres): `body-regions` and `dermatomes`, below; `body-landmarks-m` (crotch, axillae, neck heights used by the classifier).

## Body labels (vertex attributes on `body-skin`)

- `_REGION` (unsigned byte per vertex; three.js attribute `_region`): rule-of-nines region index into `anchors['body-regions'].regions`, in this order: `head-neck` (9 %), `arm-left` (9 %), `arm-right` (9 %), `trunk-anterior` (18 %), `trunk-posterior` (18 %, with the buttocks), `leg-left` (18 %), `leg-right` (18 %), `perineum` (1 %). Left/right are the patient's (left = +x). Each entry has `percent` (rule of nines) and `measuredPercent` (area on the mesh).
- `_DERMATOME` (unsigned byte; three.js `_dermatome`): index into `anchors.dermatomes.levels` = `C2, C3, C4, C5, C6, C7, C8, T1 … T12, L1 … L5, S1 … S5` (29 levels; there is no C1 dermatome), or **255** for the face (trigeminal nerve, not a spinal dermatome). `areaPercent` gives each level's share of the surface.
- Both are classified from vertex position (contour slices, then rules after Lee et al. 2008 and Keegan & Garrett 1948); see `classifyBody` in `tools/make-skin.mjs`. Boundaries are approximate: real dermatomes overlap and vary.
