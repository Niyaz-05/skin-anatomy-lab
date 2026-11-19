/**
 * UI state as a pure reducer, so every learner action is unit-testable without rendering. The 3D
 * scene only reads this state; it never owns selection, view or visibility itself.
 */
import type { Mode, SimulationDefinition, SliceAxis, StepParams, View } from '../contract/schema';
import { viewOf, type Vec3 } from '../skin/anchors';
import { defaultSim, patchSim, type Sim } from './sim';
import { DISORDERS, dosesInMed } from '../skin/photo';
import { skinTone } from './visual';

export type { Mode, View } from '../contract/schema';
export type { Sim } from './sim';
export type ColourBy = 'real' | 'layer';
export type BodyColour = 'real' | 'regions' | 'dermatomes';

export interface Slice {
  axis: SliceAxis;
  /** Position across the view's bounds, -1 … 1. */
  at: number;
  /** Keep the other side of the cut. */
  flip: boolean;
}

export interface LabState {
  mode: Mode;
  /** The scene in view: the block of skin or the whole body. */
  view: View;
  selected: string | null;
  hovered: string | null;
  visibleLayers: ReadonlySet<string>;
  isolate: boolean;
  labels: boolean;
  colourBy: ColourBy;
  bodyColour: BodyColour;
  slice: Slice;
  /** How many tissue layers are peeled off the top of the block (0 … 5, see PEEL). */
  peel: number;
  /** The body region last opened in the block (rule-of-nines id), if any. */
  site: string | null;
  /** Animations running. */
  playing: boolean;
  tourIndex: number;
  /** A camera move the scene should perform; the nonce makes repeat requests distinct. */
  camera: { preset: string; focus: readonly string[]; box?: [Vec3, Vec3]; nonce: number };
  /** Settings of the simulation modes. */
  sim: Sim;
}

export type LabAction =
  | { type: 'select'; id: string | null }
  | { type: 'hover'; id: string | null }
  | { type: 'toggle-layer'; layer: string }
  | { type: 'set-isolate'; value: boolean }
  | { type: 'set-labels'; value: boolean }
  | { type: 'set-colour-by'; value: ColourBy }
  | { type: 'set-body-colour'; value: BodyColour }
  | { type: 'set-slice'; axis?: SliceAxis; at?: number; flip?: boolean }
  | { type: 'set-peel'; value: number }
  | { type: 'set-view'; view: View }
  /** Open the skin block from a place on the body (a rule-of-nines region id; palm/sole sites show thick skin). */
  | { type: 'open-block'; site?: string | null; thick?: boolean }
  | { type: 'set-mode'; mode: Mode }
  | { type: 'set-playing'; value: boolean }
  | { type: 'tour-go'; index: number }
  /** A camera preset, framing structures or a world-space box. */
  | { type: 'camera'; preset: string; focus?: readonly string[]; box?: [Vec3, Vec3] }
  | { type: 'set-sim'; patch: Partial<Sim> | StepParams }
  /** Leave the tour for the step's mode, with its settings, so the learner can play with them. */
  | { type: 'try-step' }
  | { type: 'reset' };

const NO_SLICE: Slice = { axis: 'off', at: 0, flip: false };

/**
 * Peeling the block from the top: each level hides the tissue sheets above it (the appendages,
 * receptors, vessels and nerves stay, so they stand free as the tissue comes away).
 */
export const PEEL: readonly { label: string; hides: readonly string[] }[] = [
  { label: 'None', hides: [] },
  { label: 'Stratum corneum', hides: ['stratum-corneum', 'stratum-lucidum'] },
  { label: 'Upper epidermis', hides: ['stratum-corneum', 'stratum-lucidum', 'stratum-granulosum', 'stratum-spinosum', 'langerhans-cells'] },
  { label: 'Whole epidermis', hides: ['stratum-corneum', 'stratum-lucidum', 'stratum-granulosum', 'stratum-spinosum', 'langerhans-cells', 'stratum-basale', 'melanocytes'] },
  { label: 'Papillary dermis', hides: ['stratum-corneum', 'stratum-lucidum', 'stratum-granulosum', 'stratum-spinosum', 'langerhans-cells', 'stratum-basale', 'melanocytes', 'papillary-dermis'] },
  { label: 'Whole dermis', hides: ['stratum-corneum', 'stratum-lucidum', 'stratum-granulosum', 'stratum-spinosum', 'langerhans-cells', 'stratum-basale', 'melanocytes', 'papillary-dermis', 'reticular-dermis', 'collagen-bundles'] },
];

/** The camera each view starts with. */
export const VIEW_CAMERA: Record<View, string> = { block: 'block-oblique', body: 'body-front' };

/** The camera each mode starts with (the UI modes may change these). */
export const MODE_CAMERA: Partial<Record<Mode, string>> = {
  explore: 'block-oblique', temperature: 'block-oblique', wounds: 'block-section-z', touch: 'block-receptors', life: 'block-oblique',
};

export function initialState(def: SimulationDefinition): LabState {
  const preset = def.cameraPresets.find((c) => c.id === def.defaultCamera);
  return {
    mode: 'explore',
    view: preset?.view ?? 'block',
    selected: null,
    hovered: null,
    visibleLayers: new Set(def.layers.filter((l) => l.visibleByDefault).map((l) => l.id)),
    isolate: false,
    labels: false,
    colourBy: 'real',
    bodyColour: 'real',
    slice: NO_SLICE,
    peel: 0,
    site: null,
    playing: true,
    tourIndex: 0,
    camera: { preset: def.defaultCamera, focus: [], nonce: 0 },
    sim: defaultSim(),
  };
}

/** Ids that a selection or tour step highlights: a group stands for its members. */
export function highlightedIds(def: SimulationDefinition, ids: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const s = def.structures.find((x) => x.id === id);
    if (!s) continue;
    if (s.kind === 'group') s.members?.forEach((m) => out.add(m));
    else out.add(id);
  }
  return out;
}

const step = (def: SimulationDefinition, state: LabState) => (state.mode === 'tour' ? def.tour[state.tourIndex] : undefined);

/** The mode in effect: in a tour, the step's (Anatomy if it names none). */
export function effectiveMode(def: SimulationDefinition, state: LabState): Exclude<Mode, 'tour'> {
  if (state.mode === 'tour') return step(def, state)?.mode ?? 'explore';
  return state.mode;
}

/** The scene in effect: a tour step's own, else its camera's, else the learner's. */
export function effectiveView(def: SimulationDefinition, state: LabState): View {
  const s = step(def, state);
  if (s) return s.view ?? def.cameraPresets.find((c) => c.id === s.camera)?.view ?? (s.focus[0] ? viewOf(def, s.focus[0]) : null) ?? state.view;
  return state.view;
}

/** The structures currently in focus: the selection, or the step's focus in a tour. */
export function focusIds(def: SimulationDefinition, state: LabState): string[] {
  if (state.mode === 'tour') return [...(step(def, state)?.focus ?? [])];
  return state.selected ? [state.selected] : [];
}

/** Mode-specific settings of the current tour step (empty outside a tour). */
export function effectiveParams(def: SimulationDefinition, state: LabState): StepParams {
  return step(def, state)?.params ?? {};
}

const stepSims = new WeakMap<object, Sim>();
/** The simulation settings in effect: a tour step's params over the defaults, otherwise the learner's. */
export function effectiveSim(def: SimulationDefinition, state: LabState): Sim {
  const s = step(def, state);
  if (!s) return state.sim;
  let sim = stepSims.get(s);
  if (!sim) { sim = patchSim(defaultSim(), s.params ?? {}); stepSims.set(s, sim); }
  return sim;
}

/** Structures the temperature effectors and the touch receptors show in full colour inside a see-through block. */
export const EFFECTORS = ['eccrine-gland', 'superficial-plexus', 'deep-plexus', 'arrector-pili', 'hair-shaft', 'hair-follicle', 'hair-bulb', 'inner-root-sheath', 'hair-papilla', 'sebaceous-gland'];
export const TOUCH_PARTS = ['meissner-corpuscle', 'merkel-discs', 'pacinian-corpuscle', 'ruffini-ending', 'free-nerve-endings', 'hair-follicle-plexus', 'cutaneous-nerve', 'hair-shaft'];

/** Structures the current simulation draws in full colour while the tissue sheets turn see-through (null: none). */
export function simXray(def: SimulationDefinition, state: LabState): ReadonlySet<string> | null {
  if (effectiveView(def, state) !== 'block') return null;
  const mode = effectiveMode(def, state);
  const sim = effectiveSim(def, state);
  if (mode === 'temperature' && sim.xray) return new Set(EFFECTORS);
  if (mode === 'touch' && ['receptors', 'vibration', 'pressure', 'thermal'].includes(sim.touchView)) return new Set(TOUCH_PARTS);
  return null;
}

/** Structures the simulation points at (highlighted like a selection). */
export function simHighlight(def: SimulationDefinition, state: LabState): string[] {
  if (effectiveView(def, state) !== 'block') return [];
  const mode = effectiveMode(def, state);
  const sim = effectiveSim(def, state);
  if (mode === 'life' && sim.lifeView === 'disorders') return [...DISORDERS[sim.disorder].structures];
  if (mode === 'touch' && sim.touchView === 'receptors') return [sim.receptor];
  return [];
}

/** Everything highlighted now: the focus plus what the simulation points at. */
export function litIds(def: SimulationDefinition, state: LabState): string[] {
  return [...new Set([...focusIds(def, state), ...simHighlight(def, state)])];
}

export type BodyPaint =
  | { kind: 'real' } | { kind: 'regions' } | { kind: 'dermatomes'; highlight: string | null }
  | { kind: 'temperature' } | { kind: 'burns' } | { kind: 'tone'; colour: string };

/** How the body surface is painted: by a simulation, else by the learner's (or the step's) colouring. */
export function effectiveBodyPaint(def: SimulationDefinition, state: LabState): BodyPaint {
  const mode = effectiveMode(def, state);
  const sim = effectiveSim(def, state);
  if (mode === 'temperature') return { kind: 'temperature' };
  if (mode === 'wounds' && sim.woundView === 'burns') return { kind: 'burns' };
  if (mode === 'touch' && sim.touchView === 'dermatomes') return { kind: 'dermatomes', highlight: sim.dermatome };
  if (mode === 'life' && sim.lifeView === 'sun') return { kind: 'tone', colour: skinTone(sim.phototype, dosesInMed(sim.phototype, sim.uvIndex, sim.sunMinutes, sim.spf)) };
  const c = effectiveBodyColour(def, state);
  return c === 'regions' ? { kind: 'regions' } : c === 'dermatomes' ? { kind: 'dermatomes', highlight: null } : { kind: 'real' };
}

/** The colour mode in effect: a tour step can set its own. */
export function effectiveColourBy(def: SimulationDefinition, state: LabState): ColourBy {
  if (state.mode === 'tour') return step(def, state)?.colourBy ?? 'real';
  return state.colourBy;
}

/** The body colouring in effect. */
export function effectiveBodyColour(def: SimulationDefinition, state: LabState): BodyColour {
  if (state.mode === 'tour') return step(def, state)?.bodyColour ?? 'real';
  return state.bodyColour;
}

/** The cut in effect: a tour step's, otherwise the learner's. */
export function effectiveSlice(def: SimulationDefinition, state: LabState): Slice {
  if (state.mode === 'tour') {
    const s = step(def, state);
    return s?.slice ? { axis: s.slice.axis, at: s.slice.at, flip: s.slice.flip ?? false } : NO_SLICE;
  }
  return state.slice;
}

/** The peel level in effect. */
export function effectivePeel(def: SimulationDefinition, state: LabState): number {
  if (state.mode === 'tour') return step(def, state)?.peel ?? 0;
  return state.peel;
}

/**
 * Whether a mesh structure is drawn: it must belong to the scene in view and not be peeled away.
 * In Anatomy mode the learner's layers decide; the other modes show everything (they will refine
 * this). A highlighted structure is always shown (unless peeled); with isolate on, only those.
 */
export function isVisible(def: SimulationDefinition, state: LabState, id: string): boolean {
  const s = def.structures.find((x) => x.id === id);
  if (!s) return false;
  if (viewOf(def, id) !== effectiveView(def, state)) return false;
  if (PEEL[effectivePeel(def, state)]?.hides.includes(id)) return false;
  const lit = highlightedIds(def, focusIds(def, state));
  if (lit.has(id)) return true;
  if (state.isolate && lit.size > 0) return false;
  const mode = effectiveMode(def, state);
  if (mode === 'explore') return state.visibleLayers.has(s.layer);
  // Vitiligo: the melanocytes are destroyed.
  if (mode === 'life' && id === 'melanocytes') { const sim = effectiveSim(def, state); return !(sim.lifeView === 'disorders' && sim.disorder === 'vitiligo'); }
  return true;
}

/**
 * The camera preset that looks at the cut face, from the side the cut removed. In the block a
 * sagittal (x) cut keeps the thick-skin side and is seen from the thin side; a coronal (z) cut keeps
 * the back and is seen from the front; an axial cut keeps the deeper part and is seen from above.
 * In the body view the cut faces are seen from the matching side.
 */
export function facingPreset(slice: Slice, view: View = 'block'): string | null {
  if (view === 'body') {
    switch (slice.axis) {
      case 'sagittal': return 'body-side';
      case 'coronal': return slice.flip ? 'body-back' : 'body-front';
      case 'axial': return 'body-front';
      default: return null;
    }
  }
  switch (slice.axis) {
    case 'sagittal': return 'block-section-x';
    case 'coronal': return 'block-section-z';
    case 'axial': return 'block-top';
    default: return null;
  }
}

/**
 * Which side of the plane is kept: +1 keeps coordinates above the cut along the axis, −1 below.
 * Block: x keeps the thick side (+x), z keeps the back (−z), y keeps the deeper part; flip swaps.
 */
export function keptSign(slice: Slice): 1 | -1 {
  const base = slice.axis === 'sagittal' ? 1 : -1;
  return (slice.flip ? -base : base) as 1 | -1;
}

/** What the cut leaves in view, for the panel's hint. */
export function keptHalf(slice: Slice, view: View = 'block'): string | null {
  const up = keptSign(slice) > 0;
  if (view === 'body') {
    switch (slice.axis) {
      case 'sagittal': return up ? 'the left half' : 'the right half';
      case 'coronal': return up ? 'the front half' : 'the back half';
      case 'axial': return up ? 'the upper part' : 'the lower part';
      default: return null;
    }
  }
  switch (slice.axis) {
    case 'sagittal': return up ? 'the thick-skin side' : 'the thin-skin side';
    case 'coronal': return up ? 'the front part' : 'the back part';
    case 'axial': return up ? 'the upper layers' : 'the deeper layers';
    default: return null;
  }
}

export function makeReducer(def: SimulationDefinition) {
  const known = new Set(def.structures.map((s) => s.id));
  const layers = new Set(def.layers.map((l) => l.id));
  const presets = new Map(def.cameraPresets.map((c) => [c.id, c]));
  const cam = (state: LabState, preset: string | undefined, focus: readonly string[] = []) =>
    preset && presets.has(preset) ? { preset, focus, nonce: state.camera.nonce + 1 } : state.camera;
  /** The camera a mode (and its sub-view) starts with. */
  const modePreset = (mode: Exclude<Mode, 'tour'>, sim: Sim): string | undefined => {
    switch (mode) {
      case 'wounds': return sim.woundView === 'healing' ? 'block-wound' : 'block-burn';
      case 'touch': return sim.touchView === 'two-point' || sim.touchView === 'dermatomes' ? 'body-front' : 'block-oblique';
      case 'life': return sim.lifeView === 'age' ? 'block-section-z' : 'block-oblique';
      default: return MODE_CAMERA[mode];
    }
  };
  const stepCam = (state: LabState, index: number) => {
    const s = def.tour[index]!;
    if (s.camera) return cam(state, s.camera, s.focus);
    const view = s.view ?? (s.focus[0] ? viewOf(def, s.focus[0]) : null) ?? 'block';
    return cam(state, VIEW_CAMERA[view], s.focus);
  };

  return function reduce(state: LabState, action: LabAction): LabState {
    switch (action.type) {
      case 'select': {
        if (action.id !== null && !known.has(action.id)) return state;
        const selected = action.id === state.selected ? null : action.id;
        // Selecting something in the other scene switches to it.
        const v = selected ? viewOf(def, selected) : null;
        if (v && v !== state.view && state.mode !== 'tour') return { ...state, selected, view: v, slice: NO_SLICE, camera: cam(state, VIEW_CAMERA[v], [selected!]) };
        return { ...state, selected, isolate: selected ? state.isolate : false };
      }
      case 'hover':
        return action.id === state.hovered || (action.id !== null && !known.has(action.id)) ? state : { ...state, hovered: action.id };
      case 'toggle-layer': {
        if (!layers.has(action.layer)) return state;
        const next = new Set(state.visibleLayers);
        if (next.has(action.layer)) next.delete(action.layer);
        else next.add(action.layer);
        return { ...state, visibleLayers: next };
      }
      case 'set-isolate':
        return { ...state, isolate: action.value };
      case 'set-labels':
        return { ...state, labels: action.value };
      case 'set-colour-by':
        return action.value === state.colourBy ? state : { ...state, colourBy: action.value };
      case 'set-body-colour':
        return action.value === state.bodyColour ? state : { ...state, bodyColour: action.value };
      case 'set-peel': {
        const value = Math.max(0, Math.min(PEEL.length - 1, Math.round(action.value)));
        return value === state.peel ? state : { ...state, peel: value };
      }
      case 'set-slice': {
        const at = action.at === undefined || !Number.isFinite(action.at) ? state.slice.at : Math.max(-1, Math.min(1, action.at));
        const axis = action.axis ?? state.slice.axis;
        // Choosing a new axis starts the cut in the middle.
        const fresh = action.axis !== undefined && action.axis !== state.slice.axis && action.at === undefined;
        const slice = { axis, at: fresh ? 0 : at, flip: action.flip ?? state.slice.flip };
        // A new axis or a flip turns the camera to face the cut, from the side the cut removed.
        const turned = axis !== 'off' && (axis !== state.slice.axis || slice.flip !== state.slice.flip);
        if (!turned) return { ...state, slice };
        return { ...state, slice, camera: cam(state, facingPreset(slice, state.view) ?? undefined) };
      }
      case 'set-view': {
        if (action.view === state.view) return state;
        const sel = state.selected && viewOf(def, state.selected) === action.view ? state.selected : null;
        return { ...state, view: action.view, selected: sel, slice: NO_SLICE, camera: cam(state, VIEW_CAMERA[action.view]) };
      }
      case 'open-block': {
        const preset = action.thick ? 'block-thick' : 'block-oblique';
        return { ...state, view: 'block', site: action.site ?? null, selected: null, slice: NO_SLICE, camera: cam(state, preset) };
      }
      case 'set-mode': {
        if (action.mode === state.mode) return state;
        if (action.mode === 'tour') {
          if (!def.tour.length) return state;
          return { ...state, mode: 'tour', tourIndex: 0, selected: null, isolate: false, playing: true, camera: stepCam(state, 0) };
        }
        const preset = modePreset(action.mode, state.sim);
        const v = preset ? presets.get(preset)?.view ?? state.view : state.view;
        return { ...state, mode: action.mode, view: v, playing: true, selected: null, slice: v !== state.view ? NO_SLICE : state.slice, camera: cam(state, preset) };
      }
      case 'set-sim': {
        const sim = patchSim(state.sim, action.patch);
        if (state.mode === 'tour' || state.mode === 'explore') return { ...state, sim };
        // A new sub-view moves the camera (and the scene) to suit it.
        const moved = (state.mode === 'wounds' && sim.woundView !== state.sim.woundView)
          || (state.mode === 'touch' && sim.touchView !== state.sim.touchView)
          || (state.mode === 'life' && sim.lifeView !== state.sim.lifeView);
        if (!moved) return { ...state, sim };
        const preset = modePreset(state.mode, sim)!;
        const v = presets.get(preset)?.view ?? state.view;
        return { ...state, sim, view: v, selected: null, slice: NO_SLICE, camera: cam(state, preset) };
      }
      case 'try-step': {
        const s = step(def, state);
        if (!s) return state;
        return {
          ...state, mode: s.mode ?? 'explore', view: effectiveView(def, state), selected: null, playing: true,
          sim: patchSim(state.sim, s.params ?? {}), slice: s.slice ? { axis: s.slice.axis, at: s.slice.at, flip: s.slice.flip ?? false } : state.slice, peel: s.peel ?? state.peel,
        };
      }
      case 'set-playing':
        return { ...state, playing: action.value };
      case 'tour-go': {
        const index = Math.max(0, Math.min(def.tour.length - 1, action.index));
        if (!def.tour[index]) return state;
        return { ...state, mode: 'tour', tourIndex: index, camera: stepCam(state, index) };
      }
      case 'camera': {
        const p = presets.get(action.preset);
        if (!p) return state;
        const view = state.mode === 'tour' ? state.view : p.view;
        const selected = state.selected && viewOf(def, state.selected) !== view ? null : state.selected;
        return { ...state, view, selected, slice: view !== state.view ? NO_SLICE : state.slice, camera: { preset: action.preset, focus: action.focus ?? [], ...(action.box ? { box: action.box } : {}), nonce: state.camera.nonce + 1 } };
      }
      case 'reset': {
        const fresh = initialState(def);
        return { ...fresh, camera: { ...fresh.camera, nonce: state.camera.nonce + 1 } };
      }
    }
  };
}
