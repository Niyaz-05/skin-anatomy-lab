/**
 * The 3D side of the simulation modes. `SimEffects` rewrites every simulation effect each frame from
 * the lab state (so leaving a mode always restores the tissue); the other components add the
 * objects a mode needs: sweat drops, the wound's fill and its cells, blister fluid, the two-point
 * sites on the body, live body temperature, and point labels.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useLab } from '../app/LabContext';
import { effectiveColourBy, effectiveMode, effectiveSim, effectiveView, type Sim } from '../app/state';
import { thermoLive } from '../app/live';
import {
  WOUND_SHAPE, erythemaLevel, melaninLevel, pulseHz, rng, skinTone, spikeTimes, sweatDropsPerS, vesselDilation, woundFill,
} from '../app/visual';
import { anchors, BLOCK_SCALE, toWorld } from '../skin/anchors';
import { dosesInMed, relativeCollagen } from '../skin/photo';
import { phaseActivity, woundStateOnDay } from '../skin/wounds';
import {
  MECHANORECEPTORS, STEP_RESPONSE, TWO_POINT_THRESHOLD_MM, stepResponse, thermalSensation, vibrationResponse, type BodySiteId,
} from '../skin/sensation';
import { fxShared, resetFx } from './simfx';
import { bodyMesh, clip, fxParts } from './SkinModel';
import { findSites, thermalPaint } from './bodyPaint';
import { PointLabels, type PointLabel } from './PointLabels';

const MM = BLOCK_SCALE;
const W = (p: readonly number[]) => new THREE.Vector3(...toWorld(p, 'block'));
const col = (h: string) => new THREE.Color(h);
const SURFACE_BASE = col('#d9a68c');

/** Shared clock for the touch animations (set by the Touch panel's "Press" button). */
export const touchAnim = { pressAt: -1e9 };
/** The pressure step played by "Press", ms: on at 200, off at 700, over 1 s. */
export const PRESS = { onMs: 200, offMs: 700, durationMs: 1000 };
export const MAX_RATE_HZ: Record<string, number> = { 'meissner-corpuscle': 160, 'pacinian-corpuscle': 260, 'hair-follicle-plexus': 120, 'merkel-discs': 140, 'ruffini-ending': 90 };

const FOLLICLE_PARTS = ['hair-shaft', 'inner-root-sheath', 'hair-follicle', 'hair-bulb', 'hair-papilla', 'sebaceous-gland', 'hair-follicle-plexus'];
const EPIDERMIS = ['stratum-corneum', 'stratum-lucidum', 'stratum-granulosum', 'stratum-spinosum', 'stratum-basale', 'melanocytes', 'langerhans-cells', 'merkel-discs'];

/** How far the hair turns towards upright at full piloerection (fraction of its lean). */
const PILO_TURN = 0.55;

function tint(id: string, hex: string, amount: number, floorMm?: number) {
  const p = fxParts.get(id);
  if (!p || amount <= 0) return;
  const c = col(hex);
  const t = p.fx.uFxTint.value;
  // Two tints on one part blend: the stronger wins most of the colour.
  if (t.w > 0) { const k = amount / (amount + t.w); t.set(t.x + (c.r - t.x) * k, t.y + (c.g - t.y) * k, t.z + (c.b - t.z) * k, Math.min(0.95, Math.max(t.w, amount))); }
  else t.set(c.r, c.g, c.b, Math.min(0.95, amount));
  if (floorMm !== undefined) p.fx.uFxTintFloor.value = floorMm * MM;
}
const glow = (id: string, hex: string, k: number) => { const p = fxParts.get(id); if (p && k > 0) p.fx.uFxGlow.value.add(col(hex).multiplyScalar(k)); };
const inflate = (id: string, mm: number) => { const p = fxParts.get(id); if (p) p.fx.uFxInflate.value += mm * MM; };

/** Rotate the hair follicle unit about the hair's exit towards upright, and swing the arrector pili after it. */
function setPiloerection(pilo: number) {
  const exit = W(anchors['hair-exit']);
  const [bulb] = anchors['follicle-axis'];
  const dir = W(bulb).sub(exit).normalize();
  const target = dir.clone().lerp(new THREE.Vector3(0, -1, 0), PILO_TURN * pilo).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(dir, target);
  for (const id of FOLLICLE_PARTS) {
    const m = fxParts.get(id)?.mesh;
    if (!m) continue;
    m.quaternion.copy(q);
    m.position.copy(exit).sub(exit.clone().applyQuaternion(q));
  }
  const m = fxParts.get('arrector-pili')?.mesh;
  if (m) {
    const dermal = W(anchors['arrector-insertion']), onFollicle = W(anchors['arrector-origin']);
    const moved = onFollicle.clone().sub(exit).applyQuaternion(q).add(exit);
    const qa = new THREE.Quaternion().setFromUnitVectors(onFollicle.clone().sub(dermal).normalize(), moved.clone().sub(dermal).normalize());
    m.quaternion.copy(qa);
    m.position.copy(dermal).sub(dermal.clone().applyQuaternion(qa));
  }
}

/**
 * Writes all simulation effects every frame: vessels, sweat glands, goosebumps (Temperature); the
 * wound notch, inflammation and burn depth (Wounds); receptor activity (Touch); melanin, erythema,
 * ageing and disorders (Life).
 */
export function SimEffects({ reducedMotion }: { reducedMotion: boolean }) {
  const { def, state } = useLab();
  const mode = effectiveMode(def, state);
  const sim = effectiveSim(def, state);
  const view = effectiveView(def, state);
  const colourBy = effectiveColourBy(def, state);
  const latest = useRef({ mode, sim, view, colourBy, playing: state.playing, reducedMotion });
  latest.current = { mode, sim, view, colourBy, playing: state.playing, reducedMotion };

  useEffect(() => () => {
    // Leaving the lab view: put everything back.
    fxParts.forEach((p) => { resetFx(p.fx); p.mesh.position.set(0, 0, 0); p.mesh.quaternion.identity(); });
    fxShared.uWoundOn.value = 0; fxShared.uBump.value.z = 0; fxShared.uAge.value.set(1, 1, 0.0025, 0.02);
  }, []);

  useFrame(() => {
    const { mode, sim, colourBy, playing, reducedMotion } = latest.current;
    const now = performance.now() / 1000;
    const pulse = (hz: number) => (reducedMotion || !playing ? 1 : 0.55 + 0.45 * Math.sin(2 * Math.PI * hz * now));
    fxParts.forEach((p) => { resetFx(p.fx); p.mesh.position.set(0, 0, 0); p.mesh.quaternion.identity(); });
    fxShared.uWoundOn.value = 0;
    fxShared.uBump.value.z = 0;
    fxShared.uAge.value.set(1, 1, 0.25 * MM, 2.0 * MM);
    fxShared.uSurfOn.value = colourBy === 'real' ? 1 : 0;
    const surf = fxShared.uSurf.value.copy(SURFACE_BASE);
    let pilo = 0;

    if (mode === 'temperature') {
      const b = thermoLive.balance;
      const dil = vesselDilation(b.skinBloodFlowLpm);
      pilo = b.piloerection;
      for (const [id, k] of [['superficial-plexus', 1], ['deep-plexus', 0.6]] as const) {
        inflate(id, dil > 0 ? 0.014 * dil * k : 0.006 * dil * k);
        if (dil > 0) { tint(id, '#ff2a1e', 0.3 * dil); glow(id, '#ff2a1e', 0.22 * dil); }
        else tint(id, '#d8c2c4', 0.55 * -dil);
      }
      if (dil > 0) tint('papillary-dermis', '#e8584c', 0.22 * dil); else tint('papillary-dermis', '#f1e6e2', 0.35 * -dil);
      surf.lerp(dil > 0 ? col('#e27d68') : col('#e4d2cc'), Math.abs(dil) * 0.55);
      if (b.shiveringW > 20) surf.lerp(col('#c9c4d6'), Math.min(0.25, b.shiveringW / 800));
      inflate('arrector-pili', 0.01 * pilo);
      tint('arrector-pili', '#b23a2c', 0.35 * pilo);
      const exit = anchors['hair-exit'];
      fxShared.uBump.value.set(exit[0]! * MM, exit[2]! * MM, 0.055 * MM * pilo, 0.38 * MM);
      const sweat = Math.min(1, b.sweatLph / 1.2);
      if (sweat > 0.02) glow('eccrine-gland', '#3aa0ff', 0.35 * sweat * pulse(1.2));
    }

    if (mode === 'wounds' && sim.woundView === 'healing') {
      const shape = WOUND_SHAPE[sim.woundType];
      const fill = woundFill(sim.day, sim.woundType, sim.factors);
      fxShared.uWoundOn.value = 1;
      fxShared.uWound.value.set(shape.x0 * MM, shape.halfWidth * fill.gap * MM, shape.depth * MM, shape.exponent);
      if (sim.woundType === 'graze') for (const id of ['hair-shaft', 'inner-root-sheath', 'hair-follicle', 'eccrine-gland']) { const p = fxParts.get(id); if (p) p.fx.uFxWoundable.value = 0; }
      const infl = phaseActivity(sim.day, sim.woundType).inflammation;
      tint('papillary-dermis', '#e4544a', 0.25 * infl);
      inflate('superficial-plexus', 0.01 * infl);
      glow('superficial-plexus', '#ff2a1e', 0.15 * infl);
    }

    if (mode === 'wounds' && sim.woundView === 'burns') {
      const d = sim.burnDepth;
      const epi = EPIDERMIS.filter((x) => x !== 'merkel-discs');
      if (d === 'superficial') {
        epi.forEach((id) => tint(id, '#e0645a', 0.3));
        tint('papillary-dermis', '#e04a44', 0.4); inflate('superficial-plexus', 0.012); glow('superficial-plexus', '#ff3020', 0.2);
        surf.lerp(col('#e0645a'), 0.6);
      } else if (d === 'superficial-partial' || d === 'deep-partial') {
        const lift = d === 'superficial-partial' ? 0.24 : 0.16;
        for (const id of EPIDERMIS) { const m = fxParts.get(id)?.mesh; if (m) m.position.y = lift * MM; }
        epi.forEach((id) => tint(id, '#f2d6c8', 0.35));
        surf.lerp(col('#f0c8b8'), 0.5);
        if (d === 'superficial-partial') { tint('papillary-dermis', '#ee6a62', 0.5); inflate('superficial-plexus', 0.01); glow('superficial-plexus', '#ff3020', 0.15); }
        else {
          tint('papillary-dermis', '#efe2da', 0.6); tint('reticular-dermis', '#c8645c', 0.4, -1.2); tint('superficial-plexus', '#5a1a14', 0.7);
          ['meissner-corpuscle', 'free-nerve-endings'].forEach((id) => tint(id, '#8a8078', 0.6));
        }
      } else {
        const full = d === 'full-thickness';
        epi.forEach((id) => tint(id, full ? '#8a5a38' : '#1e1612', full ? 0.75 : 0.92));
        surf.copy(col(full ? '#7a5034' : '#1a1410'));
        tint('papillary-dermis', full ? '#f2ecd8' : '#2a1e18', 0.85); tint('reticular-dermis', full ? '#efe6cc' : '#3a2a20', 0.8); tint('collagen-bundles', '#e8dcc0', 0.7);
        ['superficial-plexus', 'deep-plexus'].forEach((id) => tint(id, '#4a1c12', 0.85));
        ['hair-follicle', 'hair-bulb', 'sebaceous-gland', 'eccrine-gland', 'apocrine-gland', 'arrector-pili', 'meissner-corpuscle', 'ruffini-ending', 'free-nerve-endings', 'hair-follicle-plexus', 'cutaneous-nerve', 'lymphatic-vessels', 'hair-papilla', 'inner-root-sheath', 'merkel-discs']
          .forEach((id) => tint(id, '#8c8580', 0.7));
        tint('subcutaneous-fat', full ? '#d8b070' : '#5a3a1e', full ? 0.35 : 0.7, full ? -2.6 : undefined);
        if (!full) { tint('fibrous-septa', '#4a3022', 0.7); tint('deep-fascia', '#2a1e18', 0.6); tint('pacinian-corpuscle', '#5a4a40', 0.7); }
      }
    }

    if (mode === 'touch') {
      const tv = sim.touchView;
      if (tv === 'receptors') { tint(sim.receptor, '#ff9a10', 0.5); glow(sim.receptor, '#ff8a00', 0.8 * pulse(1)); }
      if (tv === 'vibration') for (const r of MECHANORECEPTORS) { const v = vibrationResponse(r, sim.vibHz, sim.vibUm); tint(r, '#ff9a10', 0.7 * v); glow(r, '#ff8a00', 1.1 * v * pulse(pulseHz(sim.vibHz))); }
      if (tv === 'pressure') {
        const t = (performance.now() - touchAnim.pressAt);
        if (t >= 0 && t < PRESS.durationMs * 1.4) for (const r of Object.keys(STEP_RESPONSE)) {
          const rate = stepResponse(r as keyof typeof STEP_RESPONSE, t, PRESS);
          tint(r, '#ff9a10', 0.7 * rate); glow(r, '#ff8a00', 1.2 * rate);
        }
      }
      if (tv === 'thermal') {
        const s = thermalSensation(sim.thermalC);
        const k = Math.min(1, Math.abs(sim.thermalC - 33) / 18);
        if (s !== 'neutral') glow('free-nerve-endings', sim.thermalC < 33 ? '#3a8bff' : '#ff4a2a', (0.25 + 0.6 * k) * pulse(s === 'heat-pain' || s === 'noxious-cold' ? 2.5 : 1));
        if (sim.thermalC >= 43) tint('free-nerve-endings', '#ff4a2a', 0.5);
        else if (sim.thermalC < 25) tint('free-nerve-endings', '#3a8bff', 0.5);
      }
    }

    if (mode === 'life') {
      if (sim.lifeView === 'sun') {
        const med = dosesInMed(sim.phototype, sim.uvIndex, sim.sunMinutes, sim.spf);
        const mel = melaninLevel(sim.phototype), ery = erythemaLevel(med);
        tint('stratum-basale', '#3a1e10', 0.1 + 0.65 * mel);
        tint('melanocytes', '#1e0e06', 0.3 + 0.6 * mel);
        tint('stratum-spinosum', '#8a5a3a', 0.45 * mel);
        tint('stratum-granulosum', '#7a5040', 0.3 * mel);
        tint('papillary-dermis', '#e03e3a', 0.5 * ery);
        inflate('superficial-plexus', 0.012 * ery); glow('superficial-plexus', '#ff2a1e', 0.25 * ery);
        surf.copy(col(skinTone(sim.phototype, med)));
      }
      if (sim.lifeView === 'age') {
        const t = Math.min(1, Math.max(0, (sim.age - 20) / 70));
        fxShared.uAge.value.set(1 - 0.45 * t, 1 - 0.3 * t, 0.25 * MM, 2.0 * MM);
        inflate('collagen-bundles', -0.022 * ((1 - relativeCollagen(sim.age)) / 0.7));
        tint('reticular-dermis', '#f2e2e0', 0.3 * t);
        tint('collagen-bundles', '#ffffff', 0.25 * t);
        if (sim.photoaged) {
          tint('papillary-dermis', '#d8c890', 0.55 * t); tint('reticular-dermis', '#d4c494', 0.45 * t, -0.9);
          tint('stratum-basale', '#4a2a16', 0.4 * t);
          surf.lerp(col('#c8a070'), 0.35 * t);
        } else surf.lerp(col('#ead6cc'), 0.3 * t);
      }
      if (sim.lifeView === 'disorders') {
        switch (sim.disorder) {
          case 'acne': inflate('sebaceous-gland', 0.035); tint('sebaceous-gland', '#f6e08a', 0.4); tint('hair-follicle', '#d8584a', 0.35); break;
          case 'atopic-eczema': tint('stratum-corneum', '#d8d0c8', 0.5); tint('stratum-spinosum', '#e07a6a', 0.3); tint('papillary-dermis', '#e66a5e', 0.3); surf.lerp(col('#d27a6a'), 0.45); break;
          case 'psoriasis': tint('stratum-corneum', '#eef0f2', 0.75); tint('papillary-dermis', '#e04a44', 0.45); inflate('superficial-plexus', 0.012); surf.copy(col('#e8e4e2')); break;
          case 'vitiligo': tint('stratum-basale', '#f4dccc', 0.7); tint('stratum-spinosum', '#f6e4d8', 0.4); surf.copy(col('#f6e2d8')); break;
          case 'basal-cell-carcinoma': tint('stratum-basale', '#5a4aa0', 0.55); tint('papillary-dermis', '#9a88c8', 0.35); surf.lerp(col('#e8c8c0'), 0.4); break;
          case 'squamous-cell-carcinoma': tint('stratum-spinosum', '#d89a8a', 0.5); tint('stratum-corneum', '#d8b070', 0.55); surf.lerp(col('#c89070'), 0.5); break;
          case 'melanoma': tint('melanocytes', '#0a0606', 0.9); tint('stratum-basale', '#2a160c', 0.6); tint('papillary-dermis', '#5a3020', 0.4, -0.8); surf.copy(col('#3a2418')); break;
        }
      }
    }
    setPiloerection(pilo);
  });
  return null;
}

// ---------------------------------------------------------------------------------------------
// Temperature
// ---------------------------------------------------------------------------------------------

const DROPS_PER_GLAND = 10;
/** Sweat in the ducts, beads at the pores and vapour leaving them (drops drawn ~10× too large). */
export function SweatScene() {
  const glands = useMemo(() => {
    const coils = anchors['sweat-coils'];
    return anchors['sweat-pore'].map((pore) => {
      const coil = coils.find((c) => c.gland === pore.gland)!;
      const junction = anchors['layer-heights'][pore.thick ? 'thick' : 'thin']['dermal-junction']!;
      return { a: W(coil.p), b: W([pore.p[0], junction, pore.p[2]]), c: W(pore.p) };
    });
  }, []);
  const n = glands.length;
  const { drops, beads, vapour } = useMemo(() => {
    const sphere = new THREE.SphereGeometry(1, 10, 8);
    const drops = new THREE.InstancedMesh(sphere, new THREE.MeshStandardMaterial({ color: '#5fb4f0', roughness: 0.15, metalness: 0, emissive: '#1e5a90', emissiveIntensity: 0.4 }), n * DROPS_PER_GLAND);
    const beads = new THREE.InstancedMesh(sphere, new THREE.MeshPhysicalMaterial({ color: '#cfe8fa', roughness: 0.05, transmission: 0, transparent: true, opacity: 0.85, clearcoat: 1 }), n);
    const vapour = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false }), n * 6);
    for (const m of [drops, beads, vapour]) { m.frustumCulled = false; m.raycast = () => {}; m.renderOrder = 4; }
    return { drops, beads, vapour };
  }, [n]);
  useEffect(() => () => { drops.geometry.dispose(); (drops.material as THREE.Material).dispose(); (beads.material as THREE.Material).dispose(); (vapour.material as THREE.Material).dispose(); }, [drops, beads, vapour]);
  const t = useRef(0);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const b = thermoLive.balance;
    const rate = sweatDropsPerS(b.sweatLph);
    t.current += Math.min(0.1, dt) * Math.max(0.15, rate * 0.12);
    const zero = m4.makeScale(0, 0, 0);
    glands.forEach((g, gi) => {
      const lenA = g.a.distanceTo(g.b), lenB = g.b.distanceTo(g.c), len = lenA + lenB;
      for (let k = 0; k < DROPS_PER_GLAND; k++) {
        const i = gi * DROPS_PER_GLAND + k;
        if (rate <= 0) { drops.setMatrixAt(i, zero); continue; }
        const u = (t.current * 1.2 + k / DROPS_PER_GLAND + gi * 0.13) % 1;
        const s = u * len;
        if (s < lenA) v.lerpVectors(g.a, g.b, s / lenA); else v.lerpVectors(g.b, g.c, (s - lenA) / lenB);
        drops.setMatrixAt(i, m4.makeScale(0.028 * MM, 0.028 * MM, 0.028 * MM).setPosition(v));
      }
      const bead = rate > 0 ? (0.05 + 0.1 * Math.min(1, b.wettedness + b.drippingLph)) * MM : 0;
      beads.setMatrixAt(gi, m4.makeScale(bead, bead * 0.6, bead).setPosition(g.c.x, g.c.y + bead * 0.3, g.c.z));
      const evap = rate > 0 ? Math.min(1, b.routes.evaporationW / 300) : 0;
      for (let k = 0; k < 6; k++) {
        const u = (t.current * 0.7 + k / 6 + gi * 0.21) % 1;
        const r = evap > 0.02 ? (0.03 + 0.05 * u) * MM * evap : 0;
        vapour.setMatrixAt(gi * 6 + k, m4.makeScale(r, r, r).setPosition(g.c.x + Math.sin(u * 9 + k) * 0.08 * MM, g.c.y + (0.08 + u * 0.7) * MM, g.c.z + Math.cos(u * 7 + k) * 0.08 * MM));
      }
    });
    drops.instanceMatrix.needsUpdate = beads.instanceMatrix.needsUpdate = vapour.instanceMatrix.needsUpdate = true;
  });
  return <group><primitive object={drops} /><primitive object={beads} /><primitive object={vapour} /></group>;
}

/** Skin temperature painted on the body, repainted as the simulation runs. */
export function BodyThermalScene() {
  const invalidate = useThree((s) => s.invalidate);
  const last = useRef('');
  useFrame(() => {
    const m = bodyMesh.current;
    if (!m) return;
    const b = thermoLive.balance, s = thermoLive.state;
    const dil = vesselDilation(b.skinBloodFlowLpm);
    const key = `${s.skinC.toFixed(2)}|${s.coreC.toFixed(2)}|${dil.toFixed(2)}`;
    if (key === last.current) return;
    last.current = key;
    const g = m.geometry;
    const a = g.userData.thermal as THREE.BufferAttribute | undefined;
    if (!a) return;
    thermalPaint(g, s.skinC, s.coreC, dil, a.array as Float32Array);
    a.needsUpdate = true;
    invalidate();
  });
  return null;
}

// ---------------------------------------------------------------------------------------------
// Wounds
// ---------------------------------------------------------------------------------------------

const FILL_FRAG = /* glsl */ `
uniform float uX0; uniform float uHW; uniform float uDepth; uniform float uGran; uniform float uClot; uniform float uEpi; uniform float uScar; uniform float uGraze;
uniform vec3 uIsland0; uniform vec3 uIsland1;
varying vec3 vWP;
float fh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fh(i), fh(i + vec3(1,0,0)), f.x), mix(fh(i + vec3(0,1,0)), fh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fh(i + vec3(0,0,1)), fh(i + vec3(1,0,1)), f.x), mix(fh(i + vec3(0,1,1)), fh(i + vec3(1,1,1)), f.x), f.y), f.z); }
vec3 woundColour(vec3 p) {
  float d = -p.y;
  float lat = abs(p.x - uX0) / max(uHW, 0.001);
  float granTop = uDepth * (1.0 - uGran);
  vec3 clot = mix(vec3(0.42, 0.05, 0.06), vec3(0.36, 0.14, 0.07), uGraze);
  float gn = fn(p * 55.0);
  vec3 gran = vec3(0.84, 0.24, 0.3) * (0.82 + 0.3 * gn);
  vec3 scar = vec3(0.94, 0.84, 0.82) * (0.94 + 0.08 * sin(p.y * 160.0 + 2.0 * fn(p * 8.0)));
  vec3 c = d > granTop ? mix(gran, scar, uScar) : clot;
  // New epidermis creeps in from the edges (and, in a graze, from the follicle and sweat duct openings).
  float covered = step(1.0 - uEpi, lat);
  if (uGraze > 0.5) {
    covered = max(covered, step(distance(p.xz, uIsland0.xy), uEpi * 1.3));
    covered = max(covered, step(distance(p.xz, uIsland1.xy), uEpi * 1.1));
  }
  float epiT = mix(0.09, 0.07, uScar);
  if (covered > 0.5 && d < epiT) c = d > epiT - 0.018 ? vec3(0.66, 0.42, 0.33) : vec3(0.9, 0.7, 0.6);
  else if (covered < 0.5 && d < 0.05 && uClot > 0.05) c = mix(c, clot * 0.85, 0.9);
  return c;
}
`;

function fillGeometry(type: keyof typeof WOUND_SHAPE, gap: number): THREE.BufferGeometry {
  const s = WOUND_SHAPE[type];
  const shape = new THREE.Shape();
  const N = 24;
  const hw = (y: number) => s.halfWidth * gap * Math.pow(Math.max(0, (s.depth + y) / s.depth), s.exponent);
  shape.moveTo(s.x0 - hw(0), 0);
  for (let i = 1; i <= N; i++) { const y = -s.depth * (i / N); shape.lineTo(s.x0 - Math.max(0.004, hw(y)), y); }
  for (let i = N; i >= 0; i--) { const y = -s.depth * (i / N); shape.lineTo(s.x0 + Math.max(0.004, hw(y)), y); }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -2);
  g.scale(MM, MM, MM);
  return g;
}

const CELL_TYPES = [
  { id: 'platelets', colour: '#b98ad8', size: 0.55 },
  { id: 'neutrophils', colour: '#3f74e0', size: 1 },
  { id: 'macrophages', colour: '#e6a01e', size: 1.5 },
  { id: 'fibroblasts', colour: '#2fae7a', size: 1.15 },
  { id: 'keratinocytes', colour: '#f07a96', size: 1.1 },
] as const;
export const WOUND_CELLS = CELL_TYPES;

/** The wound's fill (clot → granulation → new epidermis → scar) and its cells, on the block's front face. */
export function WoundScene({ sim, labels }: { sim: Sim; labels: RefObject<HTMLDivElement | null> }) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const fill = woundFill(sim.day, sim.woundType, sim.factors);
  const shape = WOUND_SHAPE[sim.woundType];
  const gapKey = Math.round(fill.gap * 50) / 50;
  const geometry = useMemo(() => fillGeometry(sim.woundType, gapKey), [sim.woundType, gapKey]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const uniforms = useMemo(() => ({
    uX0: { value: 0 }, uHW: { value: 0 }, uDepth: { value: 1 }, uGran: { value: 0 }, uClot: { value: 1 }, uEpi: { value: 0 }, uScar: { value: 0 }, uGraze: { value: 0 },
    uIsland0: { value: new THREE.Vector3(anchors['hair-exit'][0], anchors['hair-exit'][2], 0) },
    uIsland1: { value: new THREE.Vector3(anchors['sweat-pore'][0]!.p[0], anchors['sweat-pore'][0]!.p[2], 0) },
  }), []);
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, clippingPlanes: [clip.plane] });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz * 100.0;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${FILL_FRAG}`).replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = woundColour(vWP);');
    };
    return m;
  }, [uniforms]);
  useEffect(() => () => material.dispose(), [material]);
  uniforms.uX0.value = shape.x0;
  uniforms.uHW.value = shape.halfWidth * fill.gap;
  uniforms.uDepth.value = shape.depth;
  uniforms.uGran.value = fill.granulation;
  uniforms.uClot.value = fill.clot;
  uniforms.uEpi.value = fill.epithelium;
  uniforms.uScar.value = fill.scar;
  uniforms.uGraze.value = sim.woundType === 'graze' ? 1 : 0;

  // Cells on the front face, inside the notch.
  const COUNT = 900;
  const points = useMemo(() => {
    const r = rng(11);
    const pos = new Float32Array(COUNT * 3), type = new Float32Array(COUNT), thr = new Float32Array(COUNT), u = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const t = Math.floor(r() * CELL_TYPES.length);
      // Keratinocytes stay near the surface; fibroblasts deeper.
      const yFrac = t === 4 ? r() * 0.12 : t === 3 ? 0.15 + r() * 0.85 : r();
      pos.set([0, -yFrac, 2.012], i * 3);
      u[i] = r() * 2 - 1; type[i] = t; thr[i] = 0.08 + r() * 0.92;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aType', new THREE.BufferAttribute(type, 1));
    g.setAttribute('aThr', new THREE.BufferAttribute(thr, 1));
    g.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAct: { value: [0, 0, 0, 0, 0] }, uShape: { value: new THREE.Vector4() }, uScale: { value: 400 }, uCol: { value: CELL_TYPES.map((c) => col(c.colour)) }, uSize: { value: CELL_TYPES.map((c) => c.size) } },
      vertexShader: /* glsl */ `
        attribute float aType; attribute float aThr; attribute float aU;
        uniform float uAct[5]; uniform vec4 uShape; uniform float uScale; uniform vec3 uCol[5]; uniform float uSize[5];
        varying vec3 vC;
        void main() {
          int t = int(aType + 0.5);
          float depth = uShape.z, hw0 = uShape.y;
          float y = position.y * depth;
          float hw = hw0 * pow(clamp((depth + y) / depth, 0.0, 1.0), uShape.w);
          vec3 p = vec3(uShape.x + aU * hw * 0.92, y, position.z) * 0.01;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float on = uAct[t] > aThr ? 1.0 : 0.0;
          gl_PointSize = on * uSize[t] * 0.00042 * uScale / -mv.z;
          vC = uCol[t];
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC;
        void main() {
          vec2 q = gl_PointCoord - 0.5; float r = length(q);
          if (r > 0.5) discard;
          vec3 c = r > 0.36 ? vC * 0.55 : vC * (1.05 - r);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.raycast = () => {};
    pts.renderOrder = 5;
    return pts;
  }, []);
  useEffect(() => () => { points.geometry.dispose(); (points.material as THREE.Material).dispose(); }, [points]);
  const st = woundStateOnDay(sim.day, sim.woundType, sim.factors);
  const m = points.material as THREE.ShaderMaterial;
  m.uniforms.uAct!.value = [st.cells.platelets, st.cells.neutrophils, st.cells.macrophages, Math.max(st.cells.fibroblasts, st.cells.myofibroblasts), st.cells.keratinocytes];
  m.uniforms.uShape!.value.set(shape.x0, shape.halfWidth * fill.gap, shape.depth, shape.exponent);
  m.uniforms.uScale!.value = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));

  const stage = fill.scar > 0.5 ? 'Scar (no hair or glands)' : fill.epithelium >= 0.999 ? 'Closed: new epidermis' : fill.granulation > 0.35 ? 'Granulation tissue' : sim.woundType === 'graze' ? 'Scab' : 'Clot';
  const items: PointLabel[] = [{ key: 'wound', text: stage, p: W([shape.x0, -shape.depth * 0.35, 2.02]), tone: 'sim' }];
  return (
    <group>
      <mesh geometry={geometry} material={material} renderOrder={1} raycast={() => {}} />
      <primitive object={points} />
      <PointLabels container={labels} items={items} />
    </group>
  );
}

/** Blister fluid under the lifted epidermis of a partial-thickness burn, and a label at the burn's depth. */
export function BurnScene({ sim, labels }: { sim: Sim; labels: RefObject<HTMLDivElement | null> }) {
  const lift = sim.burnDepth === 'superficial-partial' ? 0.24 : sim.burnDepth === 'deep-partial' ? 0.16 : 0;
  const material = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#f2d86a', transparent: true, opacity: 0.7, emissive: '#6a5410', emissiveIntensity: 0.4, roughness: 0.1, clearcoat: 1, depthWrite: false, clippingPlanes: [clip.plane] }), []);
  useEffect(() => () => material.dispose(), [material]);
  const h = anchors['layer-heights'];
  const boxes = useMemo(() => [
    { x0: -3, x1: 0.6, y0: h.thin['dermal-junction']! - 0.01 },
    { x0: 0.6, x1: 3, y0: h.thick['dermal-junction']! - 0.01 },
  ], [h]);
  const DEPTH_LABEL: Record<string, [string, number]> = {
    superficial: ['Burn: epidermis only', -0.06], 'superficial-partial': ['Burn: into the papillary dermis', -0.25],
    'deep-partial': ['Burn: into the reticular dermis', -1.0], 'full-thickness': ['Burn: whole dermis', -1.8], 'fourth-degree': ['Burn: to the fascia', -4.5],
  };
  const [text, y] = DEPTH_LABEL[sim.burnDepth]!;
  return (
    <group>
      {lift > 0 && boxes.map((b, i) => (
        <mesh key={i} position={[((b.x0 + b.x1) / 2) * MM, (b.y0 + (lift + 0.04) / 2) * MM, 0]} material={material} renderOrder={3} raycast={() => {}}>
          <boxGeometry args={[(b.x1 - b.x0) * MM * 0.999, (lift + 0.04) * MM, 4 * MM * 0.999]} />
        </mesh>
      ))}
      <PointLabels container={labels} items={[{ key: 'burn', text, p: W([-2.2, y, 2.0]), tone: 'warn' }]} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Touch
// ---------------------------------------------------------------------------------------------

/** Colour of a two-point threshold: green (fine) → amber → red (coarse). */
export function thresholdColour(mm: number): string {
  const t = Math.min(1, Math.log(mm / 2) / Math.log(25));
  const c = new THREE.Color().setHSL(0.33 * (1 - t), 0.75, 0.48);
  return `#${c.getHexString()}`;
}

/** The two-point sites on the body, coloured by threshold; the picked one shows the two points at true spacing. */
export function TwoPointScene({ sim, labels }: { sim: Sim; labels: RefObject<HTMLDivElement | null> }) {
  const { state, dispatch } = useLab();
  const sites = bodyMesh.current ? findSites(bodyMesh.current.geometry) : null;
  const tour = state.mode === 'tour';
  // Frame the picked site.
  const lastSite = useRef<string | null>(null);
  useEffect(() => {
    if (!sites || tour) return;
    if (lastSite.current === null) { lastSite.current = sim.site; return; }
    if (lastSite.current === sim.site) return;
    lastSite.current = sim.site;
    const p = sites[sim.site];
    const r = 0.11;
    const back = sim.site === 'back' || sim.site === 'calf';
    dispatch({ type: 'camera', preset: back ? 'body-back' : 'body-front', box: [[p.x - r, p.y - r, p.z - r], [p.x + r, p.y + r, p.z + r]] });
  }, [sim.site, sites, tour, dispatch]);
  if (!sites) return null;
  const sel = sites[sim.site];
  const normalOut = new THREE.Vector3(sel.x, 0, sel.z).normalize().multiplyScalar(0.004);
  const half = sim.separationMm / 2000;
  const click = (id: BodySiteId) => (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (!tour) dispatch({ type: 'set-sim', patch: { site: id } }); };
  return (
    <group>
      {(Object.entries(sites) as [BodySiteId, THREE.Vector3][]).map(([id, p]) => (
        <mesh key={id} position={p} onClick={click(id)} renderOrder={6}>
          <sphereGeometry args={[id === sim.site ? 0.011 : 0.0085, 16, 12]} />
          <meshBasicMaterial color={thresholdColour(TWO_POINT_THRESHOLD_MM[id])} depthTest={false} transparent opacity={id === sim.site ? 0.55 : 0.95} />
        </mesh>
      ))}
      {[-1, 1].map((k) => (
        <mesh key={k} position={[sel.x + normalOut.x + k * half, sel.y + normalOut.y, sel.z + normalOut.z]} renderOrder={7} raycast={() => {}}>
          <sphereGeometry args={[Math.min(0.0016, Math.max(0.0006, half * 0.5)), 12, 10]} />
          <meshBasicMaterial color="#14202a" depthTest={false} />
        </mesh>
      ))}
      <PointLabels container={labels} items={[{ key: 'site', text: `${sim.site.replace('-', ' ')} · ${TWO_POINT_THRESHOLD_MM[sim.site]} mm`, p: sel.clone().add(new THREE.Vector3(0, 0.012, 0)), tone: 'sim' }]} />
    </group>
  );
}

/** Labels on the active receptors in the block. */
export function ReceptorLabels({ sim, labels }: { sim: Sim; labels: RefObject<HTMLDivElement | null> }) {
  const r = anchors.receptors;
  const items: PointLabel[] = [];
  const at = (id: string, text: string, p: readonly number[]) => items.push({ key: id, text, p: W(p), tone: 'sim' });
  if (sim.touchView === 'vibration') {
    const best = MECHANORECEPTORS.map((id) => ({ id, v: vibrationResponse(id, sim.vibHz, sim.vibUm) })).filter((x) => x.v > 0.3);
    for (const b of best) {
      const a = r[b.id as 'meissner-corpuscle'];
      const p = Array.isArray(a) ? a[0]!.p : (a as { p: number[] }).p;
      at(b.id, `${b.id.split('-')[0]!.replace(/^./, (c) => c.toUpperCase())} ${Math.round(b.v * 100)} %`, p);
    }
  }
  if (sim.touchView === 'thermal') at('fne', 'Free nerve endings', r['free-nerve-endings'][0]!.p);
  return <PointLabels container={labels} items={items} />;
}

/** Spike-train helper for the Touch panel, re-exported so the scene and the panel use one source. */
export { spikeTimes };
