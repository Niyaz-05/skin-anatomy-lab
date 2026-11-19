/**
 * Procedural histology on the skin block: each tissue draws its microscopic texture — cornified
 * lamellae, keratinocytes with nuclei, columnar basal cells with melanin, loose or coarse collagen,
 * adipocytes with thin membranes, foamy sebocytes — from the fragment's position in millimetres.
 * The same code runs on the block's outer faces (which are cut faces of the skin) and on the
 * stencil caps of the cutting plane, so every section reads like a stained slide. Patterns fade to
 * the tissue's average colour when a cell would be smaller than a few pixels (no shimmering).
 */
import * as THREE from 'three';

export type Pattern = 'none' | 'corneum' | 'lucidum' | 'granulosum' | 'spinosum' | 'basale' | 'papillary' | 'reticular' | 'fat' | 'septa' | 'muscle' | 'sebaceous' | 'gland' | 'nerve';
const CODE: Record<Pattern, number> = { none: 0, corneum: 1, lucidum: 2, granulosum: 3, spinosum: 4, basale: 5, papillary: 6, reticular: 7, fat: 8, septa: 9, muscle: 10, sebaceous: 11, gland: 12, nerve: 13 };

/** Shared switches: world units → millimetres, and on/off (off in the Layers colour mode). */
export const histologyUniforms = {
  uHistScale: { value: 100 },
};

const COMMON = /* glsl */ `
varying vec3 vHistPos;
uniform float uHistScale;
uniform float uHistOn;
float hh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
vec3 hh3(vec3 p) { return vec3(hh(p), hh(p + 19.19), hh(p + 47.31)); }
float vn(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hh(i), hh(i + vec3(1, 0, 0)), f.x), mix(hh(i + vec3(0, 1, 0)), hh(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hh(i + vec3(0, 0, 1)), hh(i + vec3(1, 0, 1)), f.x), mix(hh(i + vec3(0, 1, 1)), hh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Voronoi: distances to the nearest and second-nearest cell centres (in cell units).
vec2 vor(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + hh3(i + g) * 0.85 + 0.075 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(vec2(d1, d2));
}
float histFade(float px, float size) { return clamp(1.8 - px * 2.5 / size, 0.0, 1.0); }
vec3 histology(vec3 c, vec3 p, float px) {
  float f;
#if HIST_PATTERN == 1
  // Stratum corneum: thin, flattened squames in wavy lamellae with clefts (basket-weave).
  f = histFade(px, 0.006);
  float t = p.y / 0.0055 + 1.4 * vn(p * vec3(28.0, 3.0, 28.0));
  float gap = smoothstep(0.34, 0.5, abs(fract(t) - 0.5)) * step(0.42, vn(p * vec3(45.0, 2.0, 45.0) + t));
  c = mix(c, vec3(1.0, 0.975, 0.92), gap * 0.6 * f);
  c *= 1.0 + 0.08 * (vn(p * vec3(90.0, 400.0, 90.0)) - 0.5) * f;
#elif HIST_PATTERN == 2
  // Stratum lucidum: homogeneous, glassy.
  f = histFade(px, 0.004);
  c *= 1.0 + 0.05 * (vn(p * 300.0) - 0.5) * f;
#elif HIST_PATTERN == 3
  // Stratum granulosum: flattened cells packed with dark keratohyalin granules.
  f = histFade(px, 0.008);
  vec2 v = vor(p * vec3(45.0, 120.0, 45.0));
  float edge = 1.0 - smoothstep(0.0, 0.16, v.y - v.x);
  float gran = smoothstep(0.5, 0.8, vn(p * 650.0));
  c = mix(c, vec3(0.33, 0.16, 0.33), gran * 0.7 * f);
  c = mix(c, c * 1.15 + 0.05, edge * 0.4 * f);
#elif HIST_PATTERN == 4
  // Stratum spinosum (and the outer root sheath): polygonal cells, pale intercellular clefts, round nuclei.
  f = histFade(px, 0.011);
  vec2 v = vor(p / 0.014);
  float edge = 1.0 - smoothstep(0.0, 0.16, v.y - v.x);
  float nuc = 1.0 - smoothstep(0.26, 0.34, v.x);
  c = mix(c, c * 1.18 + 0.1, edge * 0.7 * f);
  c = mix(c, vec3(0.45, 0.3, 0.52), nuc * 0.7 * f);
#elif HIST_PATTERN == 5
  // Stratum basale (and the hair matrix): tall columnar cells, dark nuclei, melanin caps.
  f = histFade(px, 0.008);
  vec2 v = vor(p * vec3(95.0, 55.0, 95.0));
  float nuc = 1.0 - smoothstep(0.28, 0.38, v.x);
  float edge = 1.0 - smoothstep(0.0, 0.15, v.y - v.x);
  c = mix(c, vec3(0.3, 0.17, 0.27), nuc * 0.6 * f);
  c = mix(c, vec3(0.32, 0.18, 0.1), 0.3 * vn(p * 350.0) * f);
  c = mix(c, c * 1.1 + 0.04, edge * 0.3 * f);
#elif HIST_PATTERN == 6
  // Papillary dermis: loose, fine fibres and scattered fibroblast nuclei.
  f = histFade(px, 0.012);
  vec3 q = p + 0.01 * vec3(vn(p * 40.0), vn(p * 40.0 + 3.1), vn(p * 40.0 + 7.3));
  float n = vn(q * 60.0);
  float fib = 1.0 - smoothstep(0.0, 0.05, abs(n - 0.5));
  c = mix(c, c * 1.12 + 0.08, fib * 0.65 * f);
  vec2 v = vor(p / 0.035);
  float nuc = 1.0 - smoothstep(0.08, 0.13, v.x);
  c = mix(c, vec3(0.45, 0.25, 0.42), nuc * 0.5 * f);
#elif HIST_PATTERN == 7
  // Reticular dermis: coarse interwoven collagen bundles separated by pale clefts; few nuclei.
  f = histFade(px, 0.02);
  vec3 q = p + 0.05 * vec3(vn(p * 7.0), vn(p * 7.0 + 3.1), vn(p * 7.0 + 7.3));
  float layer = step(0.0, sin(q.y / 0.045));
  float b1 = vn(vec3(q.x * 3.0, q.y / 0.03, q.z / 0.05));
  float b2 = vn(vec3(q.x / 0.05, q.y / 0.03 + 5.0, q.z * 3.0));
  float b = mix(b1, b2, layer);
  float cleft = 1.0 - smoothstep(0.0, 0.05, abs(b - 0.5));
  c *= 0.93 + 0.14 * b * f;
  c = mix(c, vec3(0.98, 0.92, 0.92), cleft * 0.5 * f);
  vec2 v = vor(p / 0.06);
  c = mix(c, vec3(0.45, 0.25, 0.42), (1.0 - smoothstep(0.03, 0.06, v.x)) * 0.45 * f);
#elif HIST_PATTERN == 8
  // Fat: large adipocytes, clear interiors, thin pink membranes, a nucleus pressed to the rim here and there.
  f = histFade(px, 0.06);
  vec2 v = vor(p / 0.075);
  float mem = 1.0 - smoothstep(0.0, 0.045, v.y - v.x);
  vec3 inside = mix(c, vec3(1.0, 0.975, 0.88), 0.4);
  vec3 cell = mix(inside, vec3(0.86, 0.6, 0.58), mem * 0.85);
  cell = mix(cell, vec3(0.45, 0.28, 0.42), (1.0 - smoothstep(0.0, 0.03, v.y - v.x)) * step(0.82, hh(floor(p / 0.075))) * 0.6);
  c = mix(c, cell, f);
#elif HIST_PATTERN == 9
  // Septa and fascia: dense wavy collagen.
  f = histFade(px, 0.012);
  float n = vn(p * vec3(60.0, 160.0, 60.0) + 2.0 * vn(p * 20.0));
  c *= 0.92 + 0.16 * smoothstep(0.3, 0.7, n) * f;
  c = mix(c, vec3(0.97, 0.94, 0.95), (1.0 - smoothstep(0.0, 0.04, abs(n - 0.5))) * 0.4 * f);
#elif HIST_PATTERN == 10
  // Smooth muscle: spindle cells with cigar-shaped nuclei.
  f = histFade(px, 0.008);
  vec2 v = vor(p * vec3(70.0, 70.0, 70.0));
  float nuc = 1.0 - smoothstep(0.12, 0.2, v.x);
  c *= 0.94 + 0.12 * vn(p * 300.0) * f;
  c = mix(c, vec3(0.38, 0.18, 0.32), nuc * 0.55 * f);
#elif HIST_PATTERN == 11
  // Sebaceous gland: large foamy sebocytes with small central nuclei.
  f = histFade(px, 0.02);
  vec2 v = vor(p / 0.022);
  float edge = 1.0 - smoothstep(0.0, 0.08, v.y - v.x);
  float foam = smoothstep(0.35, 0.7, vn(p * 700.0));
  c = mix(c, vec3(1.0, 0.98, 0.93), foam * 0.35 * f);
  c = mix(c, vec3(0.78, 0.58, 0.55), edge * 0.6 * f);
  c = mix(c, vec3(0.42, 0.26, 0.42), (1.0 - smoothstep(0.08, 0.14, v.x)) * 0.6 * f);
#elif HIST_PATTERN == 12
  // Gland epithelium: cuboidal cells with round nuclei.
  f = histFade(px, 0.008);
  vec2 v = vor(p / 0.009);
  c = mix(c, vec3(0.38, 0.2, 0.38), (1.0 - smoothstep(0.18, 0.26, v.x)) * 0.5 * f);
  c = mix(c, c * 1.12, (1.0 - smoothstep(0.0, 0.1, v.y - v.x)) * 0.4 * f);
#elif HIST_PATTERN == 13
  // Nerve: wavy fascicles.
  f = histFade(px, 0.008);
  float n = vn(p * vec3(90.0, 260.0, 90.0) + 3.0 * vn(p * 25.0));
  c *= 0.93 + 0.14 * smoothstep(0.35, 0.65, n) * f;
#endif
  return c;
}
`;

/**
 * Adds the histology pattern to a material (chained after any existing onBeforeCompile). `on` is a
 * per-material uniform so the Layers colour mode can switch it off without recompiling.
 */
export function addHistology(material: THREE.Material, pattern: Pattern, key: string): { uHistOn: { value: number } } {
  const on = { uHistOn: { value: 1 } };
  if (pattern === 'none') return on;
  const prev = material.onBeforeCompile;
  material.defines = { ...(material.defines ?? {}), HIST_PATTERN: CODE[pattern] };
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, histologyUniforms, on);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHistPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHistPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}`)
      .replace('#include <color_fragment>', [
        '#include <color_fragment>',
        'if (uHistOn > 0.5) {',
        '  vec3 hp = vHistPos * uHistScale;',
        '  float hpx = length(fwidth(hp)) * 0.7;',
        '  diffuseColor.rgb = histology(diffuseColor.rgb, hp, hpx);',
        '}',
      ].join('\n'));
  };
  const prevKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${prevKey()}-hist-${pattern}-${key}`;
  return on;
}
