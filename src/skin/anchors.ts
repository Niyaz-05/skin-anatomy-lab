import geometryJson from './generated/geometry.json';
import type { SimulationDefinition, View } from '../contract/schema';

export type Vec3 = [number, number, number];
export type { View } from '../contract/schema';

interface G { scene: View; layer: string; centroid: number[]; bounds: number[][]; surfaceAnchor?: number[]; instances?: number }

/** Per-structure bounds and label anchors in the scene's own units (body: metres; block: millimetres). */
export const geometry = geometryJson.structures as unknown as Record<string, G>;

/**
 * World units: the body is drawn in its own metres; the block (modelled at 1 unit = 1 mm) is scaled
 * by BLOCK_SCALE, so 1 mm of skin is 1 cm on screen and both scenes suit the same camera settings.
 * Both frames are right-handed (docs/STRUCTURES.md), so nothing is mirrored.
 */
export const BLOCK_SCALE = 0.01;

export interface ReceptorAnchor { p: Vec3; depthMm: number; lengthMm?: number; widthMm?: number }
export interface BodyRegion { id: 'head-neck' | 'arm-left' | 'arm-right' | 'trunk-anterior' | 'trunk-posterior' | 'leg-left' | 'leg-right' | 'perineum'; label: string; percent: number; measuredPercent: number }
type ThinThick = { thin: number; thick: number };
/** Layer thicknesses in mm at a thin- or thick-skin site. */
export interface LayerThickness { corneum: number; lucidum: number; granulosum: number; basale: number; epidermis: number; papillaryDermis: number; dermis: number; hypodermis: number; fascia: number }

/** Named anchors written by tools/make-skin.mjs (block frame in mm unless noted; see docs/STRUCTURES.md). */
export interface SkinAnchors {
  'block-bounds-mm': [Vec3, Vec3];
  'thick-thin-boundary': { x: number; transition: [number, number]; line: [Vec3, Vec3] };
  'thin-site': Vec3;
  'thick-site': Vec3;
  'depth-epidermis-top': ThinThick;
  'depth-dermal-junction': ThinThick;
  'depth-dermis-hypodermis': ThinThick;
  'depth-fascia': ThinThick;
  'layer-heights': { thin: Record<string, number>; thick: Record<string, number> };
  'layer-thickness-mm': { thin: LayerThickness; thick: LayerThickness };
  receptors: {
    'meissner-corpuscle': ReceptorAnchor[];
    'merkel-discs': ReceptorAnchor[];
    'pacinian-corpuscle': ReceptorAnchor[];
    'ruffini-ending': ReceptorAnchor[];
    'free-nerve-endings': ReceptorAnchor[];
    'hair-follicle-plexus': ReceptorAnchor;
    'touch-dome': ReceptorAnchor;
  };
  'sweat-pore': { gland: string; p: Vec3; thick: boolean }[];
  'sweat-coils': { gland: string; p: Vec3; depthMm: number }[];
  'hair-exit': Vec3;
  'follicle-bulb': Vec3;
  'follicle-axis': [Vec3, Vec3];
  'follicle-angle-deg': number;
  'sebaceous-gland': Vec3;
  'apocrine-opening': Vec3;
  'arrector-insertion': Vec3;
  'arrector-origin': Vec3;
  'superficial-plexus-lines': { arterioles: Vec3[][]; venules: Vec3[][] };
  'deep-plexus-lines': { arteries: Vec3[][]; veins: Vec3[][] };
  'standard-sections': Record<'thin-follicle' | 'thick-gland', { axis: 'x' | 'z'; at: number }>;
  /** Body scene: the rule-of-nines regions, index = the _REGION vertex value. */
  'body-regions': { attribute: '_REGION'; regions: BodyRegion[] };
  /** Body scene: dermatome levels, index = the _DERMATOME vertex value (255 = trigeminal face). */
  dermatomes: { attribute: '_DERMATOME'; levels: string[]; trigeminal: number; areaPercent: Record<string, number> };
  'body-landmarks-m': Record<string, unknown>;
}
export const anchors = geometryJson.anchors as unknown as SkinAnchors;

export const vec = (p: readonly number[]): Vec3 => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];

/** A point (or size) in a scene's own units → world units. */
export const toWorld = (p: readonly number[], view: View): Vec3 => {
  const k = view === 'block' ? BLOCK_SCALE : 1;
  return [(p[0] ?? 0) * k, (p[1] ?? 0) * k, (p[2] ?? 0) * k];
};
/** World units → the scene's own units. */
export const fromWorld = (p: readonly number[], view: View): Vec3 => {
  const k = view === 'block' ? 1 / BLOCK_SCALE : 1;
  return [(p[0] ?? 0) * k, (p[1] ?? 0) * k, (p[2] ?? 0) * k];
};

/** The scene a structure belongs to (a group: its first member's). */
export function viewOf(def: SimulationDefinition, id: string): View | null {
  const g = geometry[id];
  if (g) return g.scene;
  const s = def.structures.find((x) => x.id === id);
  for (const m of s?.members ?? []) { const v = geometry[m]?.scene; if (v) return v; }
  return null;
}

/** A point to hang a label on, in world units: on the structure's surface, or the middle of a group. */
export function anchorOf(def: SimulationDefinition, id: string): Vec3 | null {
  const g = geometry[id];
  if (g) return toWorld(g.surfaceAnchor ?? g.centroid, g.scene);
  const s = def.structures.find((x) => x.id === id);
  if (s?.kind === 'group' && s.members) {
    const pts = s.members.map((m) => anchorOf(def, m)).filter((p): p is Vec3 => p !== null);
    if (!pts.length) return null;
    return [0, 1, 2].map((a) => pts.reduce((n, p) => n + p[a]!, 0) / pts.length) as Vec3;
  }
  return null;
}

/** World-space axis-aligned bounds of a set of structures (groups expand to their members). */
export function boundsOfIds(def: SimulationDefinition, ids: readonly string[]): [Vec3, Vec3] | null {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const visit = (id: string) => {
    const g = geometry[id];
    if (g) {
      const a = toWorld(g.bounds[0]!, g.scene), b = toWorld(g.bounds[1]!, g.scene);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, a[k]!); hi[k] = Math.max(hi[k]!, b[k]!); }
      return;
    }
    def.structures.find((x) => x.id === id)?.members?.forEach(visit);
  };
  ids.forEach(visit);
  return Number.isFinite(lo[0]) ? [lo, hi] : null;
}

/** World bounds of a box given in the scene's own units. */
export const boxToWorld = (b: readonly (readonly number[])[], view: View): [Vec3, Vec3] => [toWorld(b[0]!, view), toWorld(b[1]!, view)];

/** The tissue block itself (without the hair above it), in world units. */
export const BLOCK_BOUNDS: [Vec3, Vec3] = boxToWorld(anchors['block-bounds-mm'], 'block');

/** What each view frames by default (world bounds). */
export function homeBounds(def: SimulationDefinition, view: View = 'block'): [Vec3, Vec3] {
  if (view === 'block') return BLOCK_BOUNDS;
  return boundsOfIds(def, ['body-skin']) ?? [[-0.4, 0, -0.2], [0.4, 1.8, 0.2]];
}

/** Bounds the cut slider spans in each view (world units): the block, or the body. */
export function cutBounds(def: SimulationDefinition, view: View): [Vec3, Vec3] {
  return homeBounds(def, view);
}

/** The slider position (−1 … 1) that puts a cut at `mm` along an axis of the block. */
export function sliceAtForMm(axis: 'x' | 'y' | 'z', mm: number): number {
  const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const [lo, hi] = anchors['block-bounds-mm'];
  const c = (lo[a]! + hi[a]!) / 2, half = (hi[a]! - lo[a]!) / 2;
  return Math.max(-1, Math.min(1, (mm - c) / half));
}

/** Rule-of-nines regions, in _REGION order. */
export const BODY_REGIONS = anchors['body-regions'].regions;
/** Dermatome levels, in _DERMATOME order (255 is the trigeminal face). */
export const DERMATOME_LEVELS = anchors.dermatomes.levels;
