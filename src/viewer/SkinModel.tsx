import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useLab } from '../app/LabContext';
import {
  effectiveBodyPaint, effectiveColourBy, effectiveMode, effectiveSim, effectiveSlice, effectiveView, focusIds, highlightedIds, isVisible, keptSign, litIds, simXray, type BodyPaint,
} from '../app/state';
import { burnDepthFromLayer, burnDepthFromMm } from '../skin/wounds';
import { RECEPTOR_IDS, type ReceptorId } from '../skin/sensation';
import { DERMATOME_LEVELS, anchors } from '../skin/anchors';
import { addSimFx, type FxUniforms } from './simfx';
import { burnPaint, dermatomePaint, findSites, regionPaint, thermalPaint } from './bodyPaint';
import type { AnatomicalStructure, View } from '../contract/schema';
import { BLOCK_SCALE, BODY_REGIONS, cutBounds, geometry } from '../skin/anchors';
import { baseColour, cutColour, HIGHLIGHT, HOVER, patternOf, realLook, realOpacity, VERTEX_COLOURED } from './palette';
import { closeHoles } from './closeHoles';
import { applyQuality, hasTissueData, makeTissueMaterial, quality, type TissueMaterial } from './tissue';
import { addHistology } from './histology';

export const MODEL_URL = `${import.meta.env.BASE_URL}models/skin.glb`;

const GREY = new THREE.Color('#a59a96');
const HIGHLIGHT_COLOUR = new THREE.Color(HIGHLIGHT);

/** Pointer travel (px) above which a press is treated as a drag (rotate), not a pick. */
const CLICK_SLOP = 5;

/** The cut shared with the label layer, so hits on the removed side can be ignored. */
export const clip = { plane: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 100), active: false };

/**
 * Tissue sheets: their caps are drawn first, in this order, so everything embedded in them
 * (appendages, receptors, vessels, nerves) draws its own section over theirs.
 */
const BASE_TISSUE = ['deep-fascia', 'subcutaneous-fat', 'fibrous-septa', 'reticular-dermis', 'papillary-dermis', 'stratum-basale', 'stratum-spinosum', 'stratum-granulosum', 'stratum-lucidum', 'stratum-corneum', 'collagen-bundles'];

/**
 * Bring a block mesh (millimetres) into world units once: geometry and instance positions scaled
 * by BLOCK_SCALE. The GLTF loader caches the scene, so the geometry is marked when done.
 */
function toWorldOnce(mesh: THREE.Mesh) {
  const g = mesh.geometry;
  if (g.userData.worldScaled) return;
  g.userData.worldScaled = true;
  g.scale(BLOCK_SCALE, BLOCK_SCALE, BLOCK_SCALE);
  if (mesh instanceof THREE.InstancedMesh) {
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      m.decompose(p, q, s);
      p.multiplyScalar(BLOCK_SCALE);
      mesh.setMatrixAt(i, m.compose(p, q, s));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

interface Cap { back: THREE.Mesh; front: THREE.Mesh; face: THREE.Mesh; material: THREE.MeshStandardMaterial; closed: THREE.BufferGeometry; hist: { uHistOn: { value: number } } }
interface Part {
  id: string;
  view: View;
  mesh: THREE.Mesh;
  material: TissueMaterial;
  hist: { uHistOn: { value: number } };
  structure: AnatomicalStructure;
  box: THREE.Box3;
  cap: Cap | null;
  /** Original vertex colours (vessels), restored when leaving the Layers colour mode. */
  colours?: THREE.BufferAttribute;
  /** Simulation effects (block only). */
  fx: FxUniforms | null;
}

/** The block's parts with their simulation effects, for the scenes that drive them (set by SkinModel). */
export const fxParts = new Map<string, { id: string; mesh: THREE.Mesh; fx: FxUniforms }>();
/** The body-skin mesh, once loaded. */
export const bodyMesh: { current: THREE.Mesh | null } = { current: null };

/**
 * Stencil capping (as in three.js' clipping-stencil example): back faces behind the cut add 1 and
 * front faces subtract 1, so the stencil is non-zero exactly where the cut passes through the
 * inside of a closed mesh. The face drawn there is the filled cut surface, with the tissue's
 * colour and histology.
 */
function makeCap(geometry: THREE.BufferGeometry, plane: THREE.Plane, structure: AnatomicalStructure): Cap {
  const stencilMat = (side: THREE.Side, op: THREE.StencilOp) => new THREE.MeshBasicMaterial({
    side, colorWrite: false, depthWrite: false, depthTest: false,
    stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: op, stencilZFail: op, stencilZPass: op,
    clippingPlanes: [plane],
    // Drawn in the transparent pass with the tissue (which is always flagged transparent), after it by renderOrder.
    transparent: true,
  });
  const closed = closeHoles(geometry);
  const back = new THREE.Mesh(closed, stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp));
  const front = new THREE.Mesh(closed, stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp));
  const material = new THREE.MeshStandardMaterial({
    color: cutColour(structure), roughness: 0.8, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.6, transparent: true,
    // Caps all lie in the cutting plane: writing depth would make them fight each other (stripes).
    depthWrite: false,
    stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
  });
  const hist = addHistology(material, patternOf(structure), 'cap');
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  for (const m of [back, front, face]) {
    m.visible = false;
    m.raycast = () => {}; // never pickable
    m.matrixAutoUpdate = false;
  }
  return { back, front, face, material, closed, hist };
}

/** The body's vertex colours for a paint (null: its real colour). Temperature is repainted live by the Temperature scene. */
function bodyColours(geometry: THREE.BufferGeometry, paint: BodyPaint, sim: ReturnType<typeof effectiveSim>): THREE.BufferAttribute | null {
  switch (paint.kind) {
    case 'regions': return regionPaint(geometry);
    case 'dermatomes': return dermatomePaint(geometry, paint.highlight);
    case 'burns': return burnPaint(geometry, sim.burnRegions, sim.palmSpots, sim.burnDepth);
    case 'temperature': {
      const t = (geometry.userData.thermal as THREE.BufferAttribute | undefined) ?? new THREE.BufferAttribute(thermalPaint(geometry, 33.7, 36.8, 0), 3);
      geometry.userData.thermal = t;
      return t;
    }
    default: return null;
  }
}

export function SkinModel({ onReady }: { onReady?: () => void }) {
  const { def, state, dispatch } = useLab();
  const gltf = useGLTF(MODEL_URL);
  const invalidate = useThree((s) => s.invalidate);
  const view = effectiveView(def, state);
  const roots = useMemo(() => {
    const byName = (n: string) => gltf.scenes.find((s) => s.name === n) ?? null;
    return { block: byName('block') ?? gltf.scene, body: byName('body') };
  }, [gltf]);

  const parts = useMemo(() => {
    const out = new Map<string, Part>();
    for (const [v, root] of Object.entries(roots) as [View, THREE.Object3D | null][]) {
      root?.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const id = o.name || o.parent?.name || '';
        const s = def.structures.find((x) => x.id === id);
        if (!s) return;
        if (v === 'block') toWorldOnce(o);
        const material = makeTissueMaterial(realLook(s), hasTissueData(o));
        material.clippingPlanes = [clip.plane];
        material.transparent = true;
        const hist = addHistology(material, v === 'block' ? patternOf(s) : 'none', 'tissue');
        const fx = v === 'block' ? addSimFx(material, id === 'stratum-corneum') : null;
        const colours = o.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
        if (VERTEX_COLOURED.has(id) && colours) material.vertexColors = true;
        const instanced = o instanceof THREE.InstancedMesh;
        if (instanced) o.computeBoundingBox();
        const box = (instanced ? (o as THREE.InstancedMesh).boundingBox! : (o.geometry.computeBoundingBox(), o.geometry.boundingBox!)).clone();
        out.set(id, { id, view: v, mesh: o, material, hist, structure: s, box, cap: instanced ? null : makeCap(o.geometry, clip.plane, s), colours, fx });
      });
    }
    // Tissue sheets first (fascia up to the corneum), then everything else, largest first, so
    // smaller parts inside them draw their caps last.
    const size = (p: Part) => p.box.getSize(new THREE.Vector3()).lengthSq();
    const rank = (p: Part) => { const i = BASE_TISSUE.indexOf(p.id); return i < 0 ? BASE_TISSUE.length : i; };
    const sorted = [...out.values()].sort((a, b) => rank(a) - rank(b) || size(b) - size(a));
    sorted.forEach((p, i) => {
      if (!p.cap) return;
      p.cap.back.renderOrder = p.cap.front.renderOrder = 10 + i * 2;
      p.cap.face.renderOrder = 10 + i * 2 + 1;
    });
    return out;
  }, [roots, def]);

  // Attach materials in an effect, not in useMemo: StrictMode may run the memo twice, and the
  // meshes must carry the materials this component actually updates. Dispose them on unmount.
  useLayoutEffect(() => {
    for (const p of parts.values()) {
      p.mesh.material = p.material;
      p.mesh.userData.structureId = p.id;
      if (p.cap) (roots[p.view] ?? roots.block).add(p.cap.back, p.cap.front, p.cap.face);
      if (p.fx) fxParts.set(p.id, { id: p.id, mesh: p.mesh, fx: p.fx });
      if (p.id === 'body-skin') { bodyMesh.current = p.mesh; findSites(p.mesh.geometry); }
    }
    onReady?.();
    if (import.meta.env.DEV) (window as unknown as { __skinParts?: unknown }).__skinParts = parts; // for debugging looks in the dev server
    return () => parts.forEach((p) => {
      fxParts.delete(p.id);
      if (p.id === 'body-skin') bodyMesh.current = null;
      p.material.dispose();
      if (!p.cap) return;
      p.cap.material.dispose();
      if (p.cap.closed !== p.mesh.geometry) p.cap.closed.dispose();
      (p.cap.back.material as THREE.Material).dispose();
      (p.cap.front.material as THREE.Material).dispose();
      p.cap.face.geometry.dispose();
      (roots[p.view] ?? roots.block).remove(p.cap.back, p.cap.front, p.cap.face);
    });
  }, [parts, onReady, roots]);

  // Follow quality changes (a slow device drops the costly coat and sheen).
  useEffect(() => quality.subscribe((level) => {
    for (const p of parts.values()) { applyQuality(p.material, level); p.material.needsUpdate = true; }
    invalidate();
  }), [parts, invalidate]);

  const lit = highlightedIds(def, litIds(def, state));
  const selectedLit = highlightedIds(def, focusIds(def, state));
  const xray = simXray(def, state);
  const colourBy = effectiveColourBy(def, state);
  const sim = effectiveSim(def, state);
  const mode = effectiveMode(def, state);
  const paint = effectiveBodyPaint(def, state);
  const slice = effectiveSlice(def, state);
  const [lo, hi] = useMemo(() => cutBounds(def, view), [def, view]);

  // The cut plane keeps the side where n·p + c ≥ 0. The plane stays attached to every material
  // (parked far outside the model when there is no cut), so a cut never recompiles the shaders.
  useEffect(() => {
    const a = slice.axis;
    clip.active = a !== 'off';
    if (clip.active) {
      const ax = a === 'sagittal' ? 0 : a === 'axial' ? 1 : 2;
      const c = (lo[ax]! + hi[ax]!) / 2, half = (hi[ax]! - lo[ax]!) / 2;
      const at = c + slice.at * half;
      const sgn = keptSign(slice);
      const n = new THREE.Vector3();
      n.setComponent(ax, sgn);
      clip.plane.set(n, -sgn * at);
    } else {
      clip.plane.set(new THREE.Vector3(-1, 0, 0), 100);
    }
    invalidate();
  }, [slice, lo, hi, invalidate]);

  useEffect(() => {
    if (roots.body) roots.body.visible = view === 'body';
    roots.block.visible = view === 'block';
    for (const p of parts.values()) {
      const s = p.structure;
      // See-through modes draw the tissue sheets faintly and only the parts they animate; the rest is hidden (cheaper, and clearer).
      p.mesh.visible = isVisible(def, state, p.id) && !(xray && !xray.has(p.id) && !BASE_TISSUE.includes(p.id) && !lit.has(p.id));
      const isLit = lit.has(p.id);
      // Structures the simulation points at keep their own (simulated) colours, with only a faint glow.
      const soft = isLit && !selectedLit.has(p.id);
      const isHover = state.hovered === p.id && !isLit;
      const ghost = !!xray && !xray.has(p.id) && !isLit;
      const dim = (lit.size > 0 && !isLit) || (ghost && !BASE_TISSUE.includes(s.id));
      const painted = colourBy !== 'real';
      // Vertex colours: vessels (real look), the body surface by region or dermatome.
      let vc = false;
      if (p.id === 'body-skin') {
        const attr = bodyColours(p.mesh.geometry, paint, sim);
        if (attr && p.mesh.geometry.getAttribute('color') !== attr) p.mesh.geometry.setAttribute('color', attr);
        vc = !!attr;
      } else if (p.colours) vc = !painted;
      if (p.material.vertexColors !== vc) { p.material.vertexColors = vc; p.material.needsUpdate = true; }
      p.material.color.set(vc ? '#ffffff' : p.id === 'body-skin' && paint.kind === 'tone' ? paint.colour : baseColour(s, colourBy));
      if (isLit && !painted && !soft) p.material.color.lerp(HIGHLIGHT_COLOUR, vc ? 0.25 : 0.35);
      else if (dim) p.material.color.lerp(GREY, 0.45);
      if (isLit) p.material.emissive.copy(painted ? p.material.color : HIGHLIGHT_COLOUR);
      else p.material.emissive.set(isHover ? HOVER : '#000000');
      p.material.emissiveIntensity = soft ? 0.06 : isLit ? (painted ? 0.22 : 0.3) : isHover ? 0.3 : 0;
      // See-through tissue skips the costly histology (it is barely visible and every layer would pay for it).
      p.hist.uHistOn.value = painted || ghost ? 0 : 1;

      let opacity = realOpacity(s);
      if (dim && BASE_TISSUE.includes(s.id)) opacity = Math.min(opacity, 0.35);
      if (ghost) opacity = Math.min(opacity, mode === 'touch' ? (BASE_TISSUE.includes(s.id) ? 0.1 : 0.14) : BASE_TISSUE.includes(s.id) ? 0.2 : 0.3);
      const transparent = opacity < 1;
      // Every tissue material is created transparent (drawn opaque at opacity 1, with depth writes), so
      // ghosting a part never switches its shader program: a recompile of dozens of tissue shaders stalls
      // the GPU for many seconds on some drivers.
      p.material.opacity = opacity;
      p.material.depthWrite = !transparent;
      p.mesh.renderOrder = transparent ? 2 : 0;

      if (p.cap) {
        p.cap.material.color.set(painted ? baseColour(s, colourBy) : cutColour(s));
        p.cap.hist.uHistOn.value = painted ? 0 : 1;
        if (isLit) p.cap.material.color.lerp(HIGHLIGHT_COLOUR, 0.3);
        else if (dim) p.cap.material.color.lerp(GREY, 0.35);
        // A section is evenly lit, like a slide on a light box: part of its colour is emitted.
        p.cap.material.emissive.copy(p.cap.material.color).multiplyScalar(0.32);
      }
    }
    invalidate();
  }, [parts, roots, def, state, lit, selectedLit, xray, colourBy, paint, sim, view, invalidate]);

  // Keep each cap on the plane, just large enough to cover the part's footprint, and show it only
  // where the plane crosses a solid part.
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const size = useMemo(() => new THREE.Vector3(), []);
  const worldBox = useMemo(() => new THREE.Box3(), []);
  useFrame(() => {
    for (const p of parts.values()) {
      if (!p.cap) continue;
      const solid = p.mesh.visible && p.material.opacity >= 1;
      p.mesh.updateMatrix();
      worldBox.copy(p.box).applyMatrix4(p.mesh.matrix);
      const show = clip.active && solid && clip.plane.intersectsBox(worldBox);
      p.cap.back.visible = p.cap.front.visible = p.cap.face.visible = show;
      if (show) {
        p.cap.back.matrix.copy(p.mesh.matrix);
        p.cap.front.matrix.copy(p.mesh.matrix);
        clip.plane.projectPoint(worldBox.getCenter(tmp), tmp);
        p.cap.face.position.copy(tmp);
        p.cap.face.lookAt(tmp.x - clip.plane.normal.x, tmp.y - clip.plane.normal.y, tmp.z - clip.plane.normal.z);
        p.cap.face.scale.setScalar(worldBox.getSize(size).length() * 1.05);
        p.cap.face.updateMatrix();
      }
    }
  });

  /** Ignore hits on the part of the model the cut has removed. */
  const removed = (e: ThreeEvent<PointerEvent | MouseEvent>) => clip.active && clip.plane.distanceToPoint(e.point) < 0;
  const pickable = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const id = e.object.userData.structureId as string | undefined;
    if (!id || !e.object.visible || removed(e)) return null; // let the event reach the next hit
    const m = (e.object as THREE.Mesh).material as THREE.Material;
    if (m.transparent && m.opacity < 0.3) return null; // ghosted parts are see-through to clicks
    return id;
  };
  const pick = (e: ThreeEvent<MouseEvent>) => {
    const id = pickable(e);
    if (!id) return;
    e.stopPropagation();
    if (e.delta > CLICK_SLOP) return;
    if (state.mode === 'tour') { dispatch({ type: 'select', id }); return; }
    // Clicking the body: the simulations use the point; otherwise it opens the skin block for that region (palms and soles show thick skin).
    if (id === 'body-skin' && e.face) {
      const g = (e.object as THREE.Mesh).geometry;
      const region = (g.getAttribute('_region') as THREE.BufferAttribute | undefined)?.getX(e.face.a);
      const r = region !== undefined ? BODY_REGIONS[region] : undefined;
      if (mode === 'wounds' && sim.woundView === 'burns') {
        if (sim.paintMode === 'palm') dispatch({ type: 'set-sim', patch: { palmSpots: [...sim.palmSpots, e.point.x, e.point.y, e.point.z] } });
        else if (r) dispatch({ type: 'set-sim', patch: { burnRegions: { ...sim.burnRegions, [r.id]: (sim.burnRegions[r.id] ?? 0) >= 1 ? 0 : 1 } } });
        return;
      }
      if (mode === 'touch' && sim.touchView === 'dermatomes') {
        const d = (g.getAttribute('_dermatome') as THREE.BufferAttribute | undefined)?.getX(e.face.a);
        const level = d !== undefined && d !== 255 ? DERMATOME_LEVELS[d] : undefined;
        dispatch({ type: 'set-sim', patch: { dermatome: (level ?? null) as never, landmark: null } });
        return;
      }
      if (mode === 'touch' && sim.touchView === 'two-point') {
        const sites = findSites(g);
        if (sites) {
          let best: string | null = null, bd = 0.12;
          for (const [k, v] of Object.entries(sites)) { const dd = v.distanceTo(e.point); if (dd < bd) { bd = dd; best = k; } }
          if (best) dispatch({ type: 'set-sim', patch: { site: best as never } });
        }
        return;
      }
      const landmarks = geometry['body-skin'];
      const handY = landmarks ? landmarks.bounds[0]![1]! + 0.5 * (landmarks.bounds[1]![1]! - landmarks.bounds[0]![1]!) : 0.85;
      const palm = !!r && r.id.startsWith('arm') && e.point.y < handY && e.face.normal.z > 0.3;
      const sole = !!r && r.id.startsWith('leg') && e.point.y < 0.02;
      dispatch({ type: 'open-block', site: r?.id ?? null, thick: palm || sole });
      return;
    }
    // Touch: a receptor opens its card. Burns: the layer clicked sets the depth of the burn.
    if (mode === 'touch' && (RECEPTOR_IDS as string[]).includes(id)) { dispatch({ type: 'set-sim', patch: { receptor: id as ReceptorId, touchView: 'receptors' } }); return; }
    if (mode === 'wounds' && sim.woundView === 'burns' && view === 'block') {
      const byLayer = burnDepthFromLayer(id);
      const mm = -e.point.y / BLOCK_SCALE;
      const thick = e.point.x / BLOCK_SCALE > anchors['thick-thin-boundary'].x;
      const h = anchors['layer-heights'][thick ? 'thick' : 'thin'];
      const depth = byLayer ?? burnDepthFromMm(mm, { epidermis: -h['dermal-junction']!, papillaryDermis: -h['papillary-bottom']!, reticularDermis: -h['dermis-hypodermis']!, hypodermis: -h.fascia! });
      dispatch({ type: 'set-sim', patch: { burnDepth: depth.id } });
      return;
    }
    dispatch({ type: 'select', id });
  };
  const over
 = (e: ThreeEvent<PointerEvent>) => {
    const id = pickable(e);
    if (!id) return;
    e.stopPropagation();
    dispatch({ type: 'hover', id });
    document.body.style.cursor = 'pointer';
  };
  const out = (e: ThreeEvent<PointerEvent>) => {
    if (e.object.userData.structureId === state.hovered) dispatch({ type: 'hover', id: null });
    document.body.style.cursor = '';
  };

  return (
    <group onClick={pick} onPointerOver={over} onPointerOut={out}>
      <primitive object={roots.block} />
      {roots.body && <primitive object={roots.body} />}
    </group>
  );
}
