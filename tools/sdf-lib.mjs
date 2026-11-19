/**
 * Modelling helpers for the parts of the ear built in code (tools/make-ear.mjs).
 *
 * - Signed distance fields (SDF) in millimetres: spheres, ellipsoids, tapered capsules, polyline
 *   tubes (binned for speed), smooth union / subtraction. Organic parts (ossicles, the cochlea's
 *   bony shell, the vestibule, the mastoid air cells, the tympanic cavity) are SDF unions.
 * - Surface nets: a closed, watertight triangle mesh of an SDF's zero level, with each vertex
 *   projected onto the surface (two Newton steps), then lightly smoothed and simplified.
 * - Profile sweeps: closed tubes with arbitrary cross-sections along a framed curve (the three
 *   scalae and the basilar membrane), and hollow tubes (the ear canal's wall).
 * Positions are plain arrays [x, y, z]; meshes are { positions: Float32Array, indices: Uint32Array }.
 */
import { THREE, weld, taubin, simplify, closeLoops, signedVolume } from './mesh-lib.mjs';

// ── Vector helpers ──────────────────────────────────────────────────────────
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const dist = (a, b) => len(sub(a, b));
/** Sum of scaled vectors: comb(p, [k1, v1], [k2, v2], …). */
export const comb = (p, ...terms) => terms.reduce((acc, [k, v]) => add(acc, mul(v, k)), p);
/** Rodrigues rotation of v about unit axis k by angle a (radians). */
export function rotate(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}
/** An orthonormal pair perpendicular to unit vector n (deterministic). */
export function basisOf(n) {
  const a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(a, n));
  return [u, cross(n, u)];
}

// ── SDF primitives (millimetres) ────────────────────────────────────────────
export const sdSphere = (c, r) => (p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r;
/** Ellipsoid on orthonormal axes `ax` with radii `r` (bound-corrected approximation). */
export function sdEllipsoid(c, ax, r) {
  return (p) => {
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const q = [dot(d, ax[0]) / r[0], dot(d, ax[1]) / r[1], dot(d, ax[2]) / r[2]];
    const k0 = Math.hypot(q[0], q[1], q[2]);
    const k1 = Math.hypot(q[0] / r[0], q[1] / r[1], q[2] / r[2]);
    return k1 === 0 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
  };
}
/** Capsule from a to b whose radius goes from ra to rb. */
export function sdCapsule(a, b, ra, rb = ra) {
  const ba = sub(b, a), bb = dot(ba, ba);
  return (p) => {
    const pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const h = Math.max(0, Math.min(1, dot(pa, ba) / bb));
    return Math.hypot(pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h) - (ra + (rb - ra) * h);
  };
}
/** Half-space: negative on the side opposite the unit normal n (n·(p − o) < 0). */
export const sdPlane = (o, n) => (p) => dot(sub(p, o), n);

export const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const smax = (a, b, k) => -smin(-a, -b, k);
export const union = (fs, k = 0) => (p) => { let d = fs[0](p); for (let i = 1; i < fs.length; i++) d = smin(d, fs[i](p), k); return d; };
export const subtract = (f, g, k = 0) => (p) => smax(f(p), -g(p), k);
export const intersect = (f, g, k = 0) => (p) => smax(f(p), g(p), k);

/**
 * A tube along a polyline of points with per-point radii (a chain of tapered capsules, smoothly
 * unioned with blend k). Segments are binned on a grid, so a sample only checks the nearby ones;
 * far from every segment the field returns `far` (positive).
 */
export function sdPolyTube(points, radii, k = 0, cell = 1.0, far = 2.0) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) segs.push(sdCapsule(points[i], points[i + 1], radii[i], radii[i + 1]));
  const rMax = Math.max(...radii);
  const reach = rMax + far + k;
  const bins = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const lo = [0, 1, 2].map((q) => Math.floor((Math.min(a[q], b[q]) - reach) / cell));
    const hi = [0, 1, 2].map((q) => Math.floor((Math.max(a[q], b[q]) + reach) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const kk = key(x, y, z);
      (bins.get(kk) ?? bins.set(kk, []).get(kk)).push(i);
    }
  }
  return (p) => {
    const list = bins.get(key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)));
    if (!list) return far;
    let d = Infinity;
    for (const i of list) d = smin(d, segs[i](p), k);
    return Math.min(d, far);
  };
}

// ── Surface nets ────────────────────────────────────────────────────────────
/**
 * Closed mesh of the zero level of `f` inside [lo, hi] at cell size h (mm). Samples are skipped
 * (taken from a coarse grid) where the coarse field shows the surface is far away.
 * Options: smooth (Taubin iterations, default 2), target (triangle count after simplification).
 */
export function surfaceNets(f, lo, hi, h, { smooth = 2, target = 0, maxError = 0.002 } = {}) {
  const n = [0, 1, 2].map((a) => Math.ceil((hi[a] - lo[a]) / h) + 3);
  const o = [0, 1, 2].map((a) => lo[a] - h);
  const N = n[0] * n[1] * n[2];
  const val = new Float32Array(N);
  const at = (i, j, k) => (k * n[1] + j) * n[0] + i;
  // Coarse pass every 4 samples, then exact values only near the surface.
  const S = 4;
  const cn = [0, 1, 2].map((a) => Math.ceil(n[a] / S) + 1);
  const coarse = new Float32Array(cn[0] * cn[1] * cn[2]);
  for (let k = 0; k < cn[2]; k++) for (let j = 0; j < cn[1]; j++) for (let i = 0; i < cn[0]; i++) {
    coarse[(k * cn[1] + j) * cn[0] + i] = f([o[0] + i * S * h, o[1] + j * S * h, o[2] + k * S * h]);
  }
  const safe = S * h * 1.9;
  const p = [0, 0, 0];
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    const ci = Math.floor(i / S), cj = Math.floor(j / S), ck = Math.floor(k / S);
    let mn = Infinity, sum = 0;
    for (let c = 0; c < 8; c++) {
      const v = coarse[((ck + (c >> 2)) * cn[1] + cj + ((c >> 1) & 1)) * cn[0] + ci + (c & 1)];
      mn = Math.min(mn, Math.abs(v)); sum += v;
    }
    if (mn > safe && Math.sign(sum) !== 0) { val[at(i, j, k)] = sum / 8; continue; }
    p[0] = o[0] + i * h; p[1] = o[1] + j * h; p[2] = o[2] + k * h;
    val[at(i, j, k)] = f(p);
  }
  // One vertex per cell that the surface crosses.
  const vid = new Int32Array(N).fill(-1);
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < n[2] - 1; k++) for (let j = 0; j < n[1] - 1; j++) for (let i = 0; i < n[0] - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { cv[c] = val[at(i + corners[c][0], j + corners[c][1], k + corners[c][2])]; if (cv[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (const [a, b] of edges) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += corners[a][0] + t * (corners[b][0] - corners[a][0]);
      sy += corners[a][1] + t * (corners[b][1] - corners[a][1]);
      sz += corners[a][2] + t * (corners[b][2] - corners[a][2]);
      m++;
    }
    vid[at(i, j, k)] = pos.length / 3;
    pos.push(o[0] + (i + sx / m) * h, o[1] + (j + sy / m) * h, o[2] + (k + sz / m) * h);
  }
  // Quads across every grid edge with a sign change.
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < n[2] - 1; k++) for (let j = 1; j < n[1] - 1; j++) for (let i = 1; i < n[0] - 1; i++) {
    const v0 = val[at(i, j, k)] < 0;
    if (v0 !== (val[at(i + 1, j, k)] < 0)) quad(vid[at(i, j - 1, k - 1)], vid[at(i, j, k - 1)], vid[at(i, j, k)], vid[at(i, j - 1, k)], !v0);
    if (v0 !== (val[at(i, j + 1, k)] < 0)) quad(vid[at(i - 1, j, k - 1)], vid[at(i - 1, j, k)], vid[at(i, j, k)], vid[at(i, j, k - 1)], !v0);
    if (v0 !== (val[at(i, j, k + 1)] < 0)) quad(vid[at(i - 1, j - 1, k)], vid[at(i, j - 1, k)], vid[at(i, j, k)], vid[at(i - 1, j, k)], !v0);
  }
  let positions = Float32Array.from(pos), indices = Uint32Array.from(idx);
  // Project onto the surface (Newton steps along the numerical gradient).
  const e = h * 0.25, q = [0, 0, 0];
  const g = (x, y, z) => { q[0] = x; q[1] = y; q[2] = z; return f(q); };
  const project = () => {
    for (let it = 0; it < 2; it++) for (let v = 0; v < positions.length; v += 3) {
      const x = positions[v], y = positions[v + 1], z = positions[v + 2];
      const d = g(x, y, z);
      const gx = (g(x + e, y, z) - g(x - e, y, z)) / (2 * e), gy = (g(x, y + e, z) - g(x, y - e, z)) / (2 * e), gz = (g(x, y, z + e) - g(x, y, z - e)) / (2 * e);
      const gg = gx * gx + gy * gy + gz * gz;
      if (gg < 1e-8) continue;
      const s = Math.max(-h, Math.min(h, d / gg));
      positions[v] = x - gx * s; positions[v + 1] = y - gy * s; positions[v + 2] = z - gz * s;
    }
  };
  project();
  if (smooth) { taubin(positions, indices, smooth); project(); }
  let mesh = { positions, indices };
  if (signedVolume(mesh) < 0) flip(mesh);
  if (target && indices.length / 3 > target) mesh = simplify(mesh.positions, mesh.indices, target / (indices.length / 3), maxError);
  return { positions: mesh.positions, indices: mesh.indices };
}

export function flip(m) {
  for (let t = 0; t < m.indices.length; t += 3) { const a = m.indices[t + 1]; m.indices[t + 1] = m.indices[t + 2]; m.indices[t + 2] = a; }
  return m;
}

// ── Sweeps ──────────────────────────────────────────────────────────────────
/**
 * A closed tube along framed rings. rings[i] = { c, u, v } (centre and two in-plane axes);
 * profile(i) returns the cross-section as [[a, b], …] (point = c + a·u + b·v), counter-clockwise,
 * the same number of points for every ring. Ends are capped.
 */
export function sweepProfile(rings, profile) {
  const pos = [], idx = [];
  let m = 0;
  rings.forEach((r, i) => {
    const pr = profile(i);
    if (i === 0) m = pr.length;
    if (pr.length !== m) throw new Error('sweepProfile: profiles must have equal length');
    for (const [a, b] of pr) pos.push(r.c[0] + a * r.u[0] + b * r.v[0], r.c[1] + a * r.u[1] + b * r.v[1], r.c[2] + a * r.u[2] + b * r.v[2]);
  });
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = i * m + ((j + 1) % m), c = (i + 1) * m + j, d = (i + 1) * m + ((j + 1) % m);
    idx.push(a, b, c, b, d, c);
  }
  const closed = closeLoops(Float32Array.from(pos), Uint32Array.from(idx));
  const w = weld(closed.positions, closed.indices);
  if (signedVolume(w) < 0) flip(w);
  return w;
}
/**
 * A hollow tube (open lumen) along framed rings: outer(i) and inner(i) give cross-sections with
 * the same point count; the two ends are joined by flat annuli.
 */
export function hollowSweep(rings, outer, inner) {
  const pos = [], idx = [];
  const m = outer(0).length;
  const R = rings.length;
  const put = (r, pr) => { for (const [a, b] of pr) pos.push(r.c[0] + a * r.u[0] + b * r.v[0], r.c[1] + a * r.u[1] + b * r.v[1], r.c[2] + a * r.u[2] + b * r.v[2]); };
  rings.forEach((r, i) => put(r, outer(i)));
  rings.forEach((r, i) => put(r, inner(i)));
  const O = (i, j) => i * m + (j % m), I = (i, j) => R * m + i * m + (j % m);
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < m; j++) {
    idx.push(O(i, j), O(i, j + 1), O(i + 1, j), O(i, j + 1), O(i + 1, j + 1), O(i + 1, j));
    idx.push(I(i, j), I(i + 1, j), I(i, j + 1), I(i, j + 1), I(i + 1, j), I(i + 1, j + 1));
  }
  for (let j = 0; j < m; j++) {
    idx.push(O(0, j), I(0, j), O(0, j + 1), O(0, j + 1), I(0, j), I(0, j + 1));
    const e = R - 1;
    idx.push(O(e, j), O(e, j + 1), I(e, j), O(e, j + 1), I(e, j + 1), I(e, j));
  }
  const w = weld(Float32Array.from(pos), Uint32Array.from(idx));
  if (signedVolume(w) < 0) flip(w);
  return w;
}
/** Rotation-minimising frames along a polyline: [{ c, t, u, v }]. */
export function framesAlong(points, up = [0, 1, 0]) {
  const out = [];
  let u = null;
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const t = norm(sub(b, a));
    if (!u) u = norm(sub(up, mul(t, dot(up, t))));
    else u = norm(sub(u, mul(t, dot(u, t))));
    out.push({ c: points[i], t, u, v: cross(t, u) });
  }
  return out;
}
/** Points along a centripetal Catmull–Rom curve through `pts`, every `step` mm. */
export function curvePoints(pts, step) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const n = Math.max(2, Math.round(curve.getLength() / step));
  return Array.from({ length: n + 1 }, (_, i) => curve.getPointAt(i / n).toArray());
}
export const polyLen = (pts) => pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i]), 0);

/** A deterministic pseudo-random generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
