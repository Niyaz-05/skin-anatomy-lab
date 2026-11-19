#!/usr/bin/env node
/**
 * Build public/models/skin.glb: the human skin, as two scenes in one file (docs/STRUCTURES.md).
 *
 *   node tools/make-skin.mjs [<Human Atlas public/models dir>]
 *   (default: D:/Solar system/repo4-human-atlas/public/models)
 *
 * Scene "body" — BodyParts3D 4.0 (DBCLS, CC BY 4.0) as built by Human Atlas: the body surface
 *   (FJ2810 "Skin"), hair of head (FJ2813) and pubic hair (FJ2815), in metres (+x = patient's left,
 *   +y up, +z anterior). The skin carries two per-vertex labels: _REGION (rule-of-nines region,
 *   0–7) and _DERMATOME (0–28 = C2…S5; 255 = face, trigeminal territory). Both are classified from
 *   vertex position on horizontal contour slices — see `classifyBody` for the rules and their
 *   approximation; areas are measured on the mesh and written to geometry.json.
 *
 * Scene "block" — a 6 × 4 mm block of skin down to the deep fascia, modelled in code at
 *   1 unit = 1 mm (origin at the centre of the skin surface, +y out of the skin, x from thin (hairy)
 *   skin at −x to thick (palmar) skin at +x, boundary at x ≈ 0.6). Layer thicknesses are true adult
 *   values (provenance.json → dimensions); nothing is exaggerated except where noted there (nerve
 *   fibres and capillaries drawn ≥ their real calibre so they stay visible; Merkel complexes ×1.3;
 *   cell densities reduced, gland and receptor counts reduced).
 *   - Each tissue layer is a closed slab between two heightfield interfaces; neighbours share the
 *     same simplified interface, so cut faces fit exactly.
 *   - Fibrous septa are signed-distance sheets on the Voronoi faces of lobule seeds.
 *   - Appendages, receptors, vessels and nerves are swept tubes, surfaces of revolution and SDF
 *     unions placed at their histological depths (checked below; the build fails if one is wrong).
 *   - Melanocytes and Langerhans cells are instanced (EXT_mesh_gpu_instancing).
 *
 * Writes public/models/skin.glb, src/skin/generated/geometry.json (bounds, anchors, body labels),
 * src/skin/generated/provenance.json, src/skin/source/structures.source.json and public/ATTRIBUTION.md.
 * Run tools/bake-shading.mjs afterwards (npm run skin:make does both).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshGPUInstancing } from '@gltf-transform/extensions';
import { r6, weld, smoothNormals, simplify, bboxOf, centroid, signedVolume, THREE } from './mesh-lib.mjs';
import { add, sub, mul, dot, cross, len, norm, lerp, dist, rotate, sdEllipsoid, sdCapsule, sdPolyTube, union, surfaceNets, curvePoints, polyLen, flip } from './sdf-lib.mjs';
import {
  clamp, mix, smoothstep, sminf, hash2, fbm2, vnoise3, seedGrid, voronoiEdge2, gridSurface, simplifySurface, slab,
  tube, hollowTube, lathe, halfEllipse, blob, merge, linear, lerp3, avoid, selfClearance, closestOnSegment,
} from './skin-geo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const humanDir = process.argv[2] ?? 'D:/Solar system/repo4-human-atlas/public/models';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ── BodyParts3D reader (as in the skeletal lab's extractor) ─────────────────
function atlasReader(dir) {
  const bytes = fs.readFileSync(path.join(dir, 'atlas.json'));
  const atlas = JSON.parse(bytes.toString('utf8'));
  const cache = new Map(), hashes = {};
  const chunk = (i) => {
    if (!cache.has(i)) {
      const file = path.join(dir, atlas.chunks[i].url.split('/').pop());
      const buf = fs.readFileSync(file);
      cache.set(i, buf);
      hashes[path.basename(file)] = sha256(buf);
    }
    return cache.get(i);
  };
  const byId = new Map(atlas.parts.map((p) => [p.id, p]));
  const get = (id) => {
    const p = byId.get(id);
    if (!p) throw new Error(`${dir}: part "${id}" missing`);
    const b = chunk(p.chunk);
    return {
      part: p,
      positions: new Float32Array(b.buffer.slice(b.byteOffset + p.positions, b.byteOffset + p.positions + p.vertexCount * 12)),
      indices: new Uint32Array(b.buffer.slice(b.byteOffset + p.indices, b.byteOffset + p.indices + p.indexCount * 4)),
    };
  };
  return { bytes, atlas, get, hashes };
}
const human = atlasReader(humanDir);

const meshes = new Map(); // id → { id, scene, layer, positions, indices, normals?, colors?, attrs?, instances?, source }
const sources = {};
const put = (id, scene, layer, m, source, extra = {}) => {
  if (meshes.has(id)) throw new Error(`duplicate mesh ${id}`);
  if (m.positions.some((v) => !Number.isFinite(v))) throw new Error(`${id}: non-finite positions`);
  meshes.set(id, { id, scene, layer, ...m, ...extra, source });
  sources[id] = { id, scene, layer, ...source };
  log(`${id}: ${m.indices.length / 3} triangles${extra.instances ? ` × ${extra.instances.length} instances` : ''}`);
};

// ═══════════════════════════════════════════════════════════════════════════
// Body scene
// ═══════════════════════════════════════════════════════════════════════════
const BODY = { 'body-skin': 'FJ2810', 'scalp-hair': 'FJ2813', 'pubic-hair': 'FJ2815' };
const bp3dParts = {};
let sourceTriangles = 0;
const REGIONS = [
  { id: 'head-neck', label: 'Head and neck', percent: 9 },
  { id: 'arm-left', label: 'Left upper limb', percent: 9 },
  { id: 'arm-right', label: 'Right upper limb', percent: 9 },
  { id: 'trunk-anterior', label: 'Anterior trunk', percent: 18 },
  { id: 'trunk-posterior', label: 'Posterior trunk (with buttocks)', percent: 18 },
  { id: 'leg-left', label: 'Left lower limb', percent: 18 },
  { id: 'leg-right', label: 'Right lower limb', percent: 18 },
  { id: 'perineum', label: 'Perineum and genitalia', percent: 1 },
];
const RI = Object.fromEntries(REGIONS.map((r, i) => [r.id, i]));
const DERMATOMES = ['C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', ...Array.from({ length: 12 }, (_, i) => `T${i + 1}`), 'L1', 'L2', 'L3', 'L4', 'L5', 'S1', 'S2', 'S3', 'S4', 'S5'];
const DI = Object.fromEntries(DERMATOMES.map((d, i) => [d, i]));
const TRIGEMINAL = 255;
let bodyInfo = null;

{
  for (const [id, fj] of Object.entries(BODY)) {
    const raw = human.get(fj);
    sourceTriangles += raw.indices.length / 3;
    bp3dParts[id] = [`${fj} ${raw.part.name}`];
    let m = weld(raw.positions, raw.indices);
    if (id === 'body-skin') m = simplify(m.positions, m.indices, 28000 / (m.indices.length / 3), 0.0015);
    if (signedVolume(m) < 0) flip(m);
    put(id, 'body', 'body', { positions: m.positions, indices: m.indices }, { bp3d: [fj], note: id === 'body-skin' ? 'BodyParts3D skin surface, welded and simplified to about 28,000 triangles; per-vertex rule-of-nines region and dermatome labels added.' : `BodyParts3D ${raw.part.name.toLowerCase()}, welded.` });
  }
  bodyInfo = classifyBody(meshes.get('body-skin'));
}

/**
 * Rule-of-nines regions and an approximate dermatome map, from vertex position.
 * 1. Horizontal contour slices every 1 cm give the connected outlines at each height: below the
 *    crotch two legs (and the hands, lateral); between crotch and axilla the trunk and two arms;
 *    above the axilla one outline (trunk and shoulders), then the neck and head.
 * 2. Regions: limbs are their own outlines; above the axilla the arm takes the shoulder cap lateral
 *    to a line rising from the axillary fold to the acromion; head and neck lie above the narrowest
 *    level between shoulders and head minus a margin; the trunk is split anterior/posterior at the
 *    middle of its depth; the leg starts at the gluteal fold behind and the inguinal line in front;
 *    the perineum is a small midline zone at the crotch.
 * 3. Dermatomes follow the evidence-based map of Lee et al. (2008) with the limb strips of Keegan &
 *    Garrett (1948): trigeminal face; C2 occiput and angle of jaw; C3 neck; C4 cape over the shoulders
 *    and upper chest to the T2 line; thoracic bands sloping down from back to front (T4 nipple, T10
 *    umbilicus, T12/L1 groin); arm C5 lateral arm, C6 lateral forearm and thumb, C7 middle finger and
 *    dorsal forearm strip, C8 little finger and medial forearm, T1 medial forearm/elbow, T2 medial arm;
 *    leg L1 groin, L2–L3 anterior thigh, L4 medial leg, L5 lateral leg and dorsum of foot, S1 lateral
 *    foot, sole and lower calf, S2 posterior thigh and calf strip, S3 medial buttock, S4–S5 perianal.
 *    Boundaries are drawn at typical body proportions measured on this mesh; real dermatomes overlap
 *    and vary between people, so this is a teaching approximation.
 */
function classifyBody(m) {
  const P = m.positions, I = m.indices, nV = P.length / 3;
  const N = smoothNormals(P, I);
  let yTop = -Infinity; for (let i = 1; i < P.length; i += 3) yTop = Math.max(yTop, P[i]);
  const STEP = 0.01;
  const slices = [];
  for (let y = STEP / 2; y < yTop; y += STEP) slices.push(sliceComps(P, I, y));
  const sliceAt = (y) => slices[clamp(Math.round((y - STEP / 2) / STEP), 0, slices.length - 1)];
  const yOf = (k) => STEP / 2 + k * STEP;
  // Crotch: highest level below 1.1 m with a separate leg on each side of the midline.
  let kCrotch = 0;
  for (let k = 0; k < slices.length && yOf(k) < 1.1; k++) {
    const c = slices[k];
    if (c.some((q) => q.cx < -0.02 && q.x1 < 0.01 && Math.abs(q.cx) < 0.15) && c.some((q) => q.cx > 0.02 && q.x0 > -0.01 && Math.abs(q.cx) < 0.15)) kCrotch = k;
  }
  const yCrotch = yOf(kCrotch) + STEP / 2;
  // Axilla, per side: highest level where the arm is a separate outline.
  const axilla = {};
  for (const sgn of [-1, 1]) {
    let kA = kCrotch;
    for (let k = kCrotch; k < slices.length; k++) if (slices[k].some((q) => sgn * q.cx > 0.14 && !(q.x0 < 0 && q.x1 > 0))) kA = k;
    const trunk = slices[kA].find((q) => q.x0 < 0 && q.x1 > 0) ?? slices[kA][0];
    axilla[sgn] = { y: yOf(kA), xEdge: sgn > 0 ? trunk.x1 : -trunk.x0 };
  }
  const yAx = Math.min(axilla[-1].y, axilla[1].y);
  // Neck: narrowest outline between the axilla + 8 cm and the top of the head.
  let kNeck = 0, wMin = Infinity;
  for (let k = 0; k < slices.length; k++) {
    const y = yOf(k);
    if (y < yAx + 0.08 || y > yTop - 0.12) continue;
    const w = Math.max(...slices[k].map((q) => q.x1 - q.x0));
    if (w < wMin) { wMin = w; kNeck = k; }
  }
  const yNeckMin = yOf(kNeck);
  // Base of the neck: going down from the narrowest level, where the outline widens past 1.6×.
  let yNeck = yNeckMin;
  for (let k = kNeck; k > 0; k--) { const w = Math.max(...slices[k].map((q) => q.x1 - q.x0)); if (w > wMin * 1.6) { yNeck = yOf(k); break; } }
  const yChin = yNeckMin + 0.03;
  const H = yNeck - yCrotch;
  // Arm outline centres per level (for the arm axis), carried up past the axilla.
  const armAxis = { [-1]: [], [1]: [] };
  let yFinger = { [-1]: Infinity, [1]: Infinity };
  for (let k = 0; k < slices.length; k++) for (const sgn of [-1, 1]) {
    const arm = slices[k].filter((q) => sgn * q.cx > 0.14 && !(q.x0 < 0 && q.x1 > 0) && (yOf(k) > yCrotch - 0.25)).sort((a, b) => sgn * (b.cx - a.cx))[0];
    if (arm) { armAxis[sgn][k] = arm; yFinger[sgn] = Math.min(yFinger[sgn], yOf(k)); }
  }
  const armAt = (sgn, y) => {
    let k = clamp(Math.round((y - STEP / 2) / STEP), 0, slices.length - 1);
    for (let d = 0; d < 40; d++) { if (armAxis[sgn][k - d]) return armAxis[sgn][k - d]; if (armAxis[sgn][k + d]) return armAxis[sgn][k + d]; }
    return { cx: sgn * 0.25, cz: 0, x0: sgn * 0.2, x1: sgn * 0.3 };
  };

  const region = new Uint8Array(nV), derm = new Uint8Array(nV);
  for (let v = 0; v < nV; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const comps = sliceAt(y);
    let comp = comps[0], cd = Infinity;
    for (const q of comps) { const d = segDist(q, x, z); if (d < cd) { cd = d; comp = q; } }
    const side = x >= 0 ? 1 : -1; // +x = patient's left
    const isTrunkComp = comp && comp.x0 < 0.01 && comp.x1 > -0.01 && Math.abs(comp.cx) < 0.12;
    const zMid = comp ? (comp.z0 + comp.z1) / 2 : 0;
    const depth = comp ? Math.max(0.02, (comp.z1 - comp.z0) / 2) : 0.1;
    const ant = clamp((z - zMid) / depth, -1, 1);
    let r;
    if (y > yNeck - 0.01 + 0.025 * Math.max(0, -ant)) r = 'head-neck';
    else if (y < yCrotch) r = comp && Math.abs(comp.cx) > 0.14 && !isTrunkComp ? (side > 0 ? 'arm-left' : 'arm-right') : (side > 0 ? 'leg-left' : 'leg-right');
    else if (!isTrunkComp && comp && Math.abs(comp.cx) > 0.12) r = side > 0 ? 'arm-left' : 'arm-right';
    else if (y > axilla[side].y - 0.005 && Math.abs(x) > axilla[side].xEdge - 0.012 + (y - axilla[side].y) * 0.3) r = side > 0 ? 'arm-left' : 'arm-right';
    else {
      // Trunk, legs (inguinal line in front, gluteal fold behind) and perineum.
      const legLine = yCrotch + (ant > 0 ? 0.01 + 0.5 * Math.max(0, Math.abs(x) - 0.03) * ant : -0.005);
      if (Math.abs(x) < 0.042 && y < yCrotch + 0.045 && y > yCrotch - 0.04 && ant < 0.9) r = 'perineum';
      else if (y < legLine) r = side > 0 ? 'leg-left' : 'leg-right';
      else r = ant >= 0 ? 'trunk-anterior' : 'trunk-posterior';
    }
    region[v] = RI[r];
    derm[v] = dermatomeOf(r, x, y, z, ant, side, comp, N[v * 3 + 1]);
  }

  function dermatomeOf(r, x, y, z, ant, side, comp, ny) {
    const T = (n) => DI[`T${n}`];
    if (r === 'head-neck') {
      if (y > yChin + 0.035 * (1 - ant) && ant > -0.25) return TRIGEMINAL;
      if (y > yChin) return DI.C2;
      if (y > yNeckMin - 0.02) return ant < -0.3 ? DI.C2 : DI.C3;
      return y > yNeck + 0.025 ? DI.C3 : DI.C4;
    }
    if (r === 'trunk-anterior' || r === 'trunk-posterior') {
      const f = (y - yCrotch) / H;
      // Level (thoracic number, with L1 = 13, L2 = 14 …) as a function of height, front and back.
      const front = interp(f, [[0.0, 13.5], [0.06, 13], [0.13, 12], [0.33, 10], [0.55, 6], [0.69, 4], [0.85, 2], [0.92, 1]]);
      const back = interp(f, [[0.0, 17.5], [0.1, 16], [0.16, 15], [0.22, 14], [0.27, 13], [0.33, 12], [0.48, 10], [0.67, 7], [0.84, 4], [0.93, 2], [0.97, 1]]);
      const lvl = mix(back, front, smoothstep(-0.5, 0.5, ant));
      if (f > 0.84 && lvl < 2.5) return DI.C4;
      if (lvl <= 1.5 && f > 0.9) return DI.C4;
      if (r === 'trunk-posterior' && f < 0.16) return Math.abs(x) < 0.05 ? DI.S3 : (lvl > 16.5 ? DI.S2 : DI.L3);
      const n = clamp(Math.round(lvl), 1, 17);
      if (n <= 12) return T(n);
      return DI[`L${Math.min(3, n - 12)}`];
    }
    if (r === 'arm-left' || r === 'arm-right') {
      const yShoulder = axilla[side].y + 0.12;
      const s = clamp((yShoulder - y) / (yShoulder - yFinger[side]), 0, 1);
      const a = armAt(side, y);
      const dxLat = side * (x - a.cx), dz = z - a.cz;
      const th = Math.atan2(dz, dxLat) * 180 / Math.PI; // 0 lateral, 90 anterior, ±180 medial, −90 posterior
      if (s < 0.1) return DI.C5;
      if (s < 0.44) return Math.abs(th) < 100 ? DI.C5 : (s < 0.27 ? T(2) : T(1));
      if (s < 0.77) {
        if (Math.abs(th) < 60) return DI.C6;
        if (Math.abs(th) > 120) return s < 0.56 ? T(1) : DI.C8;
        if (th < 0) return DI.C7;
        return th < 90 ? DI.C6 : DI.C8;
      }
      const half = Math.max(0.01, (a.x1 - a.x0) / 2);
      const u = dxLat / half;
      return u > 0.3 ? DI.C6 : u > -0.3 ? DI.C7 : DI.C8;
    }
    if (r === 'perineum') {
      if (ant > 0.25) return y > yCrotch + 0.02 ? DI.L1 : DI.S3;
      const d = Math.hypot(x, y - (yCrotch - 0.005));
      return d < 0.012 ? DI.S5 : d < 0.025 ? DI.S4 : DI.S3;
    }
    // Leg
    const t = clamp((yCrotch - y) / yCrotch, 0, 1);
    const dxLat = side * (x - comp.cx), dz = z - comp.cz;
    const th = Math.atan2(dz, dxLat) * 180 / Math.PI;
    if (y < 0.075) {
      if (ny < -0.5) return DI.S1;
      const half = Math.max(0.01, (comp.x1 - comp.x0) / 2);
      const u = dxLat / half;
      return u > 0.3 ? DI.S1 : u < -0.65 ? DI.L4 : DI.L5;
    }
    if (t < 0.43) {
      if (th < -45 && th > -135) return t < 0.14 && th < -90 ? DI.S3 : DI.S2;
      if (th <= -135 && t < 0.1) return DI.S3;
      return t < 0.09 ? DI.L1 : t < 0.26 ? DI.L2 : DI.L3;
    }
    if (th > 105 || th < -150) return DI.L4;
    if (th > -30) return DI.L5;
    if (th > -110) return DI.S1;
    return t < 0.66 ? DI.S2 : DI.S1;
  }

  // Areas.
  const areaR = new Float64Array(REGIONS.length), areaD = new Map();
  let total = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const A = 0.5 * len(cross(sub([P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]]), sub([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]])));
    total += A;
    for (const v of [a, b, c]) { areaR[region[v]] += A / 3; const k = derm[v] === TRIGEMINAL ? 'V' : DERMATOMES[derm[v]]; areaD.set(k, (areaD.get(k) ?? 0) + A / 3); }
  }
  const percent = REGIONS.map((r, i) => ({ ...r, measuredPercent: r6((100 * areaR[i]) / total) }));
  log('body regions (% of surface):', percent.map((p) => `${p.id} ${p.measuredPercent.toFixed(1)} (${p.percent})`).join(', '));
  return {
    region, derm, totalAreaM2: r6(total), regions: percent,
    dermatomeAreas: Object.fromEntries([...areaD.entries()].map(([k, a]) => [k, r6((100 * a) / total)])),
    landmarks: { crotchY: r6(yCrotch), axillaY: { left: r6(axilla[1].y), right: r6(axilla[-1].y) }, neckBaseY: r6(yNeck), neckNarrowestY: r6(yNeckMin), topY: r6(yTop) },
  };
}
function interp(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) if (x <= pts[i + 1][0]) { const t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]); return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t; }
  return pts.at(-1)[1];
}
/** Connected outlines of a horizontal slice through a mesh at height y. */
function sliceComps(P, I, y) {
  const segs = [];
  for (let t = 0; t < I.length; t += 3) {
    const pts = [];
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const a = I[t + i] * 3, b = I[t + j] * 3;
      if ((P[a + 1] - y) * (P[b + 1] - y) < 0) { const s = (y - P[a + 1]) / (P[b + 1] - P[a + 1]); pts.push([P[a] + (P[b] - P[a]) * s, P[a + 2] + (P[b + 2] - P[a + 2]) * s]); }
    }
    if (pts.length === 2) segs.push(pts);
  }
  const par = segs.map((_, i) => i);
  const f = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const grid = new Map(), G = 0.003;
  segs.forEach((s, i) => {
    for (const q of s) {
      const gx = Math.round(q[0] / G), gz = Math.round(q[1] / G);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const o = grid.get(`${gx + dx},${gz + dz}`); if (o !== undefined) par[f(o)] = f(i); }
      grid.set(`${gx},${gz}`, i);
    }
  });
  const comps = new Map();
  segs.forEach((s, i) => { const r = f(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(s); });
  return [...comps.values()].filter((c) => c.length >= 4).map((c) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, sx = 0, sz = 0;
    for (const s of c) for (const q of s) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); sx += q[0]; sz += q[1]; }
    return { segs: c, x0, x1, z0, z1, cx: sx / (2 * c.length), cz: sz / (2 * c.length) };
  });
}
function segDist(q, x, z) {
  // Cheap bbox reject, then distance to the outline's segments.
  const bx = Math.max(q.x0 - x, 0, x - q.x1), bz = Math.max(q.z0 - z, 0, z - q.z1);
  let best = Math.hypot(bx, bz) > 0.05 ? Math.hypot(bx, bz) + 1 : Infinity;
  if (best < Infinity) return best;
  for (const [a, b] of q.segs) {
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-12;
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1);
    best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════
// Skin block (millimetres)
// ═══════════════════════════════════════════════════════════════════════════
const BX0 = -3, BX1 = 3, BZ0 = -2, BZ1 = 2;
const XT = 0.6; // thin | thick boundary
const GH = 0.016;
const GRID = { nx: Math.round((BX1 - BX0) / GH) + 1, nz: Math.round((BZ1 - BZ0) / GH) + 1, x0: BX0, z0: BZ0, h: GH };
const W = (x) => smoothstep(0.35, 0.85, x); // 0 thin skin, 1 thick skin
const OUT = 0.003; // vessels, bundles and septa reach this far past the block walls, so their sections show there
const Y = [0, 1, 0];

// Layer thicknesses (mm). Thin: hairy skin of the trunk/forearm; thick: palm/fingertip.
const TH = {
  thin: { corneum: 0.018, lucidum: 0, granulosum: 0.008, basale: 0.011, minSpinosum: 0.02, dejMean: 0.105, papillae: 0.028, papillaryBottom: 0.32, dermisBottom: 2.05 },
  thick: { corneum: 0.40, lucidum: 0.035, granulosum: 0.035, basale: 0.016, minSpinosum: 0.06, dejTop: 0.59, dermalRidge: 0.72, primaryRete: 1.02, secondaryRete: 0.89, papillaryBottom: 1.22, dermisBottom: 3.05 },
  fasciaTop: 5.25, fasciaThickness: 0.28,
};
const tc = (x) => mix(TH.thin.corneum, TH.thick.corneum, W(x));
const tl = (x) => TH.thick.lucidum * smoothstep(0.45, 0.95, x);
const tg = (x) => mix(TH.thin.granulosum, TH.thick.granulosum, W(x));
const tb = (x) => mix(TH.thin.basale, TH.thick.basale, W(x));
const minSp = (x) => mix(TH.thin.minSpinosum, TH.thick.minSpinosum, W(x));

// Thick skin: friction ridges run along z; primary (glandular) rete ridges under the crests,
// secondary (adhesive) ridges under the furrows, dermal papillae in double rows between them.
const RP = 0.46;
const ridgeX0 = (z) => 0.85 + 0.05 * Math.sin(0.9 * z + 0.4) + 0.025 * Math.sin(2.1 * z + 1.3);
const ridgeFrac = (x, z) => { const f = (x - ridgeX0(z)) / RP; return f - Math.round(f); };
const PEG_DZ = 0.115;
const bump = (u) => (u >= 1 ? 0 : (1 - u * u) ** 1.5);
/** A rounded dome (papilla) — flat-topped, smooth at the rim. */
const domeBump = (u) => (u >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * u ** 1.6));
function thickPegs() {
  const list = [];
  for (let k = -3; k <= 6; k++) for (const off of [0.25, 0.75]) {
    const stagger = off === 0.25 ? 0 : PEG_DZ / 2;
    for (let j = Math.floor((BZ0 - 0.2) / PEG_DZ); j <= Math.ceil((BZ1 + 0.2) / PEG_DZ); j++) {
      const id = k * 2 + (off === 0.25 ? 0 : 1);
      const zc = j * PEG_DZ + stagger + 0.016 * (hash2(id, j, 5) - 0.5);
      const xc = ridgeX0(zc) + (k + off) * RP + 0.012 * (hash2(id, j, 6) - 0.5);
      list.push({ x: xc, z: zc, r: 0.046 + 0.01 * hash2(id, j, 7), a: 0.85 + 0.15 * hash2(id, j, 8), row: id, j });
    }
  }
  return list;
}
const THICK_PEGS = thickPegs();
const thickPegBins = new Map();
for (const p of THICK_PEGS) { const k = `${Math.floor(p.x / 0.1)},${Math.floor(p.z / 0.1)}`; (thickPegBins.get(k) ?? thickPegBins.set(k, []).get(k)).push(p); }
function pegsThick(x, z) {
  let best = 0;
  const ci = Math.floor(x / 0.1), cj = Math.floor(z / 0.1);
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const p of thickPegBins.get(`${ci + di},${cj + dj}`) ?? []) best = Math.max(best, domeBump(Math.hypot(x - p.x, z - p.z) / p.r) * p.a);
  return best;
}
const thinGrid = seedGrid(BX0 - 0.3, 1.4, BZ0 - 0.3, BZ1 + 0.3, 0.125, 11, 0.36);
const THIN_PEGS = thinGrid.seeds.map((s) => ({ x: s.x, z: s.z, r: 0.046 + 0.012 * s.a, a: 0.72 + 0.28 * s.b }));
function pegsThin(x, z) {
  let best = 0;
  for (const s of thinGrid.near(x, z, 1)) best = Math.max(best, domeBump(Math.hypot(x - s.x, z - s.z) / (0.046 + 0.012 * s.a)) * (0.72 + 0.28 * s.b));
  return best;
}
const g2 = (d, s) => Math.exp(-((d / s) ** 2));
function dejRaw(x, z) {
  const w = W(x);
  let thin = 0, thick = 0;
  if (w < 1) thin = -(TH.thin.dejMean + TH.thin.papillae) + 2 * TH.thin.papillae * pegsThin(x, z) + 0.012 * (fbm2(x / 0.3, z / 0.3, 7) - 0.5);
  if (w > 0) {
    const f = ridgeFrac(x, z), dp = Math.abs(f) * RP, ds = (0.5 - Math.abs(f)) * RP;
    const T = TH.thick;
    thick = -(T.dermalRidge + (T.primaryRete - T.dermalRidge) * g2(dp, 0.042) + (T.secondaryRete - T.dermalRidge) * g2(ds, 0.038)) + (T.dermalRidge - T.dejTop) * pegsThick(x, z);
  }
  return mix(thin, thick, w);
}
// Skin surface: polygonal creases on thin skin, friction ridges on thick skin, pits at pores and the follicle.
const creaseGrid = seedGrid(BX0 - 0.6, 1.6, BZ0 - 0.6, BZ1 + 0.6, 0.34, 23, 0.42);
const pits = [];
function surfaceY(x, z) {
  const w = W(x);
  let thin = 0, thick = 0;
  if (w < 1) thin = -0.016 * g2(voronoiEdge2(creaseGrid, x, z), 0.012) + 0.003 * (fbm2(x / 0.2, z / 0.2, 3) - 0.5);
  if (w > 0) { const v = (1 - Math.cos(2 * Math.PI * ridgeFrac(x, z))) / 2; thick = 0.036 * (1 - 2 * v ** 2.2) + 0.002 * (fbm2(x / 0.25, z / 0.25, 4) - 0.5); }
  let y = mix(thin, thick, w);
  for (const p of pits) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) y -= p.depth * (1 - (d / p.r) ** 2) ** 2; }
  return y;
}
const papillaryBottom = (x, z) => -mix(TH.thin.papillaryBottom, TH.thick.papillaryBottom, W(x)) + 0.03 * (fbm2(x / 0.6, z / 0.6, 21) - 0.5);
const dermisBottom = (x, z) => -mix(TH.thin.dermisBottom, TH.thick.dermisBottom, W(x)) + 0.24 * (fbm2(x / 0.7, z / 0.7, 31) - 0.5);
const fasciaTop = (x, z) => -TH.fasciaTop + 0.06 * (fbm2(x / 1.2, z / 1.2, 41) - 0.5);
const fasciaBottom = (x, z) => fasciaTop(x, z) - TH.fasciaThickness + 0.02 * (fbm2(x / 0.9, z / 0.9, 43) - 0.5);
/** The upper epidermal interfaces follow the surface; the basal ones follow the dermal–epidermal junction. */
const upper = (x, z) => { const s = surfaceY(x, z); const c = s - tc(x); const l = c - tl(x); return { s, c, l, g: l - tg(x) }; };

// ── Placements (appendages, glands, receptors) ─────────────────────────────
const XF = -1.75; // follicle plane
const ZE = -0.6; // hair exit
const FOLLICLE_ANGLE = (55 * Math.PI) / 180; // with the skin surface
const dF = norm([0, -Math.sin(FOLLICLE_ANGLE), Math.cos(FOLLICLE_ANGLE)]); // down along the follicle
const aF = mul(dF, -1); // up the follicle, towards the exit
const L_F = 3.05; // bulb base → exit along the axis
const nOb = norm(sub([0, 0, -1], mul(aF, dot([0, 0, -1], aF)))); // towards the obtuse angle (the side the hair leans to)
const xOut = [1, 0, 0]; // across the follicle
pits.push({ x: XF, z: ZE, r: 0.085, depth: 0.03 });
const RIDGE_X = (k, z) => ridgeX0(z) + k * RP;
const ECCRINE = [
  { id: 'thin', coil: [XF - 0.1, -1.8, -1.45], R: 0.13, pore: [XF - 0.3, -1.62], thick: false },
  { id: 'thick-a', coil: [1.62, -2.95, 0.4], R: 0.14, pore: [RIDGE_X(2, 0.4), 0.4], thick: true },
  { id: 'thick-b', coil: [2.35, -3.0, -1.2], R: 0.13, pore: [RIDGE_X(3, -1.2), -1.2], thick: true },
  { id: 'thick-c', coil: [1.15, -2.9, -1.35], R: 0.12, pore: [RIDGE_X(1, -1.0), -1.0], thick: true },
];
for (const e of ECCRINE) pits.push({ x: e.pore[0], z: e.pore[1], r: 0.032, depth: e.thick ? 0.03 : 0.012 });

// ── Interfaces on the grid ──────────────────────────────────────────────────
log('evaluating interfaces', GRID.nx, '×', GRID.nz);
const NG = GRID.nx * GRID.nz;
const IF = Object.fromEntries(['s', 'c', 'l', 'g', 'bTop', 'dej', 'pBot', 'rBot', 'fTop', 'fBot'].map((k) => [k, new Float32Array(NG)]));
const gx = (i) => BX0 + i * GH, gz = (j) => BZ0 + j * GH;
const rawDej = new Float32Array(NG);
for (let j = 0; j < GRID.nz; j++) for (let i = 0; i < GRID.nx; i++) rawDej[i + j * GRID.nx] = dejRaw(gx(i), gz(j));
for (let j = 0; j < GRID.nz; j++) for (let i = 0; i < GRID.nx; i++) {
  const k = i + j * GRID.nx, x = gx(i), z = gz(j);
  const u = upper(x, z);
  IF.s[k] = u.s; IF.c[k] = u.c; IF.l[k] = u.l; IF.g[k] = u.g;
  const dx = (rawDej[Math.min(i + 1, GRID.nx - 1) + j * GRID.nx] - rawDej[Math.max(i - 1, 0) + j * GRID.nx]) / (2 * GH);
  const dz = (rawDej[i + Math.min(j + 1, GRID.nz - 1) * GRID.nx] - rawDej[i + Math.max(j - 1, 0) * GRID.nx]) / (2 * GH);
  const tbv = tb(x) * Math.min(2.5, Math.sqrt(1 + dx * dx + dz * dz));
  const dej = sminf(rawDej[k], u.g - tbv - minSp(x), 0.012);
  IF.dej[k] = dej; IF.bTop[k] = dej + tbv;
  IF.pBot[k] = Math.min(papillaryBottom(x, z), dej - 0.08);
  IF.rBot[k] = dermisBottom(x, z);
  IF.fTop[k] = fasciaTop(x, z);
  IF.fBot[k] = fasciaBottom(x, z);
}
/** Interface heights at any (x, z) (bilinear on the grid). */
function at(name, x, z) {
  const fi = clamp((x - BX0) / GH, 0, GRID.nx - 1.001), fj = clamp((z - BZ0) / GH, 0, GRID.nz - 1.001);
  const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, A = IF[name], n = GRID.nx;
  return mix(mix(A[i + j * n], A[i + 1 + j * n], u), mix(A[i + (j + 1) * n], A[i + 1 + (j + 1) * n], u), v);
}

// ── Tissue slabs ────────────────────────────────────────────────────────────
log('simplifying interfaces');
const ERR = { s: 0.005, c: 0.005, l: 0.005, g: 0.005, bTop: 0.0085, dej: 0.0085, pBot: 0.01, rBot: 0.012, fTop: 0.015, fBot: 0.015 };
const SURF = {};
for (const k of Object.keys(IF)) if (k !== 'bTop') SURF[k] = simplifySurface(gridSurface(GRID, IF[k]), ERR[k]);
// The basal layer's top is the junction's triangulation lifted by the layer's thickness.
SURF.bTop = { ...SURF.dej, positions: gridSurface(GRID, IF.bTop).positions };
const iLuc = Math.ceil((0.45 - BX0) / GH);
const lucTop = simplifySurface(gridSurface(GRID, IF.c, iLuc), ERR.c), lucBot = simplifySurface(gridSurface(GRID, IF.l, iLuc), ERR.l);
const SLAB_NOTE = (what) => ({ modelled: what });
put('stratum-corneum', 'block', 'epidermis', slab(SURF.s, SURF.c), SLAB_NOTE(`Anucleate keratinised squames: ${TH.thin.corneum * 1000} µm on thin skin, ${TH.thick.corneum * 1000} µm on thick skin; the surface carries polygonal creases (thin) and friction ridges ${RP} mm apart (thick), with pores and the follicular ostium.`));
put('stratum-lucidum', 'block', 'epidermis', slab(lucTop, lucBot), SLAB_NOTE(`Clear eosinophilic band of thick skin only, ${TH.thick.lucidum * 1000} µm, fading out at the thin–thick boundary.`));
put('stratum-granulosum', 'block', 'epidermis', slab(SURF.l, SURF.g), SLAB_NOTE(`Keratohyalin-granule layer, ${TH.thin.granulosum * 1000} µm (1–2 cells) on thin skin to ${TH.thick.granulosum * 1000} µm on thick skin.`));
put('stratum-spinosum', 'block', 'epidermis', slab(SURF.g, SURF.bTop), SLAB_NOTE('Prickle-cell layer: fills the rete ridges between the dermal papillae; flat on top, following the basal layer below.'));
put('stratum-basale', 'block', 'epidermis', slab(SURF.bTop, SURF.dej), SLAB_NOTE(`One cell (${TH.thin.basale * 1000}–${TH.thick.basale * 1000} µm) on the basement membrane, following every papilla.`));
put('papillary-dermis', 'block', 'dermis', slab(SURF.dej, SURF.pBot), SLAB_NOTE(`Loose connective tissue of the dermal papillae and the band beneath; thin skin: low papillae ~${(2 * TH.thin.papillae).toFixed(2)} mm high about 0.1 mm apart; thick skin: double rows of papillae between primary and secondary rete ridges.`));
put('reticular-dermis', 'block', 'dermis', slab(SURF.pBot, SURF.rBot), SLAB_NOTE(`Dense irregular connective tissue down to ${TH.thin.dermisBottom} mm (thin) / ${TH.thick.dermisBottom} mm (thick) below the surface; fat domes rise into its base.`));
put('subcutaneous-fat', 'block', 'hypodermis', slab(SURF.rBot, SURF.fTop), SLAB_NOTE(`Adipose tissue from the dermis to the deep fascia at ${TH.fasciaTop} mm.`));
put('deep-fascia', 'block', 'hypodermis', slab(SURF.fTop, SURF.fBot), SLAB_NOTE(`Investing deep fascia, ${TH.fasciaThickness} mm.`));

// ── Fibrous septa (Voronoi faces between fat lobules) ───────────────────────
{
  const seeds = [];
  const SP = 1.45;
  for (let i = -1; i <= Math.ceil((BX1 - BX0) / SP); i++) for (let j = -1; j <= Math.ceil((BZ1 - BZ0) / SP); j++) for (let k = 0; k <= 3; k++) {
    seeds.push([BX0 + (i + 0.5 + 0.7 * (hash2(i * 7 + k, j, 61) - 0.5)) * SP, -1.6 - (k + 0.5 + 0.6 * (hash2(i, j * 5 + k, 62) - 0.5)) * 1.15, BZ0 + (j + 0.5 + 0.7 * (hash2(i, j + k * 11, 63) - 0.5)) * SP]);
  }
  const HW = 0.05;
  const field = (p) => {
    // A gentle warp so faces curve.
    const q = [p[0] + 0.12 * (vnoise3(p[0] / 0.8, p[1] / 0.8, p[2] / 0.8, 71) - 0.5), p[1] + 0.12 * (vnoise3(p[0] / 0.8, p[1] / 0.8, p[2] / 0.8, 72) - 0.5), p[2] + 0.12 * (vnoise3(p[0] / 0.8, p[1] / 0.8, p[2] / 0.8, 73) - 0.5)];
    let b = 0, bd = Infinity;
    for (let s = 0; s < seeds.length; s++) { const d = (q[0] - seeds[s][0]) ** 2 + (q[1] - seeds[s][1]) ** 2 + (q[2] - seeds[s][2]) ** 2; if (d < bd) { bd = d; b = s; } }
    let e = Infinity;
    const c1 = seeds[b];
    for (let s = 0; s < seeds.length; s++) {
      if (s === b) continue;
      const c = seeds[s];
      const l = Math.hypot(c[0] - c1[0], c[1] - c1[1], c[2] - c1[2]);
      if (l > 3.2) continue;
      e = Math.min(e, ((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2 - bd) / (2 * l));
    }
    const sheet = e - HW;
    const box = Math.max(BX0 - OUT - p[0], p[0] - BX1 - OUT, BZ0 - OUT - p[2], p[2] - BZ1 - OUT, p[1] - (dermisBottom(p[0], p[2]) + OUT), (fasciaTop(p[0], p[2]) - OUT) - p[1]);
    return Math.max(sheet, box);
  };
  // Meshing the septa is slow (~2 min); the result is cached by a hash of this script's septa block.
  const cacheKey = sha256(Buffer.from(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('// ── Fibrous septa')[1].split('// ── Hair follicle')[0] + JSON.stringify(TH)));
  const cacheFile = path.join(root, 'node_modules/.cache/skin-septa.json');
  let m = null;
  try { const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (c.key === cacheKey) m = { positions: Float32Array.from(c.positions), indices: Uint32Array.from(c.indices) }; } catch { /* no cache */ }
  if (!m) {
    m = surfaceNets(field, [BX0 - 0.05, -5.35, BZ0 - 0.05], [BX1 + 0.05, -1.75, BZ1 + 0.05], 0.034, { smooth: 1, target: 12000, maxError: 0.006 });
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ key: cacheKey, positions: Array.from(m.positions), indices: Array.from(m.indices) }));
  }
  put('fibrous-septa', 'block', 'hypodermis', m, { modelled: `Connective-tissue septa (retinacula cutis) ~${2 * HW} mm thick dividing the fat into lobules ~1.5 mm across; Voronoi faces of jittered seeds, warped.` });
}

// ── Hair follicle ───────────────────────────────────────────────────────────
const hairExit = [XF, surfaceY(XF, ZE), ZE];
const BULB = sub(hairExit, mul(aF, L_F)); // bulb base
const fAt = (t) => add(BULB, mul(aF, t)); // point on the follicle axis, t mm above the bulb base
const T_ISTHMUS = L_F - 0.75, T_SEB = L_F - 0.5, T_BULGE = L_F - 1.05, T_APO = L_F - 0.25;
const SHAFT_R = 0.036;
{
  // Shaft: from the keratogenous zone above the papilla, out of the ostium, curving over the skin.
  const inside = [fAt(0.3), fAt(1.2), fAt(2.2), fAt(L_F)];
  const outsideDir = norm(add(aF, [0, -0.25, -0.35]));
  const p1 = add(hairExit, mul(aF, 0.45));
  const p2 = add(p1, add(mul(outsideDir, 0.6), [0, -0.02, -0.05]));
  const p3 = add(p2, [0, -0.08, -0.55]);
  const p4 = add(p3, [0.05, -0.12, -0.35]);
  const shaftPts = curvePoints([...inside, p1, p2, p3, p4], 0.03);
  const total = polyLen(shaftPts);
  const tipStart = 1 - 0.3 / total;
  put('hair-shaft', 'block', 'appendages', tube(shaftPts, (t) => (t < 0.02 ? SHAFT_R * (0.7 + 15 * t) : t > tipStart ? SHAFT_R * Math.max(0.15, 1 - (t - tipStart) / (1 - tipStart)) : SHAFT_R), { seg: 14, raw: true }),
    { modelled: `Terminal hair ${SHAFT_R * 2000} µm thick (cuticle, cortex, medulla not separated), from the keratogenous zone above the papilla to ${(total - L_F).toFixed(1)} mm beyond the skin, leaning with the follicle (${(FOLLICLE_ANGLE * 180 / Math.PI).toFixed(0)}° to the surface).` });
  // Inner root sheath: from the bulb to the isthmus, where it breaks down.
  put('inner-root-sheath', 'block', 'appendages', hollowTube([fAt(0.46), fAt(T_ISTHMUS)], 0.05, SHAFT_R + 0.001, { seg: 18, step: 0.05 }),
    { modelled: 'Henle and Huxley layers and cuticle (not separated): 14 µm thick around the shaft, from the bulb to the isthmus.' });
  // Outer root sheath + connective-tissue sheath, flaring into the infundibulum.
  const tTop = L_F + 0.02;
  const rOut = (t) => { const s = 0.46 + t * (tTop - 0.46); return s > T_ISTHMUS ? 0.115 + 0.075 * smoothstep(T_ISTHMUS, tTop, s) ** 1.6 : 0.115; };
  const rIn = (t) => { const s = 0.46 + t * (tTop - 0.46); return s > T_ISTHMUS ? 0.05 + 0.025 * smoothstep(T_ISTHMUS, tTop, s) ** 2 : 0.051; };
  put('hair-follicle', 'block', 'appendages', hollowTube([fAt(0.46), fAt(tTop)], rOut, rIn, { seg: 24, step: 0.04 }),
    { modelled: 'Outer root sheath with the glassy membrane and connective-tissue sheath (~65 µm), continuous with the epidermis at the infundibulum (ostium ~0.18 mm).' });
  // Bulb: matrix cup around the papilla, open below for the papilla stalk and above for the shaft.
  const bulbProfile = [
    [0.02, 0.036], [0.0, 0.075], [0.04, 0.13], [0.11, 0.17], [0.2, 0.172], [0.3, 0.148], [0.39, 0.125], [0.46, 0.115],
    [0.46, SHAFT_R + 0.001], [0.3, SHAFT_R + 0.001], [0.285, 0.052], [0.22, 0.07], [0.13, 0.074], [0.07, 0.056], [0.035, 0.038],
  ];
  put('hair-bulb', 'block', 'appendages', lathe(BULB, aF, bulbProfile, 36),
    { modelled: 'Hair bulb ~0.34 mm across: the matrix (with melanocytes) cupped around the dermal papilla, at the dermis–hypodermis junction (anagen terminal follicle).' });
  const papProfile = [[-0.04, 0], [-0.04, 0.03], [0.03, 0.032], [0.07, 0.05], [0.13, 0.07], [0.2, 0.066], [0.26, 0.047], [0.282, 0]];
  put('hair-papilla', 'block', 'appendages', lathe(BULB, aF, papProfile, 28),
    { modelled: 'Dermal (hair) papilla: a pear-shaped knot of specialised fibroblasts and capillaries, ~0.14 × 0.28 mm, with its stalk joining the connective-tissue sheath.' });
}
const FOLLICLE_OBSTACLES = [{ a: fAt(0), b: fAt(0.46), r: 0.24 }, { a: fAt(0.46), b: fAt(L_F), r: 0.18 }];

// Sebaceous gland on the obtuse side, its duct entering the follicle at the infundibulum–isthmus junction.
const SEB_C = add(fAt(T_SEB - 0.16), mul(nOb, 0.27));
{
  const lob = [
    sdEllipsoid(SEB_C, [aF, nOb, xOut], [0.16, 0.12, 0.13]),
    sdEllipsoid(add(SEB_C, add(mul(aF, -0.16), mul(xOut, 0.09))), [aF, nOb, xOut], [0.13, 0.1, 0.11]),
    sdEllipsoid(add(SEB_C, add(mul(aF, -0.1), mul(xOut, -0.11))), [aF, nOb, xOut], [0.12, 0.1, 0.1]),
    sdEllipsoid(add(SEB_C, add(mul(aF, 0.1), mul(nOb, 0.06))), [aF, nOb, xOut], [0.1, 0.09, 0.1]),
    sdCapsule(add(SEB_C, mul(aF, 0.06)), add(fAt(T_SEB), mul(nOb, 0.06)), 0.045, 0.04),
  ];
  const f = union(lob, 0.05);
  put('sebaceous-gland', 'block', 'appendages', surfaceNets(f, sub(SEB_C, [0.45, 0.45, 0.45]), add(SEB_C, [0.45, 0.45, 0.45]), 0.011, { smooth: 2, target: 5000 }),
    { modelled: 'Holocrine gland of four acini (~0.25–0.3 mm) in the angle between the follicle and the arrector pili; its short duct opens into the follicle canal ~0.5 mm below the surface.' });
}
// Arrector pili: from the bulge, below the gland, up to the papillary dermis on the side the hair leans to.
const ARRECTOR_BASE = add(fAt(T_BULGE), mul(nOb, 0.1));
const ARRECTOR_TOP = [XF, at('dej', XF, -1.72) - 0.05, -1.72];
const arrectorPath = [ARRECTOR_BASE, add(ARRECTOR_BASE, [0, -0.02, -0.25]), [XF, -0.86, -0.85], [XF, -0.55, -1.32], [XF, ARRECTOR_TOP[1] - 0.15, -1.62], ARRECTOR_TOP];
{
  const pts = curvePoints(arrectorPath, 0.06);
  const fasc = [];
  const split = pts[Math.floor(pts.length * 0.72)];
  for (const dx of [-0.07, 0.07]) fasc.push(sdPolyTube(curvePoints([split, add(lerp(split, ARRECTOR_TOP, 0.5), [dx * 0.8, 0.02, 0.03]), add(ARRECTOR_TOP, [dx, -0.01, 0.06])], 0.05), Array.from({ length: 40 }, () => 0.022), 0.02, 0.5));
  const main = sdPolyTube(pts, pts.map((_, i) => 0.042 - 0.012 * (i / (pts.length - 1))), 0.03, 0.5);
  const f = union([main, ...fasc], 0.03);
  const [lo, hi] = bboxOf(Float32Array.from(pts.flat()));
  put('arrector-pili', 'block', 'appendages', surfaceNets(f, sub(lo, [0.15, 0.15, 0.15]), add(hi, [0.15, 0.15, 0.15]), 0.011, { smooth: 2, target: 4000 }),
    { modelled: 'Smooth-muscle bundle ~80 µm thick from the follicle bulge to the papillary dermis, on the obtuse-angle side; it fans into three slips at its upper end.' });
}
const SEB_OBST = { a: SEB_C, b: fAt(T_SEB), r: 0.32 };
const ARR_OBST = curvePoints(arrectorPath, 0.25).slice(1).map((p, i, a) => ({ a: i ? a[i - 1] : ARRECTOR_BASE, b: p, r: 0.1 }));

// ── Sweat glands ────────────────────────────────────────────────────────────
/** An open torus-knot coil (secretory coil + coiled duct), scaled until its strands clear each other. */
function coilPath(c, R, tubeR, seed, p = 3, q = 5) {
  let scale = 1, pts;
  const tilt = norm([0.3 * (hash2(seed, 1, 81) - 0.5), 1, 0.3 * (hash2(seed, 2, 81) - 0.5)]);
  for (let it = 0; it < 30; it++) {
    pts = [];
    const n = 220;
    for (let k = 0; k <= n * 0.94; k++) {
      const th = (k / n) * Math.PI * 2;
      const r = R * scale * (1 + 0.45 * Math.cos(q * th));
      let v = [r * Math.cos(p * th), R * scale * 0.55 * Math.sin(q * th), r * Math.sin(p * th)];
      v = add(v, mul([vnoise3(k * 0.07, 0, 0, seed) - 0.5, vnoise3(0, k * 0.07, 0, seed) - 0.5, vnoise3(0, 0, k * 0.07, seed) - 0.5], R * scale * 0.25));
      v = rotate(v, norm(cross(Y, tilt)) , Math.acos(clamp(dot(Y, tilt), -1, 1)) || 0);
      pts.push(add(c, v));
    }
    if (selfClearance(pts, 10) > 2.2 * tubeR) break;
    scale *= 1.07;
  }
  // End at the highest point, so the duct leaves upwards.
  let top = 0; pts.forEach((pp, i) => { if (pp[1] > pts[top][1]) top = i; });
  return [...pts.slice(top + 1), ...pts.slice(0, top + 1)];
}
const ECC_PARTS = [], DUCT_OBST = [], COIL_INFO = [];
for (const [gi, e] of ECCRINE.entries()) {
  const tubeR = 0.024;
  const coil = coilPath(e.coil, e.R, tubeR, 90 + gi);
  const start = coil.at(-1);
  const poreXZ = e.pore;
  const yPore = surfaceY(poreXZ[0], poreXZ[1]);
  const yDej = at('dej', poreXZ[0], poreXZ[1]);
  // Dermal duct: rises gently wavy to the bottom of the rete ridge under the pore.
  const rise = [start, add(start, [0, 0.12, 0])];
  const nSeg = 6;
  for (let k = 1; k <= nSeg; k++) {
    const t = k / nSeg;
    const xz = [mix(start[0], poreXZ[0], smoothstep(0, 1, t)), mix(start[2], poreXZ[1], smoothstep(0, 1, t))];
    rise.push([xz[0] + 0.03 * Math.sin(k * 2.1 + gi), mix(start[1] + 0.12, yDej - 0.01, t), xz[1] + 0.03 * Math.cos(k * 1.7 + gi)]);
  }
  // Intra-epidermal duct (acrosyringium): a helix through the epidermis to the pore.
  const helix = [];
  const turns = e.thick ? 4 : 1.2, hr = e.thick ? 0.03 : 0.012;
  const nH = Math.round(turns * 18);
  for (let k = 0; k <= nH; k++) {
    const t = k / nH, a = t * turns * Math.PI * 2;
    const rr = hr * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.002;
    helix.push([poreXZ[0] + rr * Math.cos(a), mix(yDej - 0.01, yPore + 0.004, t), poreXZ[1] + rr * Math.sin(a)]);
  }
  const ductPts = [...curvePoints(rise, 0.02), ...helix.slice(1)];
  ECC_PARTS.push(hollowTube(coil, tubeR, 0.01, { seg: 6, step: 0.035 }));
  ECC_PARTS.push(hollowTube(ductPts, (t) => mix(0.02, 0.017, t), (t) => mix(0.008, 0.009, t), { seg: 7, step: 0.03 }));
  for (let k = 1; k < ductPts.length; k += 6) DUCT_OBST.push({ a: ductPts[Math.max(0, k - 6)], b: ductPts[k], r: 0.07 });
  COIL_INFO.push({ id: e.id, centre: e.coil, radius: e.R * 1.6, pore: [poreXZ[0], yPore, poreXZ[1]], thick: e.thick });
}
put('eccrine-gland', 'block', 'appendages', merge(ECC_PARTS),
  { modelled: 'Four merocrine sweat glands (one thin-skin, three thick-skin; real density 100–600 per cm²): secretory coil ~0.3–0.4 mm in the deep dermis, a straight dermal duct to the tip of a rete ridge, and a spiral intra-epidermal duct (acrosyringium) to a pore — on a ridge crest in thick skin. Tubules hollow, ~50 µm across.' });
const COIL_OBST = COIL_INFO.map((c) => ({ a: c.centre, b: c.centre, r: c.radius + 0.08 }));
// Apocrine (axillary type): large coil at the dermis–hypodermis junction, duct into the follicle above the sebaceous duct.
const APO_C = [XF + 0.72, -2.25, -0.15];
{
  const coil = coilPath(APO_C, 0.2, 0.06, 133, 2, 5);
  const entry = add(fAt(T_APO), mul(xOut, 0.06));
  const start = coil.at(-1);
  const duct = curvePoints([start, add(start, [-0.05, 0.35, 0.05]), lerp(add(start, [0, 0.5, 0]), entry, 0.5), add(entry, [0.25, -0.15, 0]), add(entry, [0.1, -0.02, 0]), entry], 0.02);
  const obst = [...FOLLICLE_OBSTACLES.map((o) => ({ ...o, r: o.r - 0.04 })), SEB_OBST];
  const ductSafe = [...avoid(duct.slice(0, -8), obst), ...duct.slice(-8)];
  put('apocrine-gland', 'block', 'appendages', merge([hollowTube(coil, 0.06, 0.042, { seg: 11, step: 0.04 }), hollowTube(ductSafe, 0.03, 0.012, { seg: 8, step: 0.035 })]),
    { modelled: 'Apocrine gland of axillary type: a coil ~0.8 mm across of wide tubules (~120 µm, large lumen) at the dermis–hypodermis junction; its duct opens into the follicle infundibulum above the sebaceous duct.' });
  COIL_INFO.push({ id: 'apocrine', centre: APO_C, radius: 0.5, pore: entry, thick: false });
}
const APO_OBST = { a: APO_C, b: APO_C, r: 0.55 };

// ── Receptors ───────────────────────────────────────────────────────────────
const receptorAnchors = {};
const depthOf = (p) => r6(-p[1]);
// Meissner corpuscles in thick-skin papillae (several near the z = 0.4 section).
const meissnerPegs = THICK_PEGS.filter((p) => p.x > 0.95 && p.x < BX1 - 0.1 && p.z > BZ0 + 0.1 && p.z < BZ1 - 0.1 && p.a > 0.9);
const pickPegs = [];
for (const p of meissnerPegs) {
  const near = Math.abs(p.z - 0.4) < 0.025 && Math.abs(p.x - 1.62) > 0.08;
  if (pickPegs.length < 5 && near && pickPegs.every((q) => dist([q.x, 0, q.z], [p.x, 0, p.z]) > 0.2)) pickPegs.push(p);
}
for (const p of meissnerPegs) if (pickPegs.length < 12 && hash2(p.row, p.j, 99) < 0.06 && pickPegs.every((q) => dist([q.x, 0, q.z], [p.x, 0, p.z]) > 0.3)) pickPegs.push(p);
{
  const parts = [], centres = [];
  for (const [n, p] of pickPegs.entries()) {
    const top = at('dej', p.x, p.z);
    const c = [p.x, top - 0.072, p.z];
    const lam = [];
    for (let k = 0; k < 7; k++) {
      const t = k / 6 - 0.5;
      const w = 0.022 * Math.sqrt(1 - (2 * t) ** 2 * 0.75);
      const ang = k * 0.9 + n;
      const ax = [[Math.cos(ang), 0, Math.sin(ang)], Y, [-Math.sin(ang), 0, Math.cos(ang)]];
      lam.push(sdEllipsoid(add(c, [0.004 * Math.sin(k * 2.3), t * 0.085, 0.004 * Math.cos(k * 1.9)]), ax, [w * 1.15, 0.0085, w * 0.85]));
    }
    lam.push(sdCapsule(add(c, [0, -0.05, 0]), add(c, [0, 0.04, 0]), 0.012, 0.01));
    const f = union(lam, 0.007);
    parts.push(surfaceNets(f, sub(c, [0.05, 0.08, 0.05]), add(c, [0.05, 0.08, 0.05]), 0.0028, { smooth: 2, target: 500, maxError: 0.05 }));
    centres.push({ p: c.map(r6), depthMm: depthOf(c) });
  }
  put('meissner-corpuscle', 'block', 'receptors', merge(parts),
    { modelled: `${parts.length} encapsulated corpuscles ~45 × 95 µm in the dermal papillae of thick skin: stacked flattened lamellar (Schwann) cells with the axon winding between them, long axis perpendicular to the surface.` });
  receptorAnchors['meissner-corpuscle'] = centres;
}
// Merkel cell–neurite complexes: a row at the tip of a primary rete ridge (thick) and a touch dome beside the follicle (thin).
{
  const parts = [], centres = [];
  const addComplex = (x, z, tilt) => {
    const yb = at('dej', x, z);
    const cell = [x, yb + 0.012, z];
    parts.push(blob(cell, [[1, 0, 0], Y, [0, 0, 1]], [0.0085, 0.006, 0.0085], 8, 5));
    const disc = [x, yb + 0.0025, z];
    const ax = [[Math.cos(tilt), 0, Math.sin(tilt)], Y, [-Math.sin(tilt), 0, Math.cos(tilt)]];
    parts.push(blob(disc, ax, [0.012, 0.0028, 0.0095], 8, 4));
    centres.push({ p: cell.map(r6), depthMm: depthOf(cell) });
    return disc;
  };
  // Thick: along the primary rete ridge at k = 2 near z = 0.4.
  const rowDiscs = [];
  for (let k = 0; k < 8; k++) { const z = 0.08 + k * 0.085; rowDiscs.push(addComplex(RIDGE_X(2, z) + 0.004 * Math.sin(k * 3), z, k)); }
  parts.push(tube([...rowDiscs.map((d) => add(d, [0, -0.012, 0]))], 0.0045, { seg: 5, step: 0.02 }));
  for (const d of rowDiscs) parts.push(tube([add(d, [0, -0.012, 0]), add(d, [0, -0.004, 0])], 0.003, { seg: 4, step: 0.004 }));
  // Thin: touch dome next to the hair exit (on the acute side).
  const domeC = [XF + 0.12, 0, ZE + 0.24];
  const dome = [];
  for (let k = 0; k < 11; k++) { const a = k * 2.4, r = 0.03 + 0.055 * Math.sqrt(k / 10); dome.push(addComplex(domeC[0] + r * Math.cos(a), domeC[2] + r * Math.sin(a), a)); }
  const hub = [domeC[0], at('dej', domeC[0], domeC[2]) - 0.05, domeC[2]];
  for (const d of dome) parts.push(tube([hub, lerp(hub, d, 0.6), d], 0.003, { seg: 4, step: 0.01 }));
  put('merkel-discs', 'block', 'receptors', merge(parts),
    { modelled: 'Merkel cell–neurite complexes in the basal layer: a row at the tip of a primary rete ridge (thick skin) and a touch dome beside the hair (thin skin). Each: a Merkel cell over a disc-shaped Aβ terminal; drawn ×1.3 so they show at block scale.' });
  receptorAnchors['merkel-discs'] = centres;
  receptorAnchors['touch-dome'] = { p: hub.map(r6), depthMm: depthOf(hub) };
}
// Pacinian corpuscles in the hypodermis: nested lamellae (an onion) round a core with the axon.
const PAC = [
  { c: [XF + 0.02, -3.65, -0.95], axis: norm([0.05, -0.25, -1]), A: 0.52, B: 0.32, shells: 6 },
  { c: [1.95, -4.15, -0.45], axis: norm([1, -0.2, 0.25]), A: 0.42, B: 0.26, shells: 5 },
];
{
  const parts = [], centres = [];
  for (const P of PAC) {
    const base = sub(P.c, mul(P.axis, 0)); // lathe origin at the centre, t ∈ [−A, A]
    for (let k = 0; k < P.shells; k++) {
      const f0 = 1 - k / (P.shells + 0.6), f1 = f0 - 0.42 / (P.shells + 0.6);
      const Ao = P.A * (0.3 + 0.7 * f0), Bo = P.B * f0, Ai = P.A * (0.3 + 0.7 * f1), Bi = P.B * f1;
      const prof = [...halfEllipse(Ao, Bo, 11), ...halfEllipse(Ai, Bi, 9, true)];
      parts.push(lathe(base, P.axis, prof, 22));
    }
    // Inner core with the axon terminal.
    const coreA = P.A * 0.34, coreB = P.B * 0.13;
    parts.push(lathe(base, P.axis, halfEllipse(coreA, coreB, 11), 18));
    parts.push(tube([sub(P.c, mul(P.axis, P.A + 0.04)), sub(P.c, mul(P.axis, coreA * 0.6)), add(P.c, mul(P.axis, coreA * 0.85))], 0.011, { seg: 8, step: 0.03 }));
    centres.push({ p: P.c.map(r6), depthMm: depthOf(P.c), lengthMm: r6(2 * P.A), widthMm: r6(2 * P.B) });
  }
  put('pacinian-corpuscle', 'block', 'receptors', merge(parts),
    { modelled: 'Two lamellated corpuscles (~1.0 × 0.6 and 0.8 × 0.5 mm) in the subcutaneous fat: concentric lamellae (6 and 5 drawn; real corpuscles have 20–60) with fluid between them, round an inner core holding the unmyelinated axon terminal.' });
  receptorAnchors['pacinian-corpuscle'] = centres;
}
// Ruffini endings: spindle capsules in the reticular dermis, along the lines of tension.
const RUF = [{ c: [-0.75, -1.25, 0.75], axis: norm([1, 0.05, 0.45]) }, { c: [2.05, -2.15, 1.25], axis: norm([1, -0.05, -0.3]) }];
{
  const parts = [], centres = [];
  for (const [n, R] of RUF.entries()) {
    const Lr = 0.38;
    const prof = [[-Lr, 0], ...Array.from({ length: 13 }, (_, k) => { const t = -Lr + ((k + 1) / 14) * 2 * Lr; return [t, 0.042 * Math.pow(Math.max(0, 1 - (t / Lr) ** 2), 0.7)]; }), [Lr, 0]];
    parts.push(lathe(R.c, R.axis, prof, 16));
    // Collagen strands entering the poles and terminal branches poking out.
    for (const sgn of [-1, 1]) for (let k = 0; k < 3; k++) {
      const off = rotate(cross(R.axis, Y), R.axis, k * 2.1 + n);
      parts.push(tube([add(R.c, mul(R.axis, sgn * Lr * 0.8)), add(add(R.c, mul(R.axis, sgn * (Lr + 0.12))), mul(off, 0.03)), add(add(R.c, mul(R.axis, sgn * (Lr + 0.22))), mul(off, 0.05))], 0.006, { seg: 5, step: 0.03 }));
    }
    centres.push({ p: R.c.map(r6), depthMm: depthOf(R.c) });
  }
  put('ruffini-ending', 'block', 'receptors', merge(parts),
    { modelled: 'Two spindle-shaped Ruffini endings (~0.76 × 0.08 mm) in the reticular dermis, aligned with the collagen; branched terminals among the collagen fibres at each pole.' });
  receptorAnchors['ruffini-ending'] = centres;
}

// ── Nerve plexus layout (shared by the nerve, free endings and follicle plexus) ──
const SUBEP = (x, z) => at('pBot', x, z) + 0.07; // subepidermal nerve plexus level
const NERVE_OBST = [...FOLLICLE_OBSTACLES, SEB_OBST, ...ARR_OBST.map((o) => ({ ...o, r: 0.08 })), ...COIL_OBST, ...DUCT_OBST.map((o) => ({ ...o, r: 0.05 })), APO_OBST];
const line = (pts, step = 0.05) => avoid(curvePoints(pts, step), NERVE_OBST);
const thinPlexus = [line([[BX0 + 0.25, 0, -0.25], [-1.0, 0, -0.3], [0.25, 0, -0.2]].map(([x, , z]) => [x, SUBEP(x, z), z])), line([[-1.1, 0, BZ0 + 0.3], [-1.15, 0, 0], [-1.05, 0, BZ1 - 0.3]].map(([x, , z]) => [x, SUBEP(x, z), z])), line([[-2.5, 0, -1.5], [-2.45, 0, 0.2], [-2.55, 0, 1.6]].map(([x, , z]) => [x, SUBEP(x, z), z]))];
const thickPlexus = [line([[0.75, 0, 0.62], [1.8, 0, 0.6], [2.85, 0, 0.66]].map(([x, , z]) => [x, SUBEP(x, z), z])), line([[1.45, 0, BZ0 + 0.3], [1.5, 0, 0], [1.4, 0, BZ1 - 0.3]].map(([x, , z]) => [x, SUBEP(x, z), z])), line([[2.55, 0, -1.6], [2.5, 0, 0], [2.6, 0, 1.6]].map(([x, , z]) => [x, SUBEP(x, z), z]))];
const plexusPts = [...thinPlexus, ...thickPlexus].flat();
const nearestPlexus = (p, pool = plexusPts) => { let b = pool[0], bd = Infinity; for (const q of pool) { const d = dist(p, q); if (d < bd) { bd = d; b = q; } } return b; };

// Free nerve endings: thin fibres from the plexus up into the epidermis.
{
  const parts = [], tips = [];
  const starts = [];
  for (let k = 0; k < 34; k++) {
    const x = BX0 + 0.25 + (BX1 - BX0 - 0.5) * hash2(k, 1, 301), z = BZ0 + 0.25 + (BZ1 - BZ0 - 0.5) * hash2(k, 2, 301);
    if (FOLLICLE_OBSTACLES.some((o) => dist(closestOnSegment([x, -0.3, z], o.a, o.b).q, [x, -0.3, z]) < 0.25) && k % 2) continue;
    starts.push([x, z]);
  }
  for (const [n, [x, z]] of starts.entries()) {
    const base = nearestPlexus([x, SUBEP(x, z), z]);
    const yTopEp = at('g', x, z) - 0.004, yBas = at('dej', x, z);
    const entry = [x, yBas - 0.012, z];
    const pts = line([base, lerp(base, entry, 0.5), entry], 0.02);
    parts.push(tube(pts, 0.004, { seg: 4, step: 0.045 }));
    const nb = 2 + (n % 2);
    for (let b = 0; b < nb; b++) {
      const a = n * 1.7 + b * 2.3;
      const tx = x + 0.025 * Math.cos(a), tz = z + 0.025 * Math.sin(a);
      const tip = [tx, mix(at('bTop', tx, tz) + 0.004, at('g', tx, tz) - 0.003, 0.55 + 0.4 * hash2(n, b, 302)), tz];
      parts.push(tube([entry, [x + 0.008 * Math.cos(a), yBas + 0.01, z + 0.008 * Math.sin(a)], lerp(entry, tip, 0.6), tip], 0.0028, { seg: 4, step: 0.02 }));
      tips.push({ p: tip.map(r6), depthMm: depthOf(tip) });
    }
  }
  put('free-nerve-endings', 'block', 'receptors', merge(parts),
    { modelled: `${starts.length} thin (Aδ and C) fibres from the subepidermal plexus that lose their Schwann cells at the basement membrane and end among the keratinocytes up to the granular layer; drawn ~8 µm thick (real 0.5–2 µm) so they show.` });
  receptorAnchors['free-nerve-endings'] = tips;
}
// Follicle (peritrichial) plexus: circumferential fibres and a palisade of lanceolate endings at the bulge.
{
  const parts = [];
  const ring = (t, r) => { const pts = []; for (let k = 0; k <= 36; k++) { const a = (k / 36) * Math.PI * 2; pts.push(add(fAt(t), add(mul(xOut, r * Math.cos(a)), mul(cross(aF, xOut), r * Math.sin(a))))); } return pts; };
  parts.push(tube(ring(T_BULGE - 0.12, 0.14), 0.007, { seg: 5, step: 0.02 }));
  parts.push(tube(ring(T_BULGE + 0.22, 0.14), 0.006, { seg: 5, step: 0.02 }));
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const off = add(mul(xOut, Math.cos(a)), mul(cross(aF, xOut), Math.sin(a)));
    parts.push(tube([add(fAt(T_BULGE - 0.12), mul(off, 0.14)), add(fAt(T_BULGE + 0.05), mul(off, 0.128)), add(fAt(T_BULGE + 0.26), mul(off, 0.125))], 0.0045, { seg: 4, step: 0.03 }));
  }
  put('hair-follicle-plexus', 'block', 'receptors', merge(parts),
    { modelled: 'Lanceolate endings (palisade parallel to the follicle) and circumferential fibres around the follicle at the level of the bulge, below the sebaceous gland.' });
  receptorAnchors['hair-follicle-plexus'] = { p: fAt(T_BULGE).map(r6), depthMm: depthOf(fAt(T_BULGE)) };
}

// ── Vessels ─────────────────────────────────────────────────────────────────
const ART = linear('#c0272d'), VEN = linear('#3a56b0'), CAP = linear('#8a3c78');
const VESSEL_OBST = [...NERVE_OBST, ...PAC.map((p) => ({ a: sub(p.c, mul(p.axis, p.A * 0.6)), b: add(p.c, mul(p.axis, p.A * 0.6)), r: p.B + 0.08 })), ...RUF.map((r) => ({ a: sub(r.c, mul(r.axis, 0.35)), b: add(r.c, mul(r.axis, 0.35)), r: 0.09 }))];
const vline = (pts, step = 0.05) => avoid(curvePoints(pts, step), VESSEL_OBST);
/** A straight-ending line across the block: x-running or z-running at height f(x, z), wavy inside. */
function across(dir, c, yFn, wav, seed) {
  const pts = [];
  const [a0, a1] = dir === 'x' ? [BX0 - OUT, BX1 + OUT] : [BZ0 - OUT, BZ1 + OUT];
  const n = Math.ceil((a1 - a0) / 0.12);
  for (let k = 0; k <= n; k++) {
    const s = a0 + ((a1 - a0) * k) / n;
    const edge = Math.min(1, Math.min(s - a0, a1 - s) / 0.25);
    const off = wav * edge * (fbm2(s * 1.3, seed, seed) - 0.5) * 2;
    const x = dir === 'x' ? s : c + off, z = dir === 'x' ? c + off : s;
    pts.push([x, yFn(x, z), z]);
  }
  return pts;
}
const SUP = { art: [], ven: [] };
{
  const parts = [];
  const yA = (x, z) => at('pBot', x, z) + 0.05, yV = (x, z) => at('pBot', x, z) + 0.022;
  for (const [k, xc] of [-2.55, -1.35, -0.2, 0.95, 2.05, 2.8].entries()) {
    const a = vline(across('z', xc, yA, 0.12, 400 + k), 0.04), v = vline(across('z', xc + 0.17, yV, 0.12, 420 + k), 0.04);
    SUP.art.push(a); SUP.ven.push(v);
    parts.push(tube(a, 0.0105, { seg: 6, step: 0.07, color: () => ART }), tube(v, 0.0145, { seg: 6, step: 0.07, color: () => VEN }));
  }
  for (const [k, zc] of [-1.3, 0.05, 1.35].entries()) {
    const a = vline(across('x', zc, yA, 0.1, 440 + k), 0.04), v = vline(across('x', zc + 0.16, yV, 0.1, 460 + k), 0.04);
    SUP.art.push(a); SUP.ven.push(v);
    parts.push(tube(a, 0.0095, { seg: 6, step: 0.07, color: () => ART }), tube(v, 0.013, { seg: 6, step: 0.07, color: () => VEN }));
  }
  // Capillary loops in the papillae: up from an arteriole, a hairpin under the papilla tip, down to a venule.
  const artPts = SUP.art.flat(), venPts = SUP.ven.flat();
  const loopPegs = [
    ...THICK_PEGS.filter((p) => p.x > 0.9 && p.x < BX1 - 0.03 && p.z > BZ0 + 0.03 && p.z < BZ1 - 0.03 && (Math.abs(p.z - 0.4) < 0.3 || hash2(p.row, p.j, 501) < 0.16) && !pickPegs.includes(p)),
    ...THIN_PEGS.filter((p) => p.x > BX0 + 0.03 && p.x < 0.3 && p.z > BZ0 + 0.03 && p.z < BZ1 - 0.03 && (Math.abs(p.x - XF) < 0.14 || Math.abs(p.z - 0.4) < 0.1 || hash2(Math.round(p.x * 100), Math.round(p.z * 100), 502) < 0.05)),
  ].filter((p) => FOLLICLE_OBSTACLES.every((o) => dist(closestOnSegment([p.x, -0.1, p.z], o.a, o.b).q, [p.x, -0.1, p.z]) > 0.16));
  const loopPieces = [];
  for (const [n, p] of loopPegs.entries()) {
    const top = at('dej', p.x, p.z);
    const baseY = at('dej', p.x + p.r * 1.3, p.z) - 0.015;
    const A = nearestPlexus([p.x, top, p.z], artPts), V = nearestPlexus([p.x, top, p.z], venPts);
    const side = norm([-(V[2] - A[2]), 0, V[0] - A[0]]);
    const o = mul(side, 0.0065 * (n % 2 ? 1 : -1));
    const lp = [A, add([p.x, Math.min(baseY, top - 0.04), p.z], o), add([p.x, top - 0.026, p.z], o), [p.x, top - 0.017, p.z], add([p.x, top - 0.026, p.z], mul(o, -1)), add([p.x, Math.min(baseY, top - 0.04), p.z], mul(o, -1)), V];
    loopPieces.push(tube(lp, (t) => (t < 0.5 ? 0.0042 : 0.0052), { seg: 3, step: 0.075, color: (t) => (t < 0.42 ? ART : t < 0.5 ? lerp3(ART, CAP, (t - 0.42) / 0.08) : t < 0.58 ? lerp3(CAP, VEN, (t - 0.5) / 0.08) : VEN) }));
  }
  put('superficial-plexus', 'block', 'vessels', (log('capillary loops', loopPieces.length), merge([...parts, ...loopPieces])),
    { modelled: `Subpapillary (superficial) plexus at the papillary–reticular junction: arterioles (~20 µm, red) with paired, slightly deeper venules (~28 µm, blue); ${loopPieces.length} capillary loops (~9 µm) rise into the dermal papillae (shown in the papillae near the standard sections and a sample elsewhere).` });
}
const DEEP = { art: [], ven: [] };
{
  const parts = [];
  const yA = (x, z) => at('rBot', x, z) + 0.1, yV = (x, z) => at('rBot', x, z) + 0.04;
  for (const [k, xc] of [-2.3, -0.6, 1.0, 2.5].entries()) {
    const a = vline(across('z', xc, yA, 0.15, 600 + k), 0.06), v = vline(across('z', xc + 0.26, yV, 0.15, 620 + k), 0.06);
    DEEP.art.push(a); DEEP.ven.push(v);
    parts.push(tube(a, 0.032, { seg: 7, step: 0.1, color: () => ART }), tube(v, 0.045, { seg: 7, step: 0.1, color: () => VEN }));
  }
  for (const [k, zc] of [-0.75, 0.95].entries()) {
    const a = vline(across('x', zc, yA, 0.12, 640 + k), 0.06), v = vline(across('x', zc + 0.24, yV, 0.12, 660 + k), 0.06);
    DEEP.art.push(a); DEEP.ven.push(v);
    parts.push(tube(a, 0.028, { seg: 7, step: 0.1, color: () => ART }), tube(v, 0.04, { seg: 7, step: 0.1, color: () => VEN }));
  }
  const nearestOf = (p, lines) => nearestPlexus(p, lines.flat());
  // Communicating (candelabra) vessels between the plexuses.
  for (const [k, [x, z]] of [[-2.0, 1.4], [-0.3, -1.25], [0.6, 0.5], [1.9, -0.5], [2.6, 1.55], [-2.75, -0.7]].entries()) {
    const a0 = nearestOf([x, at('rBot', x, z), z], DEEP.art), a1 = nearestOf([x, at('pBot', x, z), z], SUP.art);
    const v0 = nearestOf([x + 0.15, at('rBot', x, z), z], DEEP.ven), v1 = nearestOf([x + 0.15, at('pBot', x, z), z], SUP.ven);
    const wig = (p, q, s) => vline([p, add(lerp(p, q, 0.35), [0.06 * Math.sin(s), 0, 0.05 * Math.cos(s)]), add(lerp(p, q, 0.7), [-0.05 * Math.sin(s), 0, 0.04]), q], 0.04);
    parts.push(tube(wig(a0, a1, k), 0.015, { seg: 6, step: 0.07, color: () => ART }), tube(wig(v0, v1, k + 1), 0.02, { seg: 6, step: 0.07, color: () => VEN }));
  }
  // Perforators from below the fascia.
  const pa0 = [0.15, -5.55 - OUT - 0.1, -0.15], pv0 = [0.32, -5.55 - OUT - 0.1, -0.05];
  const pa1 = nearestOf([0.0, at('rBot', 0, 0), 0], DEEP.art), pv1 = nearestOf([0.3, at('rBot', 0.3, 0), 0], DEEP.ven);
  parts.push(tube(vline([pa0, [0.1, -4.6, -0.1], [-0.05, -3.4, 0.1], pa1], 0.06), (t) => mix(0.05, 0.034, t), { seg: 10, step: 0.1, color: () => ART }));
  parts.push(tube(vline([pv0, [0.35, -4.6, 0.0], [0.25, -3.4, 0.15], pv1], 0.06), (t) => mix(0.068, 0.047, t), { seg: 10, step: 0.1, color: () => VEN }));
  // Branches: to the hair papilla, the sweat coils and into the fat lobules.
  const toBulb = nearestOf(BULB, DEEP.art);
  parts.push(tube([toBulb, lerp(toBulb, sub(BULB, mul(aF, 0.12)), 0.6), sub(BULB, mul(aF, 0.06)), fAt(0.03)], 0.011, { seg: 6, step: 0.03, color: () => ART }));
  for (const c of COIL_INFO) {
    const from = nearestOf(c.centre, DEEP.art), to = add(c.centre, mul(norm(sub(from, c.centre)), c.radius * 0.55));
    parts.push(tube([from, lerp(from, to, 0.5), to], 0.009, { seg: 6, step: 0.03, color: () => ART }));
  }
  for (let k = 0; k < 5; k++) {
    const x = -2.6 + k * 1.25, z = -1.6 + 3.2 * hash2(k, 3, 680);
    const from = nearestOf([x, at('rBot', x, z), z], DEEP.art);
    parts.push(tube(vline([from, add(from, [0.05, -0.4, 0.1]), add(from, [0.12, -0.9, -0.05])], 0.05), 0.012, { seg: 6, step: 0.05, color: () => ART }));
  }
  put('deep-plexus', 'block', 'vessels', merge(parts),
    { modelled: 'Deep (cutaneous) plexus at the dermis–hypodermis junction: arterioles ~60 µm and venules ~90 µm; communicating (candelabra) vessels up to the superficial plexus; a perforating artery and vein through the deep fascia; branches to the hair papilla, the sweat-gland coils and the fat lobules.' });
}
{
  // Lymphatics: blind initial vessels in the papillary dermis → superficial lymphatic plexus beneath the
  // venous plexus → valved collectors through the dermis → deep plexus → a collector beside the perforator.
  const parts = [];
  const LY = linear('#93cf7b');
  const yS = (x, z) => at('pBot', x, z) - 0.025, yD = (x, z) => at('rBot', x, z) + 0.17;
  const sup = [], deep = [];
  for (const [k, xc] of [-1.95, -0.75, 0.55, 1.75].entries()) { const l = vline(across('z', xc, yS, 0.1, 700 + k), 0.05); sup.push(l); parts.push(tube(l, 0.017, { seg: 6, step: 0.08 })); }
  for (const [k, xc] of [-1.5, 1.6].entries()) { const l = vline(across('z', xc, yD, 0.12, 720 + k), 0.06); deep.push(l); parts.push(tube(l, (t) => 0.03 * (1 + 0.22 * Math.sin(t * 60)), { seg: 8, step: 0.05 })); }
  // Initial lymphatics (blind ends under the papillae).
  for (let k = 0; k < 22; k++) {
    const x = BX0 + 0.3 + (BX1 - BX0 - 0.6) * hash2(k, 7, 740), z = BZ0 + 0.3 + (BZ1 - BZ0 - 0.6) * hash2(k, 8, 740);
    // Start in the papillary dermis below the deepest rete ridge nearby, so the vessel stays in tissue.
    let dmin = Infinity; for (let a = 0; a < 8; a++) dmin = Math.min(dmin, at('dej', x + 0.25 * Math.cos(a * 0.785), z + 0.25 * Math.sin(a * 0.785)), at('dej', x, z));
    const start = [x, Math.max(at('pBot', x, z) + 0.06, dmin - 0.05), z];
    const to = nearestPlexus(start, sup.flat());
    parts.push(tube(vline([start, add(lerp(start, to, 0.5), [0.03, 0, 0.02]), to], 0.03), (t) => mix(0.013, 0.016, t), { seg: 5, step: 0.05 }));
  }
  // Collectors with valves (beaded).
  for (const [k, [x, z]] of [[-1.9, -1.1], [0.5, 1.2], [1.7, -0.9]].entries()) {
    const a = nearestPlexus([x, yS(x, z), z], sup.flat()), b = nearestPlexus([x, yD(x, z), z], deep.flat());
    parts.push(tube(vline([a, add(lerp(a, b, 0.5), [0.06 * (k - 1), 0, 0.05]), b], 0.04), (t) => 0.022 * (1 + 0.28 * Math.max(0, Math.sin(t * 40))), { seg: 8, step: 0.025 }));
  }
  const dc = nearestPlexus([0.5, yD(0.5, 0), 0], deep.flat());
  parts.push(tube(vline([dc, [0.5, -3.6, 0.25], [0.45, -4.8, 0.1], [0.5, -5.55 - OUT - 0.1, 0.05]], 0.06), (t) => 0.034 * (1 + 0.25 * Math.max(0, Math.sin(t * 50))), { seg: 9, step: 0.04 }));
  void LY;
  put('lymphatic-vessels', 'block', 'vessels', merge(parts),
    { modelled: 'Blind-ended initial lymphatics in the papillary dermis drain to a superficial lymphatic plexus below the venous plexus; valved (beaded) collectors run down through the dermis to a deep plexus and out beside the perforating vessels.' });
}

// ── Cutaneous nerve ─────────────────────────────────────────────────────────
{
  const parts = [];
  const trunk = avoid(curvePoints([[BX0 - OUT, -4.12, 0.95], [-1.3, -4.3, 1.08], [0.4, -4.42, 1.2], [BX1 + OUT, -4.6, 1.42]], 0.06), VESSEL_OBST.filter((o) => o !== undefined));
  parts.push(tube(trunk, 0.072, { seg: 12, step: 0.09 }));
  const fromTrunk = (p) => nearestPlexus(p, trunk);
  // Ascending branches to the subepidermal plexus, thin and thick side.
  for (const [x, z, pl] of [[-2.0, 0.6, thinPlexus], [-0.6, 1.0, thinPlexus], [1.55, 0.85, thickPlexus], [2.55, 1.1, thickPlexus]]) {
    const a = fromTrunk([x, -4.3, z]);
    const top = nearestPlexus([x, SUBEP(x, z), z], pl.flat());
    const mid = [x + 0.1, at('rBot', x, z) + 0.05, z - 0.1];
    parts.push(tube(line([a, lerp(a, mid, 0.5), mid, lerp(mid, top, 0.5), top], 0.05), (t) => mix(0.034, 0.02, t), { seg: 7, step: 0.07 }));
  }
  for (const pl of [...thinPlexus, ...thickPlexus]) parts.push(tube(pl, 0.016, { seg: 6, step: 0.07 }));
  // Pacinian afferents.
  for (const P of PAC) { const pole = sub(P.c, mul(P.axis, P.A + 0.04)); const a = fromTrunk(pole); parts.push(tube(line([a, lerp(a, pole, 0.5), pole], 0.05), 0.02, { seg: 8, step: 0.04 })); }
  // Meissner and Merkel afferents from the thick plexus.
  for (const m of receptorAnchors['meissner-corpuscle']) { const b = add(m.p, [0, -0.055, 0]); const a = nearestPlexus(b, thickPlexus.flat()); parts.push(tube(line([a, lerp(a, b, 0.5), b], 0.03), 0.0055, { seg: 5, step: 0.03 })); }
  {
    const m = receptorAnchors['merkel-discs'][0];
    const b = add(m.p, [0, -0.04, 0]); const a = nearestPlexus(b, thickPlexus.flat());
    parts.push(tube(line([a, lerp(a, b, 0.5), b], 0.03), 0.0055, { seg: 5, step: 0.03 }));
    const hub = receptorAnchors['touch-dome'].p; const a2 = nearestPlexus(hub, thinPlexus.flat());
    parts.push(tube(line([a2, lerp(a2, hub, 0.5), hub], 0.03), 0.006, { seg: 5, step: 0.03 }));
  }
  // Ruffini, follicle plexus and autonomic fibres to the arrector pili and glands.
  for (const R of RUF) { const pole = sub(R.c, mul(R.axis, 0.38)); const a = nearestPlexus(pole); parts.push(tube(line([a, lerp(a, pole, 0.5), pole], 0.04), 0.008, { seg: 5, step: 0.04 })); }
  { const t = add(fAt(T_BULGE - 0.12), mul(xOut, 0.14)); const a = nearestPlexus(t, thinPlexus.flat()); parts.push(tube([a, lerp(a, t, 0.5), t], 0.009, { seg: 6, step: 0.03 })); }
  { const t = curvePoints(arrectorPath, 0.05)[12]; const a = nearestPlexus(t); parts.push(tube([a, lerp(a, add(t, mul(xOut, 0.06)), 0.5), add(t, mul(xOut, 0.03))], 0.005, { seg: 5, step: 0.03 })); }
  for (const c of COIL_INFO) { const to = add(c.centre, [0.04, c.radius * 0.45, 0.03]); const a = nearestPlexus(to); parts.push(tube(line([a, lerp(a, to, 0.5), to], 0.04), 0.006, { seg: 5, step: 0.04 })); }
  put('cutaneous-nerve', 'block', 'nerves', merge(parts),
    { modelled: 'A cutaneous nerve (~145 µm) in the subcutaneous fat; ascending branches form the subepidermal plexus and supply the Meissner, Merkel, Ruffini and Pacinian endings and the follicle plexus; fine sympathetic fibres reach the arrector pili and the sweat glands.' });
}

// ── Collagen bundles (reticular dermis) ─────────────────────────────────────
{
  const parts = [];
  const obst = [...VESSEL_OBST, ...PAC.map((p) => ({ a: p.c, b: p.c, r: p.A + 0.05 }))];
  let n = 0;
  const yAtF = (f) => (x, z) => mix(at('pBot', x, z) - 0.06, at('rBot', x, z) + 0.08, f);
  for (const [li, f] of [0.12, 0.32, 0.52, 0.72, 0.9].entries()) for (let k = 0; k < 5; k++) {
    const zc = BZ0 + 0.3 + (k + 0.5 * hash2(k, li, 801)) * 0.72;
    const pts = across('x', zc, (x, z) => yAtF(f)(x, z) + 0.05 * (vnoise3(x * 2, z, li, 802) - 0.5), 0.12, 810 + li * 10 + k);
    parts.push(tube(avoid(pts, obst), 0.021 + 0.008 * hash2(k, li, 803), { seg: 5, step: 0.22 })); n++;
  }
  for (const [li, f] of [0.22, 0.42, 0.62, 0.82].entries()) for (let k = 0; k < 6; k++) {
    const xc = BX0 + 0.35 + (k + 0.5 * hash2(k, li, 821)) * 0.95;
    const pts = across('z', xc, (x, z) => yAtF(f)(x, z) + 0.05 * (vnoise3(x, z * 2, li, 822) - 0.5), 0.15, 830 + li * 10 + k);
    parts.push(tube(avoid(pts, obst), 0.021 + 0.008 * hash2(k, li, 823), { seg: 5, step: 0.22 })); n++;
  }
  put('collagen-bundles', 'block', 'dermis', merge(parts),
    { modelled: `${n} representative type I collagen bundles (~45–60 µm) interwoven in layers roughly parallel to the surface (real bundles are far more numerous; the reticular dermis texture shows the rest).` });
}

// ── Instanced cells ─────────────────────────────────────────────────────────
function cellProto(kind) {
  const parts = [];
  if (kind === 'melanocyte') {
    parts.push(blob([0, 0, 0], [[1, 0, 0], Y, [0, 0, 1]], [0.0048, 0.0036, 0.0048], 7, 5));
    for (let k = 0; k < 4; k++) { const a = k * 1.57 + 0.3; parts.push(tube([[0, 0.001, 0], [0.006 * Math.cos(a), 0.008, 0.006 * Math.sin(a)], [0.013 * Math.cos(a), 0.02, 0.013 * Math.sin(a)]], (t) => 0.0016 * (1 - 0.7 * t), { seg: 3, step: 0.008 })); }
  } else {
    parts.push(blob([0, 0, 0], [[1, 0, 0], Y, [0, 0, 1]], [0.0055, 0.004, 0.0055], 7, 5));
    for (let k = 0; k < 6; k++) { const a = k * 1.05; const up = 0.004 * Math.sin(k * 2.1); parts.push(tube([[0, 0, 0], [0.01 * Math.cos(a), up, 0.01 * Math.sin(a)], [0.022 * Math.cos(a + 0.2), up * 2, 0.022 * Math.sin(a + 0.2)]], (t) => 0.0017 * (1 - 0.7 * t), { seg: 3, step: 0.01 })); }
  }
  const m = merge(parts);
  return { positions: m.positions, indices: m.indices };
}
function scatter(kind, densThin, densThick, seed) {
  const out = [];
  let k = 0;
  const area = (BX1 - BX0) * (BZ1 - BZ0);
  const nMax = Math.round(area * Math.max(densThin, densThick));
  for (let i = 0; i < nMax; i++) {
    const x = BX0 + 0.01 + (BX1 - BX0 - 0.02) * hash2(i, 1, seed), z = BZ0 + 0.01 + (BZ1 - BZ0 - 0.02) * hash2(i, 2, seed);
    const dens = mix(densThin, densThick, W(x));
    if (hash2(i, 3, seed) > dens / Math.max(densThin, densThick)) continue;
    if (FOLLICLE_OBSTACLES.some((o) => dist(closestOnSegment([x, at('dej', x, z), z], o.a, o.b).q, [x, at('dej', x, z), z]) < 0.12)) continue;
    let y;
    if (kind === 'melanocyte') y = at('dej', x, z) + 0.004;
    else { const lo = at('bTop', x, z), hi = at('g', x, z); y = mix(lo, hi, 0.3 + 0.45 * hash2(i, 4, seed)); }
    const yaw = hash2(i, 5, seed) * Math.PI * 2;
    const s = 0.85 + 0.35 * hash2(i, 6, seed);
    out.push({ t: [x, y, z], q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], s: [s, s, s] });
    k++;
  }
  return out;
}
{
  const mel = scatter('melanocyte', 160, 80, 901);
  put('melanocytes', 'block', 'epidermis', cellProto('melanocyte'), { modelled: `Dendritic pigment cells on the basement membrane, dendrites reaching up between keratinocytes; ${mel.length} instances (about 1 in 7 of the real ~1,000–1,500 per mm²; fewer on palms).` }, { instances: mel });
  const lan = scatter('langerhans', 70, 70, 902);
  put('langerhans-cells', 'block', 'epidermis', cellProto('langerhans'), { modelled: `Dendritic antigen-presenting cells in the spinous layer, dendrites spread between keratinocytes; ${lan.length} instances (about 1 in 7 of the real ~460–1,000 per mm²).` }, { instances: lan });
}

// ═══════════════════════════════════════════════════════════════════════════
// Checks (histological depths)
// ═══════════════════════════════════════════════════════════════════════════
const between = (p, upperName, lowerName) => p[1] < at(upperName, p[0], p[2]) && p[1] > at(lowerName, p[0], p[2]);
const checks = {
  meissnerInPapillae: receptorAnchors['meissner-corpuscle'].every((m) => m.p[1] < at('dej', m.p[0], m.p[2]) && m.p[1] > at('pBot', m.p[0], m.p[2])),
  meissnerInThickSkin: receptorAnchors['meissner-corpuscle'].every((m) => m.p[0] > XT),
  merkelAtBasalLayer: receptorAnchors['merkel-discs'].every((m) => Math.abs(m.p[1] - at('dej', m.p[0], m.p[2])) < 0.03),
  pacinianInHypodermis: PAC.every((P) => between(P.c, 'rBot', 'fTop') && between(add(P.c, mul(P.axis, P.A)), 'rBot', 'fTop') && between(sub(P.c, mul(P.axis, P.A)), 'rBot', 'fTop')),
  ruffiniInReticularDermis: RUF.every((R) => between(R.c, 'pBot', 'rBot')),
  freeEndingsInEpidermis: receptorAnchors['free-nerve-endings'].every((f) => f.p[1] > at('dej', f.p[0], f.p[2]) && f.p[1] < at('g', f.p[0], f.p[2]) + 0.001),
  arrectorInsertsInPapillaryDermis: between(ARRECTOR_TOP, 'dej', 'pBot'),
  arrectorOnObtuseSide: ARRECTOR_TOP[2] < hairExit[2],
  sebaceousAboveArrectorBase: SEB_C[1] > ARRECTOR_BASE[1],
  bulbAtDermisHypodermisJunction: Math.abs(fAt(0.2)[1] - at('rBot', fAt(0.2)[0], fAt(0.2)[2])) < 0.6,
  eccrineCoilsDeep: COIL_INFO.filter((c) => c.id !== 'apocrine').every((c) => c.centre[1] < at('pBot', c.centre[0], c.centre[2]) - 0.6 && c.centre[1] > at('fTop', c.centre[0], c.centre[2])),
  thickPoresOnRidgeCrests: ECCRINE.filter((e) => e.thick).every((e) => Math.abs(ridgeFrac(e.pore[0], e.pore[1])) < 0.05),
  lucidumOnlyThick: meshes.get('stratum-lucidum').positions.every((v, i) => i % 3 !== 0 || v >= 0.449),
  epidermisThinSkin: Math.abs(-at('dej', -2.2, 1.0) - 0.105) < 0.06,
  epidermisThickSkin: -at('dej', 2.0, 0.0) > 0.55 && -at('dej', 2.0, 0.0) < 1.1,
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
if (failed.length) throw new Error(`Histology checks failed: ${failed.join(', ')}`);

// ═══════════════════════════════════════════════════════════════════════════
// Output
// ═══════════════════════════════════════════════════════════════════════════
const ORDER = ['body-skin', 'scalp-hair', 'pubic-hair',
  'stratum-corneum', 'stratum-lucidum', 'stratum-granulosum', 'stratum-spinosum', 'stratum-basale', 'melanocytes', 'langerhans-cells',
  'papillary-dermis', 'reticular-dermis', 'collagen-bundles',
  'subcutaneous-fat', 'fibrous-septa', 'deep-fascia',
  'hair-shaft', 'inner-root-sheath', 'hair-follicle', 'hair-bulb', 'hair-papilla', 'arrector-pili', 'sebaceous-gland', 'eccrine-gland', 'apocrine-gland',
  'meissner-corpuscle', 'merkel-discs', 'pacinian-corpuscle', 'ruffini-ending', 'free-nerve-endings', 'hair-follicle-plexus',
  'superficial-plexus', 'deep-plexus', 'lymphatic-vessels', 'cutaneous-nerve'];
if (ORDER.length !== meshes.size || ORDER.some((id) => !meshes.has(id))) throw new Error(`mesh set mismatch: ${[...meshes.keys()].filter((k) => !ORDER.includes(k))} / ${ORDER.filter((k) => !meshes.has(k))}`);

const doc = new Document();
const buffer = doc.createBuffer();
const inst = doc.createExtension(EXTMeshGPUInstancing).setRequired(true);
const scenes = { body: doc.createScene('body'), block: doc.createScene('block') };
doc.getRoot().setDefaultScene(scenes.block);
const geometry = {};
let triangles = 0;
const acc = (type, array, normalized = false) => doc.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer);
for (const id of ORDER) {
  const m = meshes.get(id);
  const positions = m.positions;
  const normals = m.normals ?? smoothNormals(positions, m.indices);
  for (let i = 0; i < normals.length; i += 3) { const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]); if (l > 0) { normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l; } else normals[i + 1] = 1; }
  const nV = positions.length / 3;
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', positions))
    .setAttribute('NORMAL', acc('VEC3', normals))
    .setIndices(acc('SCALAR', nV < 65536 ? Uint16Array.from(m.indices) : Uint32Array.from(m.indices)));
  if (m.colors) {
    const c = new Uint8Array(nV * 4);
    for (let i = 0; i < nV; i++) { c[i * 4] = Math.round(clamp(m.colors[i * 3], 0, 1) * 255); c[i * 4 + 1] = Math.round(clamp(m.colors[i * 3 + 1], 0, 1) * 255); c[i * 4 + 2] = Math.round(clamp(m.colors[i * 3 + 2], 0, 1) * 255); c[i * 4 + 3] = 255; }
    prim.setAttribute('COLOR_0', acc('VEC4', c, true));
  }
  if (id === 'body-skin') {
    prim.setAttribute('_REGION', acc('SCALAR', bodyInfo.region));
    prim.setAttribute('_DERMATOME', acc('SCALAR', bodyInfo.derm));
  }
  const node = doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)).setExtras({ scene: m.scene, layer: m.layer, source: sources[id].bp3d ? 'bodyparts3d' : 'modelled' });
  // Bounds in the scene's own units (body: metres; block: millimetres), over all instances.
  let pts = positions;
  if (m.instances) {
    node.setExtension('EXT_mesh_gpu_instancing', inst.createInstancedMesh()
      .setAttribute('TRANSLATION', acc('VEC3', Float32Array.from(m.instances.flatMap((q) => q.t))))
      .setAttribute('ROTATION', acc('VEC4', Float32Array.from(m.instances.flatMap((q) => q.q))))
      .setAttribute('SCALE', acc('VEC3', Float32Array.from(m.instances.flatMap((q) => q.s)))));
    pts = Float32Array.from(m.instances.flatMap((q) => q.t));
  }
  const [lo, hi] = bboxOf(pts);
  const c = centroid(pts);
  let nearest = 0, nd = Infinity;
  for (let i = 0; i < pts.length; i += 3) { const d = Math.hypot(pts[i] - c[0], pts[i + 1] - c[1], pts[i + 2] - c[2]); if (d < nd) { nd = d; nearest = i; } }
  geometry[id] = {
    scene: m.scene, layer: m.layer,
    bounds: [lo.map(r6), hi.map(r6)], centroid: c.map(r6),
    surfaceAnchor: [pts[nearest], pts[nearest + 1], pts[nearest + 2]].map(r6),
    vertexCount: nV, triangleCount: m.indices.length / 3,
    ...(m.instances ? { instances: m.instances.length } : {}),
  };
  triangles += m.indices.length / 3;
  scenes[m.scene].addChild(node);
}
doc.getRoot().getAsset().generator = 'skin-anatomy-lab tools/make-skin.mjs';
doc.getRoot().getAsset().copyright = 'Body surface and hair: BodyParts3D (DBCLS), CC BY 4.0. Skin block modelled for this lab.';
const outGlb = path.join(root, 'public/models/skin.glb');
fs.mkdirSync(path.dirname(outGlb), { recursive: true });
const glb = await new NodeIO().registerExtensions([EXTMeshGPUInstancing]).writeBinary(doc);
fs.writeFileSync(outGlb, glb);

// ── Anchors ─────────────────────────────────────────────────────────────────
const P3 = (p) => p.map(r6);
const sample = (x, z) => ({
  'epidermis-top': r6(at('s', x, z)), 'corneum-bottom': r6(at('c', x, z)), 'granulosum-top': r6(at('l', x, z)), 'spinosum-top': r6(at('g', x, z)),
  'basale-top': r6(at('bTop', x, z)), 'dermal-junction': r6(at('dej', x, z)), 'papillary-bottom': r6(at('pBot', x, z)), 'dermis-hypodermis': r6(at('rBot', x, z)), fascia: r6(at('fTop', x, z)), 'fascia-bottom': r6(at('fBot', x, z)),
});
const THIN_SITE = [-2.3, 1.0], THICK_SITE = [2.0, -0.3];
const thinS = sample(...THIN_SITE), thickS = sample(...THICK_SITE);
const meanDej = (x0, x1) => { let s = 0, n = 0; for (let x = x0; x <= x1; x += 0.05) for (let z = -1.8; z <= 1.8; z += 0.05) { s += at('dej', x, z); n++; } return s / n; };
const anchors = {
  'block-bounds-mm': [[BX0, r6(Math.min(...IF.fBot)), BZ0], [BX1, r6(Math.max(...IF.s)), BZ1]],
  'thick-thin-boundary': { x: XT, transition: [0.35, 0.85], line: [[XT, 0, BZ0], [XT, 0, BZ1]] },
  'thin-site': [THIN_SITE[0], 0, THIN_SITE[1]], 'thick-site': [THICK_SITE[0], 0, THICK_SITE[1]],
  'depth-epidermis-top': { thin: thinS['epidermis-top'], thick: thickS['epidermis-top'] },
  'depth-dermal-junction': { thin: r6(meanDej(-2.8, -0.2)), thick: r6(meanDej(1.0, 2.8)) },
  'depth-dermis-hypodermis': { thin: thinS['dermis-hypodermis'], thick: thickS['dermis-hypodermis'] },
  'depth-fascia': { thin: thinS.fascia, thick: thickS.fascia },
  'layer-heights': { thin: thinS, thick: thickS },
  'layer-thickness-mm': {
    thin: { corneum: TH.thin.corneum, lucidum: 0, granulosum: TH.thin.granulosum, basale: TH.thin.basale, epidermis: r6(-meanDej(-2.8, -0.2)), papillaryDermis: r6(thinS['dermal-junction'] - thinS['papillary-bottom']), dermis: r6(-meanDej(-2.8, -0.2) * 0 + (meanDej(-2.8, -0.2) - thinS['dermis-hypodermis'])), hypodermis: r6(thinS['dermis-hypodermis'] - thinS.fascia), fascia: TH.fasciaThickness },
    thick: { corneum: TH.thick.corneum, lucidum: TH.thick.lucidum, granulosum: TH.thick.granulosum, basale: TH.thick.basale, epidermis: r6(-meanDej(1.0, 2.8)), papillaryDermis: r6(meanDej(1.0, 2.8) - thickS['papillary-bottom']), dermis: r6(meanDej(1.0, 2.8) - thickS['dermis-hypodermis']), hypodermis: r6(thickS['dermis-hypodermis'] - thickS.fascia), fascia: TH.fasciaThickness },
  },
  receptors: receptorAnchors,
  'sweat-pore': COIL_INFO.filter((c) => c.id !== 'apocrine').map((c) => ({ gland: c.id, p: P3(c.pore), thick: c.thick })),
  'sweat-coils': COIL_INFO.map((c) => ({ gland: c.id, p: P3(c.centre), depthMm: depthOf(c.centre) })),
  'hair-exit': P3(hairExit),
  'follicle-bulb': P3(fAt(0.18)),
  'follicle-axis': [P3(BULB), P3(hairExit)],
  'follicle-angle-deg': r6((FOLLICLE_ANGLE * 180) / Math.PI),
  'sebaceous-gland': P3(SEB_C),
  'apocrine-opening': P3(COIL_INFO.find((c) => c.id === 'apocrine').pore),
  'arrector-insertion': P3(ARRECTOR_TOP),
  'arrector-origin': P3(ARRECTOR_BASE),
  'superficial-plexus-lines': { arterioles: SUP.art.map((l) => curvePoints(l, 0.25).map(P3)), venules: SUP.ven.map((l) => curvePoints(l, 0.25).map(P3)) },
  'deep-plexus-lines': { arteries: DEEP.art.map((l) => curvePoints(l, 0.3).map(P3)), veins: DEEP.ven.map((l) => curvePoints(l, 0.3).map(P3)) },
  'standard-sections': { 'thin-follicle': { axis: 'x', at: XF }, 'thick-gland': { axis: 'z', at: 0.4 } },
  'body-regions': { attribute: '_REGION', regions: bodyInfo.regions },
  dermatomes: { attribute: '_DERMATOME', levels: DERMATOMES, trigeminal: TRIGEMINAL, areaPercent: bodyInfo.dermatomeAreas, method: 'classified from vertex position; see tools/make-skin.mjs classifyBody' },
  'body-landmarks-m': bodyInfo.landmarks,
};
const genDir = path.join(root, 'src/skin/generated');
fs.mkdirSync(genDir, { recursive: true });
fs.writeFileSync(path.join(genDir, 'geometry.json'), JSON.stringify({
  units: { body: 'metres', block: 'millimetres' },
  frames: {
    body: 'BodyParts3D: +x patient’s left, +y up, +z anterior; origin between the feet at floor level',
    block: '1 unit = 1 mm; origin at the centre of the skin surface; +y out of the skin; x from thin (−x) to thick (+x) skin; z across',
  },
  structures: geometry, anchors,
}, null, 2) + '\n');

// ── Provenance ──────────────────────────────────────────────────────────────
const dims = {
  thinEpidermisMm: { model: anchors['layer-thickness-mm'].thin.epidermis, expected: '0.07–0.12 mm (thin, hairy skin)', sources: ['ross-8', 'openstax-ch5'] },
  thickEpidermisMm: { model: anchors['layer-thickness-mm'].thick.epidermis, expected: '0.6–1.5 mm (palms, soles; 5 strata)', sources: ['ross-8', 'openstax-ch5'] },
  corneumMm: { model: [TH.thin.corneum, TH.thick.corneum], expected: 'thin skin 10–20 µm; palm 0.2–0.6 mm', sources: ['ross-8'] },
  lucidumMm: { model: TH.thick.lucidum, expected: 'thick skin only, 20–40 µm', sources: ['ross-8', 'openstax-ch5'] },
  basaleMm: { model: [TH.thin.basale, TH.thick.basale], expected: 'one cell, ~10–15 µm', sources: ['ross-8'] },
  dermisMm: { model: [anchors['layer-thickness-mm'].thin.dermis, anchors['layer-thickness-mm'].thick.dermis], expected: '1–3 mm (thicker on palms and back)', sources: ['ross-8', 'openstax-ch5'] },
  hypodermisMm: { model: [anchors['layer-thickness-mm'].thin.hypodermis, anchors['layer-thickness-mm'].thick.hypodermis], expected: 'very variable (mm to cm); cut to fit the block', sources: ['openstax-ch5'] },
  frictionRidgeSpacingMm: { model: RP, expected: '~0.4–0.5 mm', sources: ['ross-8'] },
  hairShaftDiameterUm: { model: SHAFT_R * 2000, expected: 'terminal hair 50–100 µm', sources: ['ross-8'] },
  follicleAngleDeg: { model: r6((FOLLICLE_ANGLE * 180) / Math.PI), expected: '~30–60° to the surface', sources: ['ross-8'] },
  meissnerSizeUm: { model: '~45 × 95', expected: '30–80 × 80–150 µm, in dermal papillae of glabrous skin', sources: ['ross-8', 'kandel-6'] },
  pacinianSizeMm: { model: PAC.map((p) => `${(2 * p.A).toFixed(2)} × ${(2 * p.B).toFixed(2)}`).join('; '), expected: '~1 × 0.6 mm (up to 4 mm), 20–60 lamellae, deep dermis/hypodermis', sources: ['ross-8', 'kandel-6'] },
  ruffiniLengthMm: { model: 0.76, expected: '0.5–2 mm spindles in the dermis', sources: ['kandel-6'] },
  eccrineCoilMm: { model: '~0.3–0.4', expected: 'coil 0.3–0.5 mm, deep dermis', sources: ['ross-8'] },
  capillaryLoopUm: { model: '~9 (arterial limb 8, venous 10)', expected: '5–10 µm; one loop per papilla', sources: ['ross-8'] },
  exaggerations: { model: 'free nerve fibres drawn 8 µm (real 0.5–2 µm); Merkel complexes ×1.3; follicle-plexus fibres 9–14 µm; cells at 1/7 density; 4 eccrine glands; 2 Pacinian corpuscles with 5–6 lamellae', expected: 'for visibility at block scale', sources: [] },
};
const commit = (dir) => { try { return execFileSync('git', ['-C', path.resolve(dir, '../..'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } };
fs.writeFileSync(path.join(genDir, 'provenance.json'), JSON.stringify({
  output: { file: 'public/models/skin.glb', bytes: glb.byteLength, sha256: sha256(glb), triangles, sourceTriangles },
  sources: {
    bodyparts3d: {
      name: 'BodyParts3D 4.0 (Database Center for Life Science), via the Human Atlas build', license: 'CC-BY-4.0',
      intermediate: 'github.com/Niyaz-05/human-atlas, commit ' + commit(humanDir),
      atlasJsonSha256: sha256(human.bytes), chunkSha256: human.hashes, parts: bp3dParts,
    },
  },
  frames: {
    body: 'BodyParts3D metres, unchanged (+x patient’s left, +y up, +z anterior).',
    block: 'Modelled at 1 unit = 1 mm; origin at the centre of the skin surface; +y outwards; thin skin at −x, thick skin at +x (boundary x = 0.6, blended over 0.35–0.85).',
  },
  bodyLabels: { regions: bodyInfo.regions, dermatomeAreaPercent: bodyInfo.dermatomeAreas, landmarks: bodyInfo.landmarks, totalAreaM2: bodyInfo.totalAreaM2 },
  dimensions: dims,
  histologyChecks: checks,
  changesHere: 'BodyParts3D: welded the skin, hair of head and pubic hair; simplified the skin to ~28,000 triangles; added per-vertex region and dermatome labels. The skin block and everything in it are modelled in code (tools/make-skin.mjs, tools/skin-geo.mjs) from the dimensions listed here.',
}, null, 2) + '\n');
fs.mkdirSync(path.join(root, 'src/skin/source'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/skin/source/structures.source.json'), JSON.stringify({
  $comment: 'Skin structures and where their geometry comes from. bp3d: BodyParts3D 4.0 part ids (Human Atlas build). modelled: built in code by tools/make-skin.mjs from the dimensions in provenance.json.',
  structures: ORDER.map((id) => sources[id]),
}, null, 2) + '\n');

// ── Attribution ─────────────────────────────────────────────────────────────
const dimRows = Object.entries(dims).map(([k, d]) => `| ${k} | ${Array.isArray(d.model) ? d.model.join(' / ') : d.model} | ${d.expected ?? ''} | ${(d.sources ?? []).join(', ')} |`).join('\n');
const attribution = `# Attribution and asset provenance

## 3D skin model — \`models/skin.glb\`

### Source

**BodyParts3D 4.0**, © The **Database Center for Life Science** (DBCLS), licensed **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/). https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html

- Taken as converted by *Human Atlas* (github.com/Niyaz-05/human-atlas, commit \`${commit(humanDir)}\`); \`atlas.json\` sha256 \`${sha256(human.bytes)}\`; chunk hashes in \`src/skin/generated/provenance.json\`.
- Used parts: Skin (FJ2810) → \`body-skin\`; Hair of head (FJ2813) → \`scalp-hair\`; Pubic hair (FJ2815) → \`pubic-hair\`.

Neither DBCLS nor BodyParts3D has reviewed or endorsed this lab.

### Changes made (as CC BY 4.0 requires)

\`tools/make-skin.mjs\`:
- Welded the three parts; simplified the skin surface to about 28,000 triangles (quadric simplification, meshoptimizer).
- Added two per-vertex attributes to the skin: \`_REGION\` (rule-of-nines region) and \`_DERMATOME\` (an approximate C2–S5 dermatome map, after Lee et al. 2008 and Keegan & Garrett 1948), both classified from vertex position.

### Parts modelled for this lab (not from BodyParts3D)

The skin block — the five epidermal strata, melanocytes and Langerhans cells, papillary and reticular dermis with collagen bundles, subcutaneous fat with fibrous septa, deep fascia, the hair follicle (shaft, root sheaths, bulb, papilla), arrector pili, sebaceous, eccrine and apocrine glands, Meissner, Merkel, Pacinian, Ruffini, free and follicular nerve endings, the superficial and deep vascular plexuses with capillary loops, lymphatics and a cutaneous nerve — is built in code from standard adult histological dimensions. It is a teaching model: arrangements are simplified, some counts are reduced and a few fine structures are drawn thicker than life (listed below).

| Dimension | Model | Typical adult value | Sources |
|---|---|---|---|
${dimRows}

Sources: openstax-ch5 = Betts JG et al., *Anatomy and Physiology 2e*, ch. 5 "The Integumentary System", OpenStax 2022 (CC BY 4.0); ross-8 = Ross MH, Pawlina W, *Histology: A Text and Atlas*, 8th ed., Wolters Kluwer 2020; kandel-6 = Kandel ER et al., *Principles of Neural Science*, 6th ed., McGraw-Hill 2021 (touch receptors); lee-2008 = Lee MWL, McPhee RW, Stringer MD, An evidence-based approach to human dermatomes, *Clin Anat* 2008;21:363–373; keegan-1948 = Keegan JJ, Garrett FD, The segmental distribution of the cutaneous nerves in the limbs of man, *Anat Rec* 1948;102:409–437. Cited for dimensions only; no text or figures are copied.

\`tools/bake-shading.mjs\` then adds a per-vertex \`_TISSUE\` attribute (ambient occlusion and a noise value) for the real-tissue look.

<!-- output:start -->
The output is \`models/skin.glb\` (${glb.byteLength.toLocaleString('en-GB')} bytes, ${triangles.toLocaleString('en-GB')} triangles, sha256 \`${sha256(glb)}\`).
<!-- output:end -->
`;
fs.writeFileSync(path.join(root, 'public/ATTRIBUTION.md'), attribution);
log(JSON.stringify({ structures: meshes.size, triangles, bytes: glb.byteLength, checks }, null, 1));
