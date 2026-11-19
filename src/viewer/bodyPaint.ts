/**
 * Per-vertex paint for the body surface (BodyParts3D, metres): rule-of-nines regions, dermatomes
 * (one level picked out), burns by region and palm-sized patches, and skin temperature with cooler
 * hands and feet. Also finds the two-point test sites on the mesh from its region labels.
 */
import * as THREE from 'three';
import { BODY_REGIONS, DERMATOME_LEVELS } from '../skin/anchors';
import type { BodyRegionId, BurnDepthId } from '../skin/wounds';
import type { BodySiteId } from '../skin/sensation';
import { localSkinC, thermalColour } from '../app/visual';
import { DERMATOME_COLOURS, REGION_COLOURS, TRIGEMINAL_COLOUR } from './palette';

const REGION_INDEX = new Map(BODY_REGIONS.map((r, i) => [r.id, i]));
const BASE_SKIN = new THREE.Color('#e0a88e');

function attr(geometry: THREE.BufferGeometry, name: string) {
  return geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
}

function cached(geometry: THREE.BufferGeometry, key: string, make: () => Float32Array | null): THREE.BufferAttribute | null {
  const cache = (geometry.userData.paint ??= new Map<string, THREE.BufferAttribute>()) as Map<string, THREE.BufferAttribute>;
  const hit = cache.get(key);
  if (hit) return hit;
  const arr = make();
  if (!arr) return null;
  if (cache.size > 24) cache.clear();
  const a = new THREE.BufferAttribute(arr, 3);
  cache.set(key, a);
  return a;
}

/** Region colours. */
export function regionPaint(g: THREE.BufferGeometry) {
  return cached(g, 'regions', () => {
    const src = attr(g, '_region');
    if (!src) return null;
    const pal = REGION_COLOURS.map((h) => new THREE.Color(h));
    const out = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) { const c = pal[src.getX(i)] ?? BASE_SKIN; out.set([c.r, c.g, c.b], i * 3); }
    return out;
  });
}

/** Dermatome colours; with a level picked, the others are washed out. */
export function dermatomePaint(g: THREE.BufferGeometry, highlight: string | null) {
  return cached(g, `derm:${highlight ?? ''}`, () => {
    const src = attr(g, '_dermatome');
    if (!src) return null;
    const pal = DERMATOME_COLOURS.map((h) => new THREE.Color(h));
    const tri = new THREE.Color(TRIGEMINAL_COLOUR), pale = new THREE.Color('#f4efec');
    const hi = highlight ? DERMATOME_LEVELS.indexOf(highlight) : -1;
    const out = new Float32Array(src.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < src.count; i++) {
      const v = src.getX(i);
      c.copy(v === 255 ? tri : pal[v] ?? tri);
      if (hi >= 0 && v !== hi) c.lerp(pale, Math.abs(v - hi) === 1 ? 0.55 : 0.8);
      out.set([c.r, c.g, c.b], i * 3);
    }
    return out;
  });
}

export const BURN_COLOURS: Record<BurnDepthId, string> = {
  superficial: '#e8483c', 'superficial-partial': '#d8304e', 'deep-partial': '#a8283c', 'full-thickness': '#f6f0dc', 'fourth-degree': '#2a1c16',
};
/** Radius of a palm-sized (≈ 1 % TBSA) patch on a 1.85 m² body, m: √(0.0185/π). */
export const PALM_RADIUS_M = Math.sqrt(0.0185 / Math.PI);

/** Burned regions (fraction < 1 burns the front of a limb or the head) and palm-sized patches. */
export function burnPaint(g: THREE.BufferGeometry, regions: Partial<Record<BodyRegionId, number>>, spots: readonly number[], depth: BurnDepthId) {
  const key = `burn:${depth}:${JSON.stringify(regions)}:${spots.map((v) => v.toFixed(3)).join(',')}`;
  return cached(g, key, () => {
    const src = attr(g, '_region'), pos = attr(g, 'position');
    if (!src || !pos) return null;
    const burn = new THREE.Color(BURN_COLOURS[depth]);
    const out = new Float32Array(src.count * 3);
    const frac = BODY_REGIONS.map((r) => regions[r.id] ?? 0);
    const p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < src.count; i++) {
      p.fromBufferAttribute(pos, i);
      const f = frac[src.getX(i)] ?? 0;
      let k = f >= 1 ? 1 : f > 0 && p.z > 0 ? 1 : 0;
      for (let j = 0; j + 2 < spots.length && k < 1; j += 3) {
        s.set(spots[j]!, spots[j + 1]!, spots[j + 2]!);
        const d = p.distanceTo(s);
        if (d < PALM_RADIUS_M) k = Math.max(k, Math.min(1, (PALM_RADIUS_M - d) / 0.01));
      }
      c.copy(BASE_SKIN).lerp(burn, k);
      // Blotches in deep and full-thickness burns.
      if (k > 0 && depth === 'deep-partial') c.lerp(new THREE.Color('#f2e6e0'), 0.45 * Math.max(0, Math.sin(p.x * 140) * Math.sin(p.y * 120 + p.z * 90)));
      if (k > 0 && depth === 'full-thickness') c.lerp(new THREE.Color('#8a5a3a'), 0.35 * Math.max(0, Math.sin(p.x * 90) * Math.sin(p.y * 70 + p.z * 60)));
      out.set([c.r, c.g, c.b], i * 3);
    }
    return out;
  });
}

/** 0 on the trunk … 1 at the fingertips, toes, nose and ears (for cold hands and feet). */
export function distalFactor(g: THREE.BufferGeometry): Float32Array {
  if (g.userData.distal) return g.userData.distal as Float32Array;
  const src = attr(g, '_region'), pos = attr(g, 'position');
  const n = pos?.count ?? 0;
  const out = new Float32Array(n);
  if (!src || !pos) return out;
  let handY = Infinity, top = 0;
  for (let i = 0; i < n; i++) { const r = BODY_REGIONS[src.getX(i)]?.id; const y = pos.getY(i); if (r?.startsWith('arm')) handY = Math.min(handY, y); top = Math.max(top, y); }
  const shoulder = 1.42, crotch = 0.77;
  for (let i = 0; i < n; i++) {
    const r = BODY_REGIONS[src.getX(i)]?.id ?? '';
    const y = pos.getY(i), x = pos.getX(i), z = pos.getZ(i);
    let d = 0;
    if (r.startsWith('arm')) d = Math.pow(Math.min(1, Math.max(0, (shoulder - y) / (shoulder - handY))), 1.6);
    else if (r.startsWith('leg')) d = Math.pow(Math.min(1, Math.max(0, (crotch - y) / crotch)), 1.6);
    else if (r === 'head-neck' && y > top - 0.2) d = Math.min(0.6, Math.max(0, z - 0.06) * 8 + Math.max(0, Math.abs(x) - 0.06) * 8);
    out[i] = d;
  }
  g.userData.distal = out;
  return out;
}

/** Skin temperature paint (thermal-camera colours), written into `target` (or a new array). */
export function thermalPaint(g: THREE.BufferGeometry, skinC: number, coreC: number, dilation: number, target?: Float32Array): Float32Array {
  const d = distalFactor(g);
  const out = target ?? new Float32Array(d.length * 3);
  for (let i = 0; i < d.length; i++) out.set(thermalColour(localSkinC(skinC, coreC, dilation, d[i]!)), i * 3);
  return out;
}

/**
 * The two-point test sites on this body (the patient's right side, as in Weinstein's charts), found
 * from the region labels: the extreme vertex of a region near a height, at the front or back.
 */
export function findSites(g: THREE.BufferGeometry): Record<BodySiteId, THREE.Vector3> | null {
  if (g.userData.sites) return g.userData.sites as Record<BodySiteId, THREE.Vector3>;
  const src = attr(g, '_region'), pos = attr(g, 'position');
  if (!src || !pos) return null;
  const n = pos.count;
  const reg = (i: number) => BODY_REGIONS[src.getX(i)]?.id ?? '';
  let top = 0, handY = Infinity, footY = Infinity;
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    top = Math.max(top, y);
    if (reg(i) === 'arm-right') handY = Math.min(handY, y);
    if (reg(i) === 'leg-right') footY = Math.min(footY, y);
  }
  const p = new THREE.Vector3();
  /** Best vertex of a region within ±tol of height y (and x within a band), by a score. */
  const pick = (region: string | null, y: number, tol: number, score: (v: THREE.Vector3) => number, xBand?: [number, number]) => {
    let best: THREE.Vector3 | null = null, bs = -Infinity;
    for (let i = 0; i < n; i++) {
      if (region && reg(i) !== region) continue;
      p.fromBufferAttribute(pos, i);
      if (Math.abs(p.y - y) > tol) continue;
      if (xBand && (p.x < xBand[0] || p.x > xBand[1])) continue;
      const s = score(p);
      if (s > bs) { bs = s; best = p.clone(); }
    }
    return best ?? new THREE.Vector3(0, y, 0);
  };
  const front = (v: THREE.Vector3) => v.z, back = (v: THREE.Vector3) => -v.z;
  const sites: Record<BodySiteId, THREE.Vector3> = {
    fingertip: pick('arm-right', handY + 0.004, 0.006, (v) => -v.y),
    thumb: pick('arm-right', handY + 0.075, 0.03, (v) => v.z * 2 - v.x),
    palm: pick('arm-right', handY + 0.14, 0.02, front),
    lip: pick('head-neck', top - 0.17, 0.01, front),
    nose: pick('head-neck', top - 0.12, 0.03, front),
    cheek: pick('head-neck', top - 0.135, 0.01, front, [-0.07, -0.035]),
    forehead: pick('head-neck', top - 0.055, 0.01, front, [-0.03, 0.03]),
    hallux: pick('leg-right', footY + 0.02, 0.02, front),
    sole: pick('leg-right', footY + 0.002, 0.004, (v) => -Math.abs(v.z - 0.0)),
    forearm: pick('arm-right', handY + 0.33, 0.02, front),
    'upper-arm': pick('arm-right', 1.22, 0.02, front),
    shoulder: pick('arm-right', 1.39, 0.03, (v) => v.y - Math.abs(v.z) * 2),
    breast: pick('trunk-anterior', 1.27, 0.015, front, [-0.13, -0.06]),
    belly: pick('trunk-anterior', 1.0, 0.015, front, [-0.08, -0.03]),
    back: pick('trunk-posterior', 1.2, 0.015, back, [-0.09, -0.04]),
    thigh: pick('leg-right', 0.6, 0.015, front),
    calf: pick('leg-right', 0.3, 0.015, back),
  };
  g.userData.sites = sites;
  return sites;
}

export { REGION_INDEX };
