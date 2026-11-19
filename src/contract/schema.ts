/**
 * The simulation contract (skin edition). A SimulationDefinition is plain, serialisable data: it
 * names approved assets by id, lists the structures and layers a learner can work with, and
 * declares the learning content (routes such as the path of a touch signal, tour, objectives). The
 * runtime renders any definition that passes these schemas and the cross-reference checks in
 * validate.ts. Nothing in here may carry a URL (except https source links), a file path or code.
 */
import { z } from 'zod';

/** Lower-case kebab-case ids keep definitions portable and safe to use as DOM/URL keys. */
export const Id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'ids are lower-case kebab-case').max(64);
const Text = (max: number) => z.string().trim().min(1).max(max);
const Vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const Source = z.object({
  id: Id,
  citation: Text(400),
  url: z.url({ protocol: /^https$/ }).optional(),
  license: Text(80).optional(),
});
export type Source = z.infer<typeof Source>;

export const AssetRef = z.object({
  /** Key into the approved asset registry (assets.ts); never a path or URL. */
  id: Id,
  role: z.enum(['anatomy-model']),
});

export const Layer = z.object({
  id: Id,
  label: Text(60),
  description: Text(300),
  visibleByDefault: z.boolean(),
});
export type Layer = z.infer<typeof Layer>;

export const AnatomicalStructure = z.object({
  id: Id,
  label: Text(80),
  synonyms: z.array(Text(80)).max(12),
  layer: Id,
  /** mesh: a node of the same id exists in the model. group: no geometry; stands for `members`. */
  kind: z.enum(['mesh', 'group']),
  members: z.array(Id).min(1).max(30).optional(),
  side: z.enum(['right', 'left', 'midline']),
  /** Group this part belongs to (for example the iris belongs to the uvea). */
  organ: Id.optional(),
  summary: Text(400),
  function: Text(700),
  /** Clinical relevance (teaching level). */
  clinical: Text(500).optional(),
  related: z.array(Id).max(12),
  /** What the 3D model does and does not show for this structure. */
  modelNote: Text(400).optional(),
  sources: z.array(Id).min(1).max(6),
});
export type AnatomicalStructure = z.infer<typeof AnatomicalStructure>;

/** The two scenes of the model: the whole body, or the block of skin (docs/STRUCTURES.md). */
export const View = z.enum(['block', 'body']);
export type View = z.infer<typeof View>;

export const CameraPreset = z.object({
  id: Id,
  label: Text(40),
  /** Which scene the preset looks at; choosing it switches the view. */
  view: View,
  /** Unit-ish vector from the model centre towards the camera, in model axes. */
  direction: Vec3,
  up: Vec3.optional(),
  /** Structures this view frames (default: the view's home bounds). */
  frame: z.array(Id).max(16).optional(),
  /** Or a box to frame, in the view's own units (block: mm; body: m). */
  box: z.tuple([Vec3, Vec3]).optional(),
});
export type CameraPreset = z.infer<typeof CameraPreset>;

/** One stage of a route; off-model stages are explained in text only. */
export const RouteStep = z.object({
  structure: Id.optional(),
  offModel: z.enum(['environment', 'dorsal-root-ganglion', 'spinal-cord', 'brainstem', 'thalamus', 'somatosensory-cortex', 'hypothalamus', 'sympathetic-chain', 'heart', 'lymph-node']).optional(),
  label: Text(80),
  /** What happens here (cited in the route's sources). */
  note: Text(400).optional(),
}).refine((s) => (s.structure === undefined) !== (s.offModel === undefined), {
  message: 'a route step names exactly one of structure or offModel',
});
export type RouteStep = z.infer<typeof RouteStep>;

export const Route = z.object({
  id: Id,
  label: Text(80),
  description: Text(500),
  steps: z.array(RouteStep).min(2).max(24),
  /** Facts shown beside the animation; each cited in `sources`. */
  facts: z.array(Text(300)).max(8),
  assumptions: z.array(Text(300)).min(1).max(8),
  sources: z.array(Id).min(1).max(6),
});
export type Route = z.infer<typeof Route>;

export const SliceAxis = z.enum(['off', 'sagittal', 'coronal', 'axial']);
export type SliceAxis = z.infer<typeof SliceAxis>;

export const Mode = z.enum(['explore', 'temperature', 'wounds', 'touch', 'life', 'tour']);
export type Mode = z.infer<typeof Mode>;

/** Mode-specific settings a tour step can pass to its mode's panel (read by that mode). */
export const StepParams = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/).max(40), z.union([z.number().finite(), z.string().max(80), z.boolean()]));
export type StepParams = z.infer<typeof StepParams>;

export const TourStep = z.object({
  id: Id,
  title: Text(80),
  body: Text(700),
  focus: z.array(Id).max(16),
  camera: Id.optional(),
  mode: Mode.exclude(['tour']).optional(),
  /** Settings for the step's mode (for example an air temperature or a burn depth). */
  params: StepParams.optional(),
  /** The scene the step shows (default: its camera preset's). */
  view: View.optional(),
  /** Cut the model for this step: axis and position (-1 … 1 across the view's bounds). */
  slice: z.object({ axis: SliceAxis, at: z.number().min(-1).max(1), flip: z.boolean().optional() }).optional(),
  /** Peel the block from the top: 0 none … 5 down to the hypodermis (see PEEL in app/state.ts). */
  peel: z.number().int().min(0).max(5).optional(),
  colourBy: z.enum(['real', 'layer']).optional(),
  /** How the body surface is coloured in the body view. */
  bodyColour: z.enum(['real', 'regions', 'dermatomes']).optional(),
});
export type TourStep = z.infer<typeof TourStep>;

export const LearningObjective = z.object({ id: Id, text: Text(200) });

export const SimulationDefinition = z.object({
  schemaVersion: z.literal(1),
  id: Id,
  title: Text(100),
  domain: z.enum(['biology']),
  simulationType: z.enum(['3d-anatomy']),
  audience: Text(120),
  summary: Text(500),
  learningObjectives: z.array(LearningObjective).min(1).max(12),
  assets: z.array(AssetRef).min(1).max(4),
  layers: z.array(Layer).min(1).max(16),
  structures: z.array(AnatomicalStructure).min(1).max(140),
  cameraPresets: z.array(CameraPreset).min(1).max(16),
  defaultCamera: Id,
  /** Pathways shown step by step (a touch signal, a reflex arc…). */
  routes: z.array(Route).min(1).max(8),
  tour: z.array(TourStep).max(40),
  sources: z.array(Source).min(1).max(40),
  disclaimers: z.array(Text(400)).min(1).max(6),
});
export type SimulationDefinition = z.infer<typeof SimulationDefinition>;
