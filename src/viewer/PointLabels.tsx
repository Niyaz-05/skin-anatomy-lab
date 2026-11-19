import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface PointLabel {
  key: string;
  text: string;
  /** World position; the owner may move it every frame. */
  p: THREE.Vector3;
  /** 'sim' (simulation marker, blue) or 'part' (a part of a structure, light). */
  tone?: 'sim' | 'part' | 'warn';
}

/**
 * Labels for points that are not whole structures (parts of the ossicles, the place of a tone on the
 * cochlea, the windows): DOM labels projected each frame, with a greedy pass that lifts a label
 * clear of the ones already placed, or hides it when there is no room.
 */
export function PointLabels({ container, items }: { container: RefObject<HTMLDivElement | null>; items: PointLabel[] }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const els = useRef<{ item: PointLabel; el: HTMLDivElement }[]>([]);
  const key = items.map((i) => `${i.key}:${i.text}:${i.tone ?? ''}`).join('|');
  const latest = useRef(items);
  latest.current = items;

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const made = latest.current.map((item) => {
      const el = document.createElement('div');
      el.className = `scene-label point-label tone-${item.tone ?? 'sim'}`;
      el.textContent = item.text;
      el.dataset.point = item.key;
      el.setAttribute('aria-hidden', 'true');
      el.style.visibility = 'hidden';
      root.appendChild(el);
      return { item, el };
    });
    els.current = made;
    invalidate();
    return () => made.forEach((m) => m.el.remove());
  }, [key, container, invalidate]);

  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    // Labels of the structure layer that are showing count as placed.
    container.current?.querySelectorAll<HTMLElement>('.scene-label:not(.point-label)').forEach((e) => {
      if (e.style.visibility !== 'visible') return;
      const r = e.getBoundingClientRect(), host = container.current!.getBoundingClientRect();
      placed.push({ x0: r.left - host.left, y0: r.top - host.top, x1: r.right - host.left, y1: r.bottom - host.top });
    });
    els.current.forEach(({ el }, i) => {
      const item = latest.current[i] ?? els.current[i]!.item;
      v.copy(item.p).project(camera);
      const w = el.offsetWidth || item.text.length * 7, h = el.offsetHeight || 18;
      // Keep the whole label on screen (its pointer still marks the point when that is on screen).
      const x = Math.min(Math.max(((v.x + 1) / 2) * size.width, w / 2 + 4), size.width - w / 2 - 4), y = ((1 - v.y) / 2) * size.height;
      const at = (dy: number) => ({ x0: x - w / 2 - 2, y0: y + dy - h - 6, x1: x + w / 2 + 2, y1: y + dy + 2 });
      const hits = (b: { x0: number; y0: number; x1: number; y1: number }) => placed.some((p) => !(b.x1 < p.x0 || b.x0 > p.x1 || b.y1 < p.y0 || b.y0 > p.y1));
      let dy = 0, box = at(0);
      for (let k = 1; k <= 4 && hits(box); k++) { dy = -(h + 4) * k; box = at(dy); }
      const off = v.z > 1 || box.x1 < 0 || box.x0 > size.width || box.y0 < 0 || box.y1 > size.height;
      const show = !off && !hits(box);
      el.style.visibility = show ? 'visible' : 'hidden';
      el.dataset.state = show ? 'shown' : 'hidden';
      if (show) {
        placed.push(box);
        el.style.setProperty('--lift', `${-dy}px`);
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y + dy)}px) translate(-50%, calc(-100% - 6px))`;
      }
    });
  });
  return null;
}
