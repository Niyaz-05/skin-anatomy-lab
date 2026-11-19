/**
 * Simulation effects on the block's tissue materials, all in the shader so the model's geometry
 * (and the 8 MB budget) is untouched and nothing recompiles while a simulation runs:
 * - per material: a tint (optionally only above a depth), an added glow, and an inflation along
 *   the normal (vessels dilating or constricting, a contracting arrector pili, thinning collagen);
 * - shared: a wound notch cut out of every tissue, a goosebump around the hair's exit, the ageing
 *   remap of depth (thinner epidermis, flatter dermal–epidermal junction, thinner dermis), and the
 *   skin-coloured top surface with fine creases.
 * Values are written every frame by SimEffects; defaults leave the tissue exactly as modelled.
 */
import * as THREE from 'three';

export const fxShared = {
  /** Wound notch: centre x, half-width at the surface, depth (world units) and profile exponent. */
  uWound: { value: new THREE.Vector4(0, 0, 0, 1) },
  uWoundOn: { value: 0 },
  /** Goosebump: centre x, z, height and radius (world units). */
  uBump: { value: new THREE.Vector4(0, 0, 0, 0.0035) },
  /** Ageing depth remap: scale of the top band, scale of the dermis, band depth, dermis depth (world). */
  uAge: { value: new THREE.Vector4(1, 1, 0.0025, 0.02) },
  /** Skin colour of the top surface. */
  uSurf: { value: new THREE.Color('#d9a68c') },
  uSurfOn: { value: 1 },
};

export interface FxUniforms {
  uFxTint: { value: THREE.Vector4 };
  uFxTintFloor: { value: number };
  uFxGlow: { value: THREE.Color };
  uFxInflate: { value: number };
  uFxWoundable: { value: number };
}

export function makeFxUniforms(): FxUniforms {
  return {
    uFxTint: { value: new THREE.Vector4(1, 1, 1, 0) },
    uFxTintFloor: { value: -1e9 },
    uFxGlow: { value: new THREE.Color(0, 0, 0) },
    uFxInflate: { value: 0 },
    uFxWoundable: { value: 1 },
  };
}

/** Put every effect back to "as modelled". */
export function resetFx(u: FxUniforms) {
  u.uFxTint.value.set(1, 1, 1, 0);
  u.uFxTintFloor.value = -1e9;
  u.uFxGlow.value.setRGB(0, 0, 0);
  u.uFxInflate.value = 0;
  u.uFxWoundable.value = 1;
}

const VERT_DECL = /* glsl */ `
uniform vec4 uWound; uniform vec4 uBump; uniform vec4 uAge; uniform float uFxInflate;
varying vec3 vFxPos; varying vec3 vFxN;
`;
const VERT_BODY = /* glsl */ `
{
  #ifdef USE_INSTANCING
    mat4 fxM = modelMatrix * instanceMatrix;
  #else
    mat4 fxM = modelMatrix;
  #endif
  transformed += objectNormal * uFxInflate;
  vec3 fxW = (fxM * vec4(transformed, 1.0)).xyz;
  float fxY = fxW.y;
  // Ageing: compress the top band (epidermis and papillae) and the dermis.
  float fxD = -fxY;
  if (fxD > 0.0) {
    float d1 = uAge.z, d2 = uAge.w;
    float nd = fxD < d1 ? fxD * uAge.x : fxD < d2 ? d1 * uAge.x + (fxD - d1) * uAge.y : d1 * uAge.x + (d2 - d1) * uAge.y + (fxD - d2);
    fxY = -nd;
  }
  // Goosebump around the hair's exit, fading with depth.
  vec2 fxR = fxW.xz - uBump.xy;
  fxY += uBump.z * exp(-dot(fxR, fxR) / (uBump.w * uBump.w)) * smoothstep(-0.012, -0.002, fxW.y);
  transformed.y += fxY - fxW.y;
  vFxPos = vec3(fxW.x, fxY, fxW.z);
  vFxN = normalize(mat3(fxM) * objectNormal);
}
`;
const FRAG_DECL = /* glsl */ `
uniform vec4 uWound; uniform float uWoundOn; uniform vec3 uSurf; uniform float uSurfOn;
uniform vec4 uFxTint; uniform float uFxTintFloor; uniform vec3 uFxGlow; uniform float uFxWoundable;
varying vec3 vFxPos; varying vec3 vFxN;
`;
const FRAG_DISCARD = /* glsl */ `
if (uWoundOn > 0.5 && uFxWoundable > 0.5 && vFxPos.y > -uWound.z && vFxPos.y < 0.0008) {
  float fxT = clamp((uWound.z + min(vFxPos.y, 0.0)) / uWound.z, 0.0, 1.0);
  if (abs(vFxPos.x - uWound.x) < uWound.y * pow(fxT, uWound.w)) discard;
}
`;
const FRAG_COLOUR = /* glsl */ `
#ifdef FX_SURFACE
if (uSurfOn > 0.5 && vFxN.y > 0.55 && vFxPos.y > -0.0006) {
  vec3 sp = vFxPos * 100.0; // mm
  float spx = length(fwidth(sp));
  vec3 sc = uSurf;
  if (sp.x < 0.6) {
    // Thin skin: the polygonal network of skin furrows, with finer secondary lines.
    vec2 v1 = vor(vec3(sp.x, 0.0, sp.z) / 0.42);
    vec2 v2 = vor(vec3(sp.x, 3.0, sp.z) / 0.16);
    float f1 = clamp(1.6 - spx * 2.0 / 0.42, 0.0, 1.0), f2 = clamp(1.6 - spx * 2.0 / 0.16, 0.0, 1.0);
    float crease = (1.0 - smoothstep(0.0, 0.07, v1.y - v1.x)) * f1;
    float fine = (1.0 - smoothstep(0.0, 0.08, v2.y - v2.x)) * f2;
    sc *= 1.0 - 0.32 * crease - 0.12 * fine;
    sc *= 1.0 + 0.06 * (vn(sp * 9.0) - 0.5) * f2;
  } else {
    // Thick skin: friction ridges (in the geometry) with a fine glabrous texture.
    sc *= 0.97 + 0.06 * vn(sp * 14.0);
  }
  diffuseColor.rgb = sc * tissueAO;
}
#endif
if (vFxPos.y > uFxTintFloor) diffuseColor.rgb = mix(diffuseColor.rgb, uFxTint.rgb, uFxTint.a);
`;

/** Adds the simulation effects to a block material (chained after the tissue and histology shaders). */
export function addSimFx(material: THREE.Material, surface: boolean): FxUniforms {
  const u = makeFxUniforms();
  const prev = material.onBeforeCompile;
  if (surface) material.defines = { ...(material.defines ?? {}), FX_SURFACE: '' };
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, fxShared, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_DISCARD}`)
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>\n${FRAG_COLOUR}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uFxGlow;');
  };
  const prevKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${prevKey()}-fx${surface ? 's' : ''}`;
  return u;
}
