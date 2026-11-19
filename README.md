# Human Skin — Interactive 3D Learning Lab

An interactive 3D integumentary system for university anatomy, histology, physiology, medicine and nursing students: the whole body surface (rule-of-nines regions, dermatomes) and a 6 × 4 mm block of thin and thick skin down to the deep fascia, modelled at true histological scale (1 mm of skin = 1 cm on screen). Works on phones and tablets.

- **Two scenes.** *Skin block* (default) and *Body*, switched from the dock. Clicking a region of the body opens the block there (palms and soles open on thick skin).
- **The block.** Five epidermal strata with true thicknesses (thin skin ≈0.1 mm, palm ≈0.9 mm), melanocytes and Langerhans cells (instanced), dermal papillae and rete ridges under friction ridges, papillary and reticular dermis with collagen bundles, fat lobules between fibrous septa, the deep fascia; a terminal hair follicle (shaft, inner and outer root sheaths, bulb, papilla) with its arrector pili, sebaceous and apocrine glands; four eccrine glands with spiral ducts to their pores; Meissner, Merkel, Pacinian and Ruffini endings, free nerve endings and the follicle plexus; superficial and deep vascular plexuses with capillary loops, lymphatics and a cutaneous nerve.
- **Histology look.** Every face of the block and every cut face carries a procedural texture for its tissue — cornified lamellae, keratinocytes with nuclei, columnar basal cells with melanin, loose and coarse collagen, adipocytes, foamy sebocytes — fading to flat colour when cells would be smaller than a few pixels. "Colour" switches to **Layers**.
- **Cuts and peeling.** Vertical sections in two directions (*Along* x, *Across* z) and a horizontal one, with filled cut faces; the *Peel* slider removes the corneum, the upper epidermis, the whole epidermis, the papillary dermis or the whole dermis, leaving appendages, receptors, vessels and nerves standing.
- **Anatomy explorer.** 35 structures and 8 groups with university-level summaries, functions, clinical notes and cited sources; search by name or synonym; layers; camera views (block, sections, top, thick skin, hair follicle, sweat gland, receptors; body front, back, side).
- **Body.** Colour by rule-of-nines region (areas measured on this mesh) or by dermatome (C2–S5, approximate).
- **Guided tour.** 22 steps from the whole body to the receptors and vessels, then through every simulation mode; each step sets its view, cut, peel or mode settings, and "Try it yourself" hands them over.
- **Temperature.** A two-node (core + skin) heat balance after Gagge runs in simulated time (30 s – 10 min per second) for presets (cool office, hot dry desert, hot humid, cold wind, cold water, marathon, fever) or your own air temperature, humidity, wind, sunshine, clothing (clo), activity (MET), immersion and fever. In the see-through block the superficial and deep plexuses dilate (thicker, brighter red) or constrict (pale), sweat climbs the eccrine ducts to the pores and evaporates, and the arrector pili pull the follicle upright with a goosebump on the surface. The panel charts core and skin temperature, the heat-loss routes in watts (radiation, convection, conduction, evaporation, respiration), sweat rate, skin blood flow, shivering, the thermal state (hypothermia … heat stroke) and the wet-bulb risk. The body view paints skin temperature in thermal colours, with cold hands and feet when vasoconstricted.
- **Wounds & burns.** Incision, graze or deep wound on a log time line from minutes to two years: the four phases, the cells present (platelets, neutrophils, macrophages, fibroblasts, keratinocytes drawn on the block's face), closure, the tensile-strength curve and factors that delay healing. In the block the wound is cut through the layers and fills with clot, granulation tissue, new epidermis (from the edges, and from follicles in a graze) and finally a flat scar without follicles. Burns: pick a depth or click a layer of the block (blister fluid under a lifted epidermis, eschar, char); on the body tap rule-of-nines regions or palm-sized patches for %TBSA (adult, child or Lund–Browder by age) and see the Parkland estimate (clearly labelled educational).
- **Touch.** Receptor cards (click a receptor in the see-through block); vibration frequency and amplitude against the four tuning curves with the active receptors pulsing; spike rasters for a pressure step (RA vs SA); a two-point discrimination game on 17 body sites with a threshold map; the dermatome map (tap the body or pick a landmark; overlap explained); a thermometer with the TRP channels; first vs second pain racing along Aδ and C fibres.
- **Life.** Fitzpatrick type, UV index, SPF and time → MEDs, sunburn grade, a reddening block with melanin by phototype; vitamin D by latitude, month and exposed skin; ageing from 20 to 90 (thinner epidermis, flatter junction, thinner collagen; intrinsic vs photoageing); a disorders gallery (acne, eczema, psoriasis, vitiligo, BCC, SCC, melanoma) highlighting the structures involved; an ABCDE melanoma checker with a drawn lesion.
- **Approximate numbers** (two-point thresholds, tuning curves, receptor densities, the Lund–Browder table, MEDs, vitamin D and healing curves) carry an "≈ approx." tag where they are shown.

**Educational only.** Not a clinical tool. The body surface and hair are BodyParts3D (DBCLS, CC BY 4.0); the skin block is modelled for this lab. See [public/ATTRIBUTION.md](public/ATTRIBUTION.md).

## Run

Requires Node.js ≥ 22.12.

```sh
npm install
npm run dev            # http://localhost:5202
npm run build          # type-check + production build → dist/
npm run preview        # http://localhost:5203
```

Add `?quality=high` or `?quality=low` to the URL to force a rendering quality.

## Check

```sh
npm run typecheck
npm test                         # unit tests (Vitest)
npm run validate:assets          # model hash, size, scenes, nodes vs docs/STRUCTURES.md, body labels, anchors, baked shading, attribution
node tools/shots.mjs             # real-Chrome screenshots of the main views (dev server on :5202) → test-results/shots
node tools/mode-shots.mjs        # every simulation mode at 1366×820 and 390×844 → docs/screenshots/modes
```

## Rebuild the model

`public/models/skin.glb` is generated from a checkout of the Human Atlas (`github.com/Niyaz-05/human-atlas`, BodyParts3D 4.0):

```sh
npm run skin:make      # node tools/make-skin.mjs [<human-atlas>/public/models] && node tools/bake-shading.mjs
npm run validate:assets
```

`tools/make-skin.mjs` writes two scenes into one GLB (≤ 8 MB):

- **body** — the BodyParts3D skin (simplified to ~28,000 triangles), hair of the head and pubic hair, in metres, with per-vertex `_REGION` (rule of nines) and `_DERMATOME` (C2–S5; 255 = trigeminal face) labels classified on horizontal contour slices (see `classifyBody`).
- **block** — modelled in code in millimetres (`tools/skin-geo.mjs` helpers): each tissue layer is a closed slab between heightfield interfaces simplified once and shared by both neighbours, so cut faces fit exactly; septa are signed-distance sheets on Voronoi faces (meshed once and cached in `node_modules/.cache`); appendages, receptors, vessels and nerves are swept tubes (vessels carry arterial → venous vertex colours), surfaces of revolution and SDF unions; cells are instanced. Histological depths are checked at build time.

It also writes `src/skin/generated/geometry.json` (bounds and named anchors, see [docs/STRUCTURES.md](docs/STRUCTURES.md)), `provenance.json` (input hashes, dimensions with their sources and exaggerations, body-label areas, checks), `src/skin/source/structures.source.json` and `public/ATTRIBUTION.md`. `tools/bake-shading.mjs` then bakes ambient occlusion and mottling per vertex (block slabs shade only themselves, so peeled layers stay clean). Both steps are deterministic.

## Frames

- Body: BodyParts3D metres, +x = patient's left, +y up, +z anterior (right-handed, drawn as is).
- Block: 1 unit = 1 mm, origin at the centre of the skin surface, +y out of the skin, thin skin at −x, thick skin at +x (boundary x = 0.6). The viewer scales it by 0.01 into world units. No mirroring anywhere.

## Layout

| Path | What |
|---|---|
| `docs/STRUCTURES.md` | The contract: mesh ids, layers, scenes and frames, anchors, body labels |
| `src/contract/` | Simulation schema (zod), approved-asset registry, validation gate |
| `src/skin/` | Definition (structures, layers, routes, cameras, tour, sources), anchors, generated geometry and provenance; the science modules (`thermo`, `wounds`, `sensation`, `photo`) |
| `src/app/` | Pure state reducer (modes, view, colour, cut, peel, tour), simulation settings (`sim.ts`), pure visual mappings (`visual.ts`), the live heat balance (`live.ts`, `drivers.ts`), search, layout, React context |
| `src/viewer/` | three.js / react-three-fiber scene: tissue material, procedural histology (`histology.ts`), lighting, the skin model (two scenes, cut caps, body colouring), simulation effects (`simfx.ts`, `ModeScenes.tsx`, `bodyPaint.ts`), camera rig, labels, body legend |
| `src/ui/` | Panels: structures (colour, cut, peel, layers), details, tour, About, and the Temperature, Wounds, Touch and Life panels |
| `tools/` | Model generation (`make-skin.mjs`, `skin-geo.mjs`, `sdf-lib.mjs`, `mesh-lib.mjs`), shading bake, asset validation, screenshots |
| `tests/unit`, `tests/e2e` | Vitest and Playwright suites |
