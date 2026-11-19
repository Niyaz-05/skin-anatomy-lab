import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { skinDefinition as def } from '../../src/skin/definition';
import { validateDefinition } from '../../src/contract/validate';
import { APPROVED_ASSETS } from '../../src/contract/assets';
import geometry from '../../src/skin/generated/geometry.json';
import { anchors, BLOCK_SCALE, boundsOfIds, sliceAtForMm, toWorld, viewOf } from '../../src/skin/anchors';
import { effectiveView, facingPreset, initialState, isVisible, keptHalf, keptSign, makeReducer, PEEL } from '../../src/app/state';
import { searchStructures } from '../../src/app/search';
import { Mode } from '../../src/contract/schema';

const reduce = makeReducer(def);
const G = geometry.structures as unknown as Record<string, { scene: string; layer: string; centroid: number[]; bounds: number[][]; instances?: number }>;

/** Node names in the GLB, read from its JSON chunk (no loader needed), with each node's scene. */
function glb(): { names: string[]; scenes: Record<string, string[]>; extensions: string[] } {
  const buf = fs.readFileSync(path.resolve(process.cwd(), 'public/models/skin.glb'));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as { nodes: { name: string }[]; scenes: { name: string; nodes: number[] }[]; extensionsUsed?: string[] };
  return {
    names: json.nodes.map((n) => n.name),
    scenes: Object.fromEntries(json.scenes.map((s) => [s.name, s.nodes.map((i) => json.nodes[i]!.name)])),
    extensions: json.extensionsUsed ?? [],
  };
}
/** Mesh ids in docs/STRUCTURES.md, with their layer. */
function contract(): Record<string, string> {
  const md = fs.readFileSync(path.resolve(process.cwd(), 'docs/STRUCTURES.md'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of md.split('\n')) {
    const m = line.match(/^\| `([a-z-]+)` \| (.*) \|$/);
    if (m) for (const id of m[2]!.matchAll(/`([a-z0-9-]+)`/g)) out[id[1]!] = m[1]!;
  }
  return out;
}

describe('skin definition', () => {
  it('passes the validation gate with no warnings', () => {
    const r = validateDefinition(def);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('has exactly one mesh structure per model node, and the GLB has exactly the contract’s ids', () => {
    const meshes = def.structures.filter((s) => s.kind === 'mesh').map((s) => s.id).sort();
    expect(meshes).toEqual([...APPROVED_ASSETS['skin-v1']!.nodes].sort());
    expect(glb().names.sort()).toEqual(meshes);
    expect(Object.keys(contract()).sort()).toEqual(meshes);
  });

  it('gives each structure the layer the contract lists', () => {
    const c = contract();
    for (const s of def.structures.filter((x) => x.kind === 'mesh')) expect(s.layer, s.id).toBe(c[s.id]);
  });

  it('holds two scenes: the body (BodyParts3D) and the skin block, with instanced cells', () => {
    const g = glb();
    expect(Object.keys(g.scenes).sort()).toEqual(['block', 'body']);
    expect(g.scenes.body!.sort()).toEqual(['body-skin', 'pubic-hair', 'scalp-hair']);
    for (const id of g.scenes.block!) expect(G[id]!.scene).toBe('block');
    expect(g.extensions).toContain('EXT_mesh_gpu_instancing');
    expect(G.melanocytes!.instances).toBeGreaterThan(1000);
  });

  it('cites every structure, and only https sources', () => {
    for (const s of def.sources) if (s.url) expect(s.url.startsWith('https://')).toBe(true);
    for (const s of def.structures) expect(s.sources.length).toBeGreaterThan(0);
    expect(def.sources.map((s) => s.id)).toEqual(expect.arrayContaining(['openstax-ch5', 'bodyparts3d', 'ross-8', 'kandel-6']));
  });

  it('has the six modes, presets for both views and about twenty tour steps', () => {
    expect(Mode.options).toEqual(['explore', 'temperature', 'wounds', 'touch', 'life', 'tour']);
    expect(def.tour.length).toBeGreaterThanOrEqual(18);
    expect(def.cameraPresets.filter((c) => c.view === 'body').map((c) => c.id)).toEqual(['body-front', 'body-back', 'body-side']);
    expect(def.cameraPresets.filter((c) => c.view === 'block').length).toBeGreaterThanOrEqual(6);
  });
});

describe('skin anchors and geometry', () => {
  it('records the layer depths, thin skin thinner than thick', () => {
    const t = anchors['layer-thickness-mm'];
    expect(t.thin.epidermis).toBeGreaterThan(0.05);
    expect(t.thin.epidermis).toBeLessThan(0.15);
    expect(t.thick.epidermis).toBeGreaterThan(0.6);
    expect(t.thick.epidermis).toBeLessThan(1.5);
    expect(t.thick.corneum).toBeGreaterThan(10 * t.thin.corneum);
    expect(t.thin.lucidum).toBe(0);
    expect(t.thin.dermis).toBeGreaterThan(1);
    expect(t.thick.dermis).toBeLessThan(3.2);
    for (const k of ['depth-epidermis-top', 'depth-dermal-junction', 'depth-dermis-hypodermis', 'depth-fascia'] as const) {
      expect(Number.isFinite(anchors[k].thin)).toBe(true);
      expect(Number.isFinite(anchors[k].thick)).toBe(true);
    }
    expect(anchors['depth-fascia'].thin).toBeLessThan(-5);
  });

  it('puts the receptors at their histological depths', () => {
    const r = anchors.receptors;
    const dejThick = -anchors['depth-dermal-junction'].thick;
    for (const m of r['meissner-corpuscle']) { expect(m.depthMm).toBeGreaterThan(0.5); expect(m.depthMm).toBeLessThan(dejThick + 0.3); }
    for (const p of r['pacinian-corpuscle']) expect(p.depthMm).toBeGreaterThan(3);
    for (const p of r['ruffini-ending']) { expect(p.depthMm).toBeGreaterThan(0.5); expect(p.depthMm).toBeLessThan(3); }
    for (const f of r['free-nerve-endings']) expect(f.depthMm).toBeLessThan(1);
    expect(r['merkel-discs'].length).toBeGreaterThan(10);
  });

  it('has the appendage anchors: hair exit at the surface, bulb deep, pores at the surface', () => {
    expect(anchors['hair-exit'][1]).toBeGreaterThan(-0.06);
    expect(anchors['follicle-bulb'][1]).toBeLessThan(-1.8);
    expect(anchors['arrector-insertion'][1]).toBeGreaterThan(-0.4);
    for (const p of anchors['sweat-pore']) expect(Math.abs(p.p[1])).toBeLessThan(0.08);
    expect(anchors['superficial-plexus-lines'].arterioles.length).toBeGreaterThan(3);
    expect(anchors['thick-thin-boundary'].x).toBeCloseTo(0.6, 5);
  });

  it('labels the body with the rule of nines (close to the textbook shares) and C2–S5 dermatomes', () => {
    const regions = anchors['body-regions'].regions;
    expect(regions.map((r) => r.id)).toEqual(['head-neck', 'arm-left', 'arm-right', 'trunk-anterior', 'trunk-posterior', 'leg-left', 'leg-right', 'perineum']);
    expect(regions.reduce((n, r) => n + r.percent, 0)).toBe(100);
    for (const r of regions) expect(Math.abs(r.measuredPercent - r.percent)).toBeLessThan(Math.max(2, r.percent * 0.2));
    expect(anchors.dermatomes.levels).toHaveLength(29);
    expect(anchors.dermatomes.levels[0]).toBe('C2');
    expect(anchors.dermatomes.levels.at(-1)).toBe('S5');
    expect(Object.keys(anchors.dermatomes.areaPercent).length).toBeGreaterThan(25);
  });

  it('converts the block (mm) into world units and finds each structure’s scene', () => {
    expect(toWorld([3, 0, 0], 'block')[0]).toBeCloseTo(3 * BLOCK_SCALE);
    expect(toWorld([0.3, 1, 0], 'body')).toEqual([0.3, 1, 0]);
    expect(viewOf(def, 'meissner-corpuscle')).toBe('block');
    expect(viewOf(def, 'skin-surface')).toBe('body');
    const b = boundsOfIds(def, ['stratum-corneum'])!;
    expect(b[1][0] - b[0][0]).toBeCloseTo(6 * BLOCK_SCALE, 4);
    expect(sliceAtForMm('x', 0)).toBeCloseTo(0);
    expect(sliceAtForMm('x', 3)).toBeCloseTo(1);
  });
});

describe('lab state', () => {
  it('starts on the block and switches to the body and back', () => {
    let s = initialState(def);
    expect(s.view).toBe('block');
    expect(isVisible(def, s, 'stratum-corneum')).toBe(true);
    expect(isVisible(def, s, 'body-skin')).toBe(false);
    s = reduce(s, { type: 'set-view', view: 'body' });
    expect(s.camera.preset).toBe('body-front');
    expect(isVisible(def, s, 'body-skin')).toBe(true);
    expect(isVisible(def, s, 'stratum-corneum')).toBe(false);
    s = reduce(s, { type: 'open-block', site: 'arm-left', thick: true });
    expect(s.view).toBe('block');
    expect(s.site).toBe('arm-left');
    expect(s.camera.preset).toBe('block-thick');
  });

  it('selecting a structure in the other scene switches to it; camera presets carry their view', () => {
    let s = initialState(def);
    s = reduce(s, { type: 'select', id: 'scalp-hair' });
    expect(s.view).toBe('body');
    s = reduce(s, { type: 'camera', preset: 'block-follicle' });
    expect(s.view).toBe('block');
    expect(s.selected).toBeNull();
  });

  it('peels layers from the top while the appendages stay', () => {
    let s = initialState(def);
    s = reduce(s, { type: 'set-peel', value: 3 });
    for (const id of ['stratum-corneum', 'stratum-spinosum', 'stratum-basale', 'melanocytes']) expect(isVisible(def, s, id)).toBe(false);
    for (const id of ['papillary-dermis', 'hair-shaft', 'meissner-corpuscle', 'eccrine-gland']) expect(isVisible(def, s, id)).toBe(true);
    s = reduce(s, { type: 'set-peel', value: 99 });
    expect(s.peel).toBe(PEEL.length - 1);
  });

  it('cuts face the camera to the section, keeping the expected side', () => {
    let s = initialState(def);
    s = reduce(s, { type: 'set-slice', axis: 'sagittal' });
    expect(s.camera.preset).toBe('block-section-x');
    expect(keptSign(s.slice)).toBe(1);
    expect(keptHalf(s.slice)).toBe('the thick-skin side');
    s = reduce(s, { type: 'set-slice', axis: 'coronal' });
    expect(facingPreset(s.slice)).toBe('block-section-z');
    expect(keptHalf(s.slice)).toBe('the back part');
  });

  it('tour steps set their view, peel and cut', () => {
    let s = reduce(initialState(def), { type: 'set-mode', mode: 'tour' });
    expect(effectiveView(def, s)).toBe('body');
    const idx = def.tour.findIndex((t) => t.id === 'follicle');
    s = reduce(s, { type: 'tour-go', index: idx });
    expect(effectiveView(def, s)).toBe('block');
    expect(isVisible(def, s, 'hair-follicle')).toBe(true);
  });

  it('search finds skin structures by synonym', () => {
    expect(searchStructures(def.structures, 'goosebumps')[0]?.structure.id).toBe('arrector-pili');
    expect(searchStructures(def.structures, 'RA II')[0]?.structure.id).toBe('pacinian-corpuscle');
  });
});
