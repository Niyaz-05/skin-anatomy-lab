/**
 * Geometry helpers for the skin block (tools/make-skin.mjs): noise, jittered seed grids, heightfield
 * surfaces simplified with a locked border and stitched into closed slabs (one per tissue layer, the
 * interfaces shared exactly between neighbours), swept tubes (solid or hollow, optional per-ring
 * colour), surfaces of revolution and small primitives. Units are millimetres. Meshes are
 * { positions: Float32Array, indices: Uint32Array, normals?: Float32Array, colors?: Float32Array (RGB, linear) }.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import { smoothNormals, signedVolume, weld } from './mesh-lib.mjs';
import { add, sub, mul, dot, cross, norm, dist, curvePoints, flip } from './sdf-lib.mjs';

await MeshoptSimplifier.ready;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Smooth minimum (polynomial), k in the field's units. */
export const sminf = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// ── Noise (deterministic) ───────────────────────────────────────────────────
export function hash2(i, j, s = 0) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function hash3(i, j, k, s = 0) { return hash2(i, Math.imul(j | 0, 31) ^ Math.imul(k | 0, 2654435761), s); }
export function vnoise2(x, z, s = 0) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return mix(mix(hash2(xi, zi, s), hash2(xi + 1, zi, s), u), mix(hash2(xi, zi + 1, s), hash2(xi + 1, zi + 1, s), u), v);
}
export function fbm2(x, z, s = 0, oct = 3) {
  let t = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { t += a * vnoise2(x * f, z * f, s + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return t / n;
}
export function vnoise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const sm = (t) => t * t * (3 - 2 * t);
  const fx = sm(x - xi), fy = sm(y - yi), fz = sm(z - zi);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d, s);
  return mix(mix(mix(c(0, 0, 0), c(1, 0, 0), fx), mix(c(0, 1, 0), c(1, 1, 0), fx), fy), mix(mix(c(0, 0, 1), c(1, 0, 1), fx), mix(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}

/** Jittered grid of 2D seeds, binned by cell for fast neighbour queries. */
export function seedGrid(x0, x1, z0, z1, spacing, seed, jitter = 0.4) {
  const seeds = [], bins = new Map();
  const ni = Math.ceil((x1 - x0) / spacing), nj = Math.ceil((z1 - z0) / spacing);
  for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
    const s = {
      x: x0 + (i + 0.5 + (hash2(i, j, seed) - 0.5) * 2 * jitter) * spacing,
      z: z0 + (j + 0.5 + (hash2(i, j, seed + 1) - 0.5) * 2 * jitter) * spacing,
      a: hash2(i, j, seed + 2), b: hash2(i, j, seed + 3), i, j,
    };
    seeds.push(s);
    bins.set(`${i},${j}`, s);
  }
  const near = (x, z, reach = 1) => {
    const ci = Math.floor((x - x0) / spacing), cj = Math.floor((z - z0) / spacing), out = [];
    for (let di = -reach; di <= reach; di++) for (let dj = -reach; dj <= reach; dj++) { const s = bins.get(`${ci + di},${cj + dj}`); if (s) out.push(s); }
    return out;
  };
  return { seeds, near, spacing };
}

/** Distance to the nearest Voronoi edge (bisector) of a seed grid in 2D. */
export function voronoiEdge2(grid, x, z) {
  const cand = grid.near(x, z, 2);
  let best = null, bd = Infinity;
  for (const s of cand) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
  let e = Infinity;
  for (const s of cand) {
    if (s === best) continue;
    const dx = s.x - best.x, dz = s.z - best.z, l = Math.hypot(dx, dz);
    const d = ((x - s.x) ** 2 + (z - s.z) ** 2 - bd) / (2 * l);
    e = Math.min(e, d);
  }
  return e;
}

// ── Heightfield surfaces and slabs ──────────────────────────────────────────
/**
 * A regular grid over x ∈ [x0 + i0·h, x0 + (nx−1)·h], z ∈ [z0, z0 + (nz−1)·h] with heights from
 * `heights` (Float32Array nx·nz, index i + j·nx). Triangles face +y. Returns the surface and its
 * border sample order (counter-clockwise seen from +y): z0 edge, x1 edge, z1 edge, x0 edge.
 */
export function gridSurface(grid, heights, i0 = 0) {
  const { nx, nz, x0, z0, h } = grid;
  const w = nx - i0;
  const positions = new Float32Array(w * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = i0; i < nx; i++) {
    const k = (i - i0) + j * w;
    positions[k * 3] = x0 + i * h; positions[k * 3 + 1] = heights[i + j * nx]; positions[k * 3 + 2] = z0 + j * h;
  }
  const idx = new Uint32Array((w - 1) * (nz - 1) * 6);
  let t = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < w - 1; i++) {
    const v00 = i + j * w, v10 = v00 + 1, v01 = v00 + w, v11 = v01 + 1;
    idx[t++] = v00; idx[t++] = v01; idx[t++] = v10;
    idx[t++] = v10; idx[t++] = v01; idx[t++] = v11;
  }
  const sides = [[], [], [], []]; // z0 (x up), x1 (z up), z1 (x down), x0 (z down)
  for (let i = 0; i < w; i++) sides[0].push(i);
  for (let j = 0; j < nz; j++) sides[1].push(w - 1 + j * w);
  for (let i = w - 1; i >= 0; i--) sides[2].push(i + (nz - 1) * w);
  for (let j = nz - 1; j >= 0; j--) sides[3].push(j * w);
  return { positions, indices: idx, sides, w, nz };
}

/**
 * Simplify a grid surface to an absolute error (mm). Border vertices may only slide along the border
 * (meshoptimizer keeps boundary edges on the boundary), and the four corners are locked, so every
 * remaining border vertex stays exactly on its wall plane.
 */
export function simplifySurface(s, err) {
  const n = s.positions.length / 3;
  const lock = new Uint8Array(n);
  for (const side of s.sides) { lock[side[0]] = 1; lock[side.at(-1)] = 1; }
  const [idx] = MeshoptSimplifier.simplifyWithAttributes(s.indices, s.positions, 3, new Float32Array(n), 1, [0], lock, 0, err, ['ErrorAbsolute']);
  // Remaining border vertices per side, in side order.
  const used = new Uint8Array(n);
  for (const v of idx) used[v] = 1;
  const sides = s.sides.map((side) => side.filter((v) => used[v]));
  return { ...s, indices: idx, sides };
}

/**
 * A closed slab between two simplified surfaces on the same grid domain (top above bottom). The top
 * and bottom keep their own smooth normals; the four walls are flat with their own vertices (so edges
 * stay crisp), zipped between the two surfaces' border vertices. `wallOut` pushes the walls outward
 * (mm), so a thin slab drawn over a thicker neighbour's wall wins the depth test.
 */
export function slab(top, bot, wallOut = 0) {
  const pos = [], nor = [], idx = [];
  const addSurface = (s, up) => {
    const map = new Map();
    const tri = [];
    for (let t = 0; t < s.indices.length; t += 3) {
      const a = s.indices[t], b = s.indices[t + 1], c = s.indices[t + 2];
      tri.push(...(up ? [a, b, c] : [a, c, b]));
    }
    const local = [], li = [];
    for (const v of tri) { let k = map.get(v); if (k === undefined) { k = local.length / 3; map.set(v, k); local.push(s.positions[v * 3], s.positions[v * 3 + 1], s.positions[v * 3 + 2]); } li.push(k); }
    const lp = Float32Array.from(local), lidx = Uint32Array.from(li);
    const ln = smoothNormals(lp, lidx);
    const o = pos.length / 3;
    for (let i = 0; i < lp.length; i++) { pos.push(lp[i]); nor.push(ln[i]); }
    for (const v of lidx) idx.push(v + o);
  };
  addSurface(top, true);
  addSurface(bot, false);
  const outward = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
  const alongAxis = [0, 2, 0, 2], alongSign = [1, 1, -1, -1];
  for (let sd = 0; sd < 4; sd++) {
    const n = outward[sd], ax = alongAxis[sd], sg = alongSign[sd];
    const P = (src, v) => [src.positions[v * 3] + n[0] * wallOut, src.positions[v * 3 + 1], src.positions[v * 3 + 2] + n[2] * wallOut];
    const T = top.sides[sd].map((v) => P(top, v)), B = bot.sides[sd].map((v) => P(bot, v));
    const o = pos.length / 3;
    for (const p of [...T, ...B]) { pos.push(...p); nor.push(...n); }
    const ti = (k) => o + k, bi = (k) => o + T.length + k;
    const key = (p) => sg * p[ax];
    // Zip: always advance along the side on whichever polyline's next vertex comes first.
    let i = 0, j = 0;
    const tri = (a, b, c) => {
      const pa = pos.slice(a * 3, a * 3 + 3), pb = pos.slice(b * 3, b * 3 + 3), pc = pos.slice(c * 3, c * 3 + 3);
      const fn = cross(sub(pb, pa), sub(pc, pa));
      if (Math.hypot(...fn) < 1e-12) return;
      idx.push(...(dot(fn, n) < 0 ? [a, c, b] : [a, b, c]));
    };
    while (i < T.length - 1 || j < B.length - 1) {
      const advT = j >= B.length - 1 || (i < T.length - 1 && key(T[i + 1]) <= key(B[j + 1]));
      if (advT) { tri(ti(i), ti(i + 1), bi(j)); i++; } else { tri(ti(i), bi(j + 1), bi(j)); j++; }
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), normals: Float32Array.from(nor) };
}

// ── Tubes ───────────────────────────────────────────────────────────────────
/** Rotation-minimising frames with a starting up-vector chosen away from the first tangent. */
export function frames(points) {
  const out = [];
  const t0 = norm(sub(points[1], points[0]));
  const up = Math.abs(t0[1]) < 0.8 ? [0, 1, 0] : [1, 0, 0];
  let u = norm(sub(up, mul(t0, dot(up, t0))));
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const t = norm(sub(b, a));
    u = norm(sub(u, mul(t, dot(u, t))));
    out.push({ c: points[i], t, u, v: cross(t, u) });
  }
  return out;
}

/**
 * A closed round tube along a curve through `points` (resampled every `step` unless raw), radius
 * r(t, p) with t = 0…1 along it; ends capped with fans. `color(t)` gives a linear RGB per ring.
 */
export function tube(points, radius, { seg = 8, step = 0.02, raw = false, color = null } = {}) {
  const pts = raw ? points : curvePoints(points, step);
  if (pts.length < 2) throw new Error('tube: needs two points');
  const fr = frames(pts);
  const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i], pts[i - 1]));
  const total = s.at(-1) || 1;
  const pos = [], col = [], idx = [];
  fr.forEach((f, i) => {
    const t = s[i] / total;
    const r = typeof radius === 'function' ? radius(t, pts[i]) : radius;
    const c = color ? color(t) : null;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(...add(f.c, add(mul(f.u, r * Math.cos(a)), mul(f.v, r * Math.sin(a)))));
      if (c) col.push(...c);
    }
  });
  const R = fr.length;
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
    idx.push(a, c, b, b, c, d);
  }
  for (const [ring, end] of [[0, false], [R - 1, true]]) {
    const ci = pos.length / 3;
    pos.push(...fr[ring].c);
    if (color) col.push(...color(end ? 1 : 0));
    for (let j = 0; j < seg; j++) {
      const a = ring * seg + j, b = ring * seg + ((j + 1) % seg);
      idx.push(...(end ? [a, b, ci] : [b, a, ci]));
    }
  }
  const m = { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), colors: color ? Float32Array.from(col) : undefined };
  if (signedVolume(m) < 0) flip(m);
  return m;
}

/** A hollow tube (open lumen) with outer and inner radii as functions of t; ends are flat annuli. */
export function hollowTube(points, rOut, rIn, { seg = 12, step = 0.02, raw = false } = {}) {
  const pts = raw ? points : curvePoints(points, step);
  const fr = frames(pts);
  const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i], pts[i - 1]));
  const total = s.at(-1) || 1;
  const pos = [], idx = [];
  const R = fr.length;
  for (const which of [0, 1]) fr.forEach((f, i) => {
    const t = s[i] / total;
    const fn = which === 0 ? rOut : rIn;
    const r = typeof fn === 'function' ? fn(t, pts[i]) : fn;
    for (let j = 0; j < seg; j++) { const a = (j / seg) * Math.PI * 2; pos.push(...add(f.c, add(mul(f.u, r * Math.cos(a)), mul(f.v, r * Math.sin(a))))); }
  });
  const O = (i, j) => i * seg + (j % seg), I = (i, j) => R * seg + i * seg + (j % seg);
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < seg; j++) {
    idx.push(O(i, j), O(i + 1, j), O(i, j + 1), O(i, j + 1), O(i + 1, j), O(i + 1, j + 1));
    idx.push(I(i, j), I(i, j + 1), I(i + 1, j), I(i, j + 1), I(i + 1, j + 1), I(i + 1, j));
  }
  for (let j = 0; j < seg; j++) {
    idx.push(O(0, j), O(0, j + 1), I(0, j), O(0, j + 1), I(0, j + 1), I(0, j));
    const e = R - 1;
    idx.push(O(e, j), I(e, j), O(e, j + 1), O(e, j + 1), I(e, j), I(e, j + 1));
  }
  const m = { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
  if (signedVolume(m) < 0) flip(m);
  return m;
}

/**
 * Surface of revolution of a closed profile polygon [[t, r], …] (t along `axis` from `c`, r ≥ 0)
 * around the axis. Points with r = 0 become poles (welded). Returns a welded, outward mesh.
 */
export function lathe(c, axis, profile, seg = 32) {
  const a = norm(axis);
  const helper = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(helper, a)), v = cross(a, u);
  const P = profile.length, pos = [], idx = [];
  for (let k = 0; k < P; k++) {
    const [t, r] = profile[k];
    for (let j = 0; j < seg; j++) {
      const ang = (j / seg) * Math.PI * 2;
      pos.push(...add(c, add(mul(a, t), add(mul(u, r * Math.cos(ang)), mul(v, r * Math.sin(ang))))));
    }
  }
  for (let k = 0; k < P; k++) {
    const k2 = (k + 1) % P;
    for (let j = 0; j < seg; j++) {
      const p00 = k * seg + j, p01 = k * seg + ((j + 1) % seg), p10 = k2 * seg + j, p11 = k2 * seg + ((j + 1) % seg);
      idx.push(p00, p10, p01, p01, p10, p11);
    }
  }
  const m = weld(Float32Array.from(pos), Uint32Array.from(idx));
  if (signedVolume(m) < 0) flip(m);
  return m;
}

/** Half-ellipse profile points from t = −A to +A (r = B·√(1 − (t/A)²)), n points, optionally reversed. */
export function halfEllipse(A, B, n, reverse = false, t0 = 0) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const th = Math.PI - (k / (n - 1)) * Math.PI; // π → 0: t from −A to +A
    out.push([t0 + A * Math.cos(th), Math.max(0, B * Math.sin(th))]);
  }
  return reverse ? out.reverse() : out;
}

/** A low-poly ellipsoid about c on axes ax (three unit vectors) with radii r. */
export function blob(c, ax, r, segs = 10, rings = 6) {
  const pos = [], idx = [];
  pos.push(...add(c, mul(ax[1], r[1])));
  for (let i = 1; i < rings; i++) {
    const th = (i / rings) * Math.PI;
    for (let j = 0; j < segs; j++) {
      const ph = (j / segs) * Math.PI * 2;
      pos.push(...add(c, add(mul(ax[0], r[0] * Math.sin(th) * Math.cos(ph)), add(mul(ax[1], r[1] * Math.cos(th)), mul(ax[2], r[2] * Math.sin(th) * Math.sin(ph))))));
    }
  }
  pos.push(...add(c, mul(ax[1], -r[1])));
  const last = pos.length / 3 - 1;
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings - 2; i++) for (let j = 0; j < segs; j++) {
    const a = 1 + i * segs + j, b = 1 + i * segs + ((j + 1) % segs), c2 = a + segs, d = b + segs;
    idx.push(a, b, c2, b, d, c2);
  }
  const base = 1 + (rings - 2) * segs;
  for (let j = 0; j < segs; j++) idx.push(last, base + j, base + ((j + 1) % segs));
  const m = { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
  if (signedVolume(m) < 0) flip(m);
  return m;
}

/** Concatenate meshes (colors kept when every piece has them, else filled with `fill`). */
export function merge(pieces, fill = null) {
  const anyColor = pieces.some((p) => p.colors) || fill;
  const vCount = pieces.reduce((n, p) => n + p.positions.length / 3, 0);
  const positions = new Float32Array(vCount * 3), indices = new Uint32Array(pieces.reduce((n, p) => n + p.indices.length, 0));
  const colors = anyColor ? new Float32Array(vCount * 3) : undefined;
  const hasNormals = pieces.every((p) => p.normals);
  const normals = hasNormals ? new Float32Array(vCount * 3) : undefined;
  let vo = 0, io = 0;
  for (const p of pieces) {
    positions.set(p.positions, vo * 3);
    if (normals) normals.set(p.normals, vo * 3);
    if (colors) {
      if (p.colors) colors.set(p.colors, vo * 3);
      else for (let i = 0; i < p.positions.length / 3; i++) colors.set(fill ?? [1, 1, 1], (vo + i) * 3);
    }
    for (let k = 0; k < p.indices.length; k++) indices[io + k] = p.indices[k] + vo;
    vo += p.positions.length / 3; io += p.indices.length;
  }
  return { positions, indices, colors, normals };
}

/** sRGB hex → linear RGB triple. */
export function linear(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
}
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Closest point on segment ab to p, and its parameter. */
export function closestOnSegment(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab) || 1e-12;
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return { q: add(a, mul(ab, t)), t };
}
/**
 * Push points out of capsule obstacles [{ a, b, r }] (a polyline obstacle is a list of capsules).
 * Moves each point radially away from the obstacle axis to its radius; repeated a few times.
 */
export function avoid(points, obstacles, passes = 3) {
  const out = points.map((p) => [...p]);
  for (let pass = 0; pass < passes; pass++) for (const p of out) for (const o of obstacles) {
    const { q } = closestOnSegment(p, o.a, o.b);
    const d = sub(p, q), l = Math.hypot(...d);
    if (l < o.r) {
      const dir = l > 1e-6 ? mul(d, 1 / l) : [1, 0, 0];
      const np = add(q, mul(dir, o.r));
      p[0] = np[0]; p[1] = np[1]; p[2] = np[2];
    }
  }
  return out;
}
/** Minimum distance between non-neighbouring points of a polyline (index gap ≥ `gap`). */
export function selfClearance(pts, gap) {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + gap; j < pts.length; j++) m = Math.min(m, dist(pts[i], pts[j]));
  return m;
}
