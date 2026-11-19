import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { toWorld, type Vec3, type View } from '../skin/anchors';

/** A point in a scene's own units (block: mm; body: m) as a world-space vector. */
export const W = (p: readonly number[], view: View = 'block') => new THREE.Vector3(...toWorld(p, view));

/** The model's mesh for a structure id (set by SkinModel), or null before the model is in the scene. */
export function findMesh(root: THREE.Object3D, id: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => { if (!found && o instanceof THREE.Mesh && o.userData.structureId === id) found = o; });
  return found;
}

/** Puts a mesh back where the model has it (the simulations move some parts). */
export function resetMesh(m: THREE.Mesh | null) {
  if (!m) return;
  m.position.set(0, 0, 0);
  m.quaternion.identity();
  m.scale.set(1, 1, 1);
}

/**
 * A deformable copy-on-first-use of a mesh's vertex positions, so a part (the eardrum) can be
 * bulged and restored. Interleaved glTF attributes are written through the attribute API.
 */
export function deformer(mesh: THREE.Mesh) {
  const g = mesh.geometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  if (!g.userData.rest) {
    const rest = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) rest.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
    g.userData.rest = rest;
  }
  const rest = g.userData.rest as Float32Array;
  return {
    count: pos.count,
    rest,
    /** Move each vertex by weight(i) along `dir` (world units). */
    apply(dir: THREE.Vector3, weight: (x: number, y: number, z: number) => number) {
      for (let i = 0; i < pos.count; i++) {
        const x = rest[i * 3]!, y = rest[i * 3 + 1]!, z = rest[i * 3 + 2]!;
        const w = weight(x, y, z);
        pos.setXYZ(i, x + dir.x * w, y + dir.y * w, z + dir.z * w);
      }
      pos.needsUpdate = true;
      g.computeBoundingSphere();
    },
    restore() {
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, rest[i * 3]!, rest[i * 3 + 1]!, rest[i * 3 + 2]!);
      pos.needsUpdate = true;
      g.computeBoundingSphere();
    },
  };
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A 3D arrow (shaft and head) drawn over the model. Imperative: call `set(from, dir, length)`
 * every frame; a zero length hides it.
 */
export function useArrow(colour: string, radius = 0.00012, overlay = true) {
  const group = useMemo(() => {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: colour, depthTest: !overlay, transparent: true, opacity: 0.95, toneMapped: false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 8), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.6, 1, 12), mat);
    shaft.renderOrder = head.renderOrder = 9;
    g.add(shaft, head);
    g.userData = { shaft, head, mat };
    return g;
  }, [colour, radius, overlay]);
  useEffect(() => () => {
    const { shaft, head, mat } = group.userData as { shaft: THREE.Mesh; head: THREE.Mesh; mat: THREE.Material };
    shaft.geometry.dispose(); head.geometry.dispose(); mat.dispose();
  }, [group]);
  const set = (from: THREE.Vector3, dir: THREE.Vector3, length: number) => {
    const { shaft, head } = group.userData as { shaft: THREE.Mesh; head: THREE.Mesh };
    if (length <= 1e-7 || dir.lengthSq() === 0) { group.visible = false; return; }
    group.visible = true;
    const headLen = Math.min(length * 0.45, radius * 7);
    group.position.copy(from);
    group.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    shaft.scale.set(1, Math.max(1e-6, length - headLen), 1);
    shaft.position.set(0, (length - headLen) / 2, 0);
    head.scale.set(1, headLen, 1);
    head.position.set(0, length - headLen / 2, 0);
  };
  return { object: group, set };
}

/** Keeps the latest value of a prop for use in a frame loop without re-subscribing. */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}

export type { Vec3 };
