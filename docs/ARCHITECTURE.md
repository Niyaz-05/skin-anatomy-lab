# Architecture

```
tools/make-skin.mjs ──► public/models/skin.glb (scenes: body, block) ──► tools/bake-shading.mjs (_TISSUE AO + mottle)
        │                      │
        ├─► src/skin/generated/geometry.json (bounds, anchors, body labels)
        └─► provenance.json, structures.source.json, public/ATTRIBUTION.md

src/skin/definition.ts ──► src/contract/validate.ts (zod schema + cross-references) ──► App
src/app/state.ts (pure reducer: mode, view, selection, layers, colour, cut, peel, tour, sim) ◄── sim.ts (settings, presets), visual.ts (pure mappings)
src/app/live.ts + drivers.ts (heat balance in simulated time) ──► panels (src/ui/*Panel.tsx) and ModeScenes
src/viewer/SkinModel.tsx ◄── state ── CameraRig, LabelLayer, BodyLegend, ModeScenes (SimEffects, sweat, wound fill, burns, two-point sites)
src/viewer/simfx.ts (shader effects on every block material) · bodyPaint.ts (per-vertex body paint)
```

| Part | Notes |
|---|---|
| Model (`skin.glb`) | Two glTF scenes. *body*: BodyParts3D skin and hair in metres with `_REGION`/`_DERMATOME` vertex labels. *block*: the skin block in millimetres; tissue layers are closed slabs sharing simplified heightfield interfaces; vessels carry `COLOR_0`; melanocytes and Langerhans cells use `EXT_mesh_gpu_instancing`. ≈370k triangles, < 8 MB. |
| Skin model (`SkinModel.tsx`) | Loads both scenes, scales the block by 0.01 into world units once (geometry and instance matrices), assigns a tissue material per structure and shows only the scene in view. One clipping plane cuts both scenes; stencil caps (drawn tissue sheets first, then embedded parts, without depth writes so coplanar caps never fight) fill the cut faces. The body can be coloured per vertex by region or dermatome; clicking it opens the block. |
| Tissue look (`tissue.ts`, `histology.ts`, `palette.ts`) | Physically based material with clear coat, sheen, baked AO and mottle, plus a procedural histology pattern per tissue evaluated in millimetres from world position, faded by screen-space footprint. The same pattern runs on cut caps. |
| State (`state.ts`) | `view` (block/body), `peel` (0–5: corneum … whole dermis), `slice` (axis, position, flip; the kept side is per axis), `bodyColour`, tour steps can set view, cut, peel and colours. `isVisible` hides the other scene and peeled sheets. |
| Camera (`CameraRig.tsx`) | Presets carry their view and frame a box, a set of structures or the view's home bounds; near/far follow the scene's size. |
| Simulation modes | `sim.ts` holds every mode's settings (patched in range; tour steps pass the same keys as `params`). `effectiveSim`, `simXray`, `simHighlight` and `effectiveBodyPaint` in `state.ts` say what the scene shows. `live.ts` integrates `thermo.ts` (`thermoStep`) in simulated minutes per real second. |
| Simulation effects (`simfx.ts`, `ModeScenes.tsx`) | Shader-only, so the GLB is unchanged: per-material tint (optionally above a depth), glow and inflation along the normal (vessels dilating, arrector contracting, collagen thinning); shared wound notch (fragments discarded inside it), goosebump bump, the ageing depth remap and the skin-coloured top surface with creases. `SimEffects` rewrites all of them every frame from the state, so leaving a mode restores the tissue; the follicle unit is rotated about the hair's exit for piloerection. Extra objects: sweat drops (instanced), the wound fill (extruded notch with a clot → granulation → epidermis → scar shader) and its cells (points), blister fluid, two-point sites. |
| Body paint (`bodyPaint.ts`) | Vertex colours from `_region` / `_dermatome`: regions, dermatomes with one picked out, burns by region and palm-sized patches, live skin temperature with a distal factor (cold hands and feet); finds the 17 two-point sites from the region labels. |
