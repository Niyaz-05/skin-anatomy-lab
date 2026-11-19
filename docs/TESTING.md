# Testing

Windows 11, Node 22. Browser tests run against the production build (`vite preview`, port 5203) in two Playwright projects: **gpu** (every test, installed Google Chrome with hardware WebGL through ANGLE/Direct3D 11) and **software** (the tests tagged `@smoke`, Playwright's Chromium with SwiftShader, which picks the low-quality look). The pomeylo splash is skipped under automation unless the URL has `?splash`.

## Commands

| Check | Command | What it covers |
|---|---|---|
| Types | `npm run typecheck` | TypeScript strict, `noUncheckedIndexedAccess` |
| Unit | `npm test` | See below |
| Assets | `npm run validate:assets` | GLB sha256 = provenance, node set = contract, scenes, finite positions, unit normals, indices, baked `_TISSUE`, body labels, anchors, attribution, ≤ 8 MB |
| Build | `npm run build` | Type check + production bundle |
| E2E | `npm run build && npm run e2e` | `tests/e2e/lab.spec.ts` and `tests/e2e/responsive.spec.ts`; screenshots in `docs/screenshots/` |
| Mode screenshots | `node tools/mode-shots.mjs` (dev server on :5202) | Every mode at 1366×820 and 390×844 in real Chrome → `docs/screenshots/modes/` |

## Unit tests (`tests/unit`)

- `skin.test.ts`: the definition passes the validation gate; one mesh structure per GLB node and per contract id; two scenes and instanced cells; https-only sources; modes, camera presets per view, tour length; layer thicknesses, receptor depths, appendage anchors, rule-of-nines areas and C2–S5 dermatome labels; world units; the reducer (views, opening the block from the body, peeling, cuts facing the camera, tour views); search.
- `skin-science.test.ts`: the pure science (`thermo`, `wounds`, `sensation`, `photo`).
- `skin-sim.test.ts`: simulation settings (ranges, presets, tour strings for healing factors and burned regions, landmarks → dermatomes, palm patches, lesion presets, the heat-balance environment); visual mappings (vessel calibre, sweat drops, thermal colours, cold hands and feet, the log day slider, wound filling and contraction, spike trains RA vs SA, deterministic two-point trials, skin tones, lesion outline); the live heat balance in simulated time (cold water cools the skin and starts shivering); modes in the state (sub-views move the camera and scene; see-through effectors, highlights and body paint; tour steps carry their settings and "Try it yourself").
- `closeHoles.test.ts`: cut-cap hole filling, and every part of `skin.glb` closes.

## E2E scenarios (`tests/e2e/lab.spec.ts`)

1. Loads with no console errors; real colours; block view; no details sheet (@smoke).
2. Clicking the block selects the structure under the pointer.
3. Search: "goosebumps" → arrector pili; "RA II" → Pacinian corpuscles; no-match message.
4. A group lists its parts; colour by Layers changes the picture; unchecking Hypodermis hides the fat.
5. Peel to the whole epidermis; the Across cut faces the front camera ("back part" kept); labels: at least 3, none overlapping, the deep fascia labelled below the fat.
6. Body/block: the Body scene, rule-of-nines colours and legend; a click on the body opens the block.
7. Temperature: time runs and the scene animates; Cold water at 10 min/s cools the skin below 26 °C, starts shivering and shuts skin blood flow; Hot humid starts sweating, dilates the vessels and reads "danger" wet bulb; a manual change leaves the preset; the body view shows the thermal legend.
8. Wounds: deep wound at 1 h is haemostasis/inflammation with a clot (3D label "Clot"); 3 weeks is proliferation; 1 year is remodelling, scar, strength > 60 %; diabetes and infection slow closure; the log slider moves the day.
9. Burns: full thickness labels "whole dermis" in 3D; a click on the block sets the depth from the layer hit; on the body, tapping the chest gives 18 % TBSA, the left arm chip 27 %, a palm patch 28 %; Parkland 7840 mL (70 kg), 5600 mL (50 kg); the child chart gives the head 18 %.
10. Touch: the Merkel card is SA1; 250 Hz → Pacinian most sensitive, 30 Hz → Meissner (response > 50 %), 900 Hz → Pacinian; pressure rasters (SA spikes more than RA); 47 °C → heat pain, 20 °C → cold; first pain 50 ms and second pain 1000 ms at 1 m.
11. Touch on the body: two-point site label; back threshold 40 mm; 10 mm reads "one point", 60 mm "two points"; the umbilicus landmark → T10; tapping the trunk names a thoracic dermatome.
12. Life: type I, UVI 10, 60 min → blistering; SPF 30 → none; 52° N in December → vitamin D winter; age 80 → collagen 0.40; psoriasis card; ABCDE low → moderate (9 mm) → high with all five criteria.
13. Guided tour: 22 steps; Back/Next; the cold-water step shows "Temperature · Cold water"; the rule-of-nines step shows the body; "Try it yourself" opens Temperature with the preset; Finish returns to Anatomy.
14. Phone 390×844 (@smoke): no horizontal overflow; Structures from the dock; details follow a pick.
15. About: BodyParts3D and CC BY 4.0 credits.
16. `?nowebgl` (@smoke): fallback message; the structure list, the running Temperature panel, Touch and Life still work.
17. Missing model (HTTP 404): error alert; Try again loads it.
18. Reduced motion: Temperature, Wounds, Touch (pressure, pain race) and Life without errors.

`tests/e2e/responsive.spec.ts` runs at 390×844, 844×390, 768×1024, 820×1180, 1024×768 and 1366×820 (touch emulation below 1024 px): no horizontal scroll; title, modes, dock and sheet on screen and apart; room for the model; finger-sized controls; the sheet folds, opens and expands by tap, keyboard and drag; the picked structure's label stays above the sheet; closing by ✕, by a tap on empty space and by dragging down; a mode's panel keeps the mode buttons and cannot be dismissed; each mode's main control (presets, wound types, sub-tabs) is on screen, the 250 Hz preset works and the Body scene is reachable; every mode fits and scrolls to its end.

## Results

| Check | Result |
|---|---|
| `npm run typecheck` | **Pass** |
| `npm test` | **Pass**: 106/106 in 4 files |
| `npm run validate:assets` | **Pass**: 35 nodes, 365,974 triangles, 7.51 MB (model unchanged; every effect is in shaders) |
| `npm run build` | **Pass** (Vite warns about chunk size) |
| `npm run e2e` | Full run (gpu + software, 64 tests): 59 passed, 5 failed; the 5 were then re-run alone and pass (two phone tests had hit the 60 s model-ready limit, now 120 s; three "main control" tests found the dock's scene switch under the half-open sheet, so the Temperature panel got its own block/body toggle). After the last edits (granulation timing, panel toggle label) the Temperature, Wounds and Burns specs were re-run and pass; the whole suite was not re-run end to end after those edits. |

Real-Chrome screenshots of every mode at 1366x820 and 390x844 are in `docs/screenshots/modes/` (`node tools/mode-shots.mjs`).

## Not verified

- Physical phones and tablets, Safari and Firefox (only Chrome's device emulation).
- Frame rate on slow GPUs: on the test machine the continuously animated modes (Temperature, Touch) render at about 15–25 frames per second with the see-through block; the simulation clock runs in real seconds, independent of the frame rate.
- Specialist review of the physiology, pathology and burns content. The science modules follow the sources cited in them; numbers flagged approximate there carry an "≈ approx." tag in the panels.
