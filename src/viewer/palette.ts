import type { AnatomicalStructure } from '../contract/schema';
import type { ColourBy } from '../app/state';
import type { TissueLook } from './tissue';
import type { Pattern } from './histology';

/**
 * Real looks of the skin's tissues, chosen so the block reads like a stained section and like fresh
 * tissue at once: pale yellowish cornified layer, a glassy lucidum, a darker granular layer, pinkish-tan
 * living epidermis and a basal layer darkened by melanin; pale-pink papillary and deeper-pink reticular
 * dermis; yellow fat lobules between whitish septa; a silvery fascia. Vessels take their vertex
 * colours (arterial red, venous blue); nerves are cream-yellow.
 */
const REAL: Record<string, TissueLook> = {
  'body-skin': { color: '#e0a88e', roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4, sheen: 0.5, sheenColor: '#ffe2d4', rim: 0.45, rimColor: '#ff7a5c', ao: 0.9, mottle: 0.25, mottleTint: '#c27a62' },
  hair: { color: '#3b2619', roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.3, sheen: 0.6, sheenColor: '#a07850', rim: 0.1, ao: 0.8, mottle: 0.3, mottleTint: '#1e120a' },
  corneum: { color: '#ecdcae', roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.5, sheen: 0.3, sheenColor: '#fff6dc', rim: 0.2, rimColor: '#ffd9a8', ao: 0.9, mottle: 0.2, mottleTint: '#c8b080' },
  lucidum: { color: '#f4ead2', roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.2, rim: 0.1, ao: 0.6, mottle: 0.08 },
  granulosum: { color: '#b98a9c', roughness: 0.5, clearcoat: 0.2, sheen: 0.25, rim: 0.15, ao: 0.8, mottle: 0.25, mottleTint: '#7a4c6c' },
  spinosum: { color: '#e4b49c', roughness: 0.5, clearcoat: 0.25, sheen: 0.3, sheenColor: '#ffe0d0', rim: 0.25, rimColor: '#ff9a80', ao: 0.85, mottle: 0.22, mottleTint: '#b07a68' },
  basale: { color: '#a86c52', roughness: 0.5, clearcoat: 0.25, sheen: 0.3, rim: 0.2, rimColor: '#e0805c', ao: 0.85, mottle: 0.3, mottleTint: '#6a3c28' },
  melanocyte: { color: '#4e2c1a', roughness: 0.5, clearcoat: 0.2, sheen: 0.1, rim: 0.1, ao: 0, mottle: 0 },
  langerhans: { color: '#8a6fb8', roughness: 0.5, clearcoat: 0.3, sheen: 0.2, rim: 0.2, ao: 0, mottle: 0 },
  papillary: { color: '#f2c3c3', roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.35, sheenColor: '#ffe4e4', rim: 0.3, rimColor: '#ff8a8a', ao: 1, mottle: 0.2, mottleTint: '#d08a8a' },
  reticular: { color: '#e5a3ab', roughness: 0.5, clearcoat: 0.25, sheen: 0.3, rim: 0.2, rimColor: '#ff8a8a', ao: 0.8, mottle: 0.25, mottleTint: '#b86a74' },
  collagen: { color: '#f3dede', roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.25, sheen: 0.5, sheenColor: '#ffffff', rim: 0.1, ao: 0.7, mottle: 0.15, mottleTint: '#d8b8b8' },
  fat: { color: '#f2d886', roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.18, sheen: 0.3, sheenColor: '#fff6d0', rim: 0.2, rimColor: '#ffd060', ao: 0.8, mottle: 0.2, mottleTint: '#d8b050' },
  septa: { color: '#f1dcd6', roughness: 0.45, clearcoat: 0.4, sheen: 0.4, sheenColor: '#ffffff', rim: 0.1, ao: 0.8, mottle: 0.2, mottleTint: '#c8a8a0' },
  fascia: { color: '#e4e2ea', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15, sheen: 0.6, sheenColor: '#ffffff', rim: 0.15, rimColor: '#e0e8ff', ao: 0.6, mottle: 0.15, mottleTint: '#b0b0c0' },
  'hair-shaft': { color: '#3a2417', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.5, sheenColor: '#b08a60', rim: 0.1, ao: 0.5, mottle: 0.25, mottleTint: '#1e120a' },
  irs: { color: '#d8706e', roughness: 0.4, clearcoat: 0.4, sheen: 0.3, rim: 0.15, ao: 0.7, mottle: 0.2, mottleTint: '#a04848' },
  ors: { color: '#ead2c0', roughness: 0.45, clearcoat: 0.35, sheen: 0.35, sheenColor: '#fff0e8', rim: 0.2, rimColor: '#ffb090', ao: 0.8, mottle: 0.2, mottleTint: '#c0988a' },
  bulb: { color: '#8c5a40', roughness: 0.45, clearcoat: 0.35, sheen: 0.3, rim: 0.2, rimColor: '#e09070', ao: 0.7, mottle: 0.3, mottleTint: '#5a3020' },
  papilla: { color: '#e88c8c', roughness: 0.4, clearcoat: 0.45, sheen: 0.3, rim: 0.2, ao: 0.7, mottle: 0.2 },
  muscle: { color: '#c8826e', roughness: 0.45, clearcoat: 0.45, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: '#ffb0a0', rim: 0.25, rimColor: '#ff6a55', ao: 0.8, mottle: 0.3, mottleTint: '#7a2a28' },
  sebaceous: { color: '#f5e6c0', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15, sheen: 0.4, sheenColor: '#ffffff', rim: 0.2, rimColor: '#ffe0a0', ao: 0.8, mottle: 0.25, mottleTint: '#d8c088' },
  eccrine: { color: '#d07a9c', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.3, rim: 0.2, rimColor: '#ff9ac0', ao: 0.7, mottle: 0.2, mottleTint: '#904868' },
  apocrine: { color: '#c58ab8', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.3, rim: 0.2, rimColor: '#f0a8e0', ao: 0.7, mottle: 0.2, mottleTint: '#8a4c80' },
  meissner: { color: '#f0c48a', roughness: 0.35, clearcoat: 0.6, sheen: 0.4, sheenColor: '#fff4dc', rim: 0.2, rimColor: '#ffd890', ao: 0.6, mottle: 0.15 },
  merkel: { color: '#ffcf4a', roughness: 0.35, clearcoat: 0.6, sheen: 0.3, rim: 0.2, ao: 0.4, mottle: 0.1 },
  pacinian: { color: '#f2e6d6', roughness: 0.25, clearcoat: 0.85, clearcoatRoughness: 0.1, sheen: 0.5, sheenColor: '#ffffff', rim: 0.25, rimColor: '#ffe8c8', ao: 0.8, mottle: 0.1 },
  ruffini: { color: '#e8c890', roughness: 0.35, clearcoat: 0.6, sheen: 0.3, rim: 0.2, ao: 0.6, mottle: 0.15 },
  nerve: { color: '#f2d27a', roughness: 0.4, clearcoat: 0.55, clearcoatRoughness: 0.2, sheen: 0.45, sheenColor: '#fff8e0', rim: 0.2, rimColor: '#ffe4a0', ao: 0.6, mottle: 0.2, mottleTint: '#c8a868' },
  'free-ending': { color: '#ffd640', roughness: 0.35, clearcoat: 0.5, sheen: 0.3, rim: 0.3, rimColor: '#ffe680', ao: 0.4, mottle: 0.1 },
  vessel: { color: '#ffffff', roughness: 0.3, clearcoat: 0.75, clearcoatRoughness: 0.15, sheen: 0.2, rim: 0.2, rimColor: '#ff6a60', ao: 0.6, mottle: 0.12, mottleTint: '#a0a0a0' },
  lymph: { color: '#9ed486', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15, sheen: 0.3, sheenColor: '#e8ffe0', rim: 0.2, rimColor: '#c8ffb0', ao: 0.6, mottle: 0.1 },
};

const KIND: Record<string, string> = {
  'body-skin': 'body-skin', 'scalp-hair': 'hair', 'pubic-hair': 'hair',
  'stratum-corneum': 'corneum', 'stratum-lucidum': 'lucidum', 'stratum-granulosum': 'granulosum', 'stratum-spinosum': 'spinosum', 'stratum-basale': 'basale',
  melanocytes: 'melanocyte', 'langerhans-cells': 'langerhans',
  'papillary-dermis': 'papillary', 'reticular-dermis': 'reticular', 'collagen-bundles': 'collagen',
  'subcutaneous-fat': 'fat', 'fibrous-septa': 'septa', 'deep-fascia': 'fascia',
  'hair-shaft': 'hair-shaft', 'inner-root-sheath': 'irs', 'hair-follicle': 'ors', 'hair-bulb': 'bulb', 'hair-papilla': 'papilla',
  'arrector-pili': 'muscle', 'sebaceous-gland': 'sebaceous', 'eccrine-gland': 'eccrine', 'apocrine-gland': 'apocrine',
  'meissner-corpuscle': 'meissner', 'merkel-discs': 'merkel', 'pacinian-corpuscle': 'pacinian', 'ruffini-ending': 'ruffini',
  'free-nerve-endings': 'free-ending', 'hair-follicle-plexus': 'nerve', 'cutaneous-nerve': 'nerve',
  'superficial-plexus': 'vessel', 'deep-plexus': 'vessel', 'lymphatic-vessels': 'lymph',
};

/** The histology pattern drawn on each tissue's surfaces and cut faces (see histology.ts). */
const PATTERN: Record<string, Pattern> = {
  corneum: 'corneum', lucidum: 'lucidum', granulosum: 'granulosum', spinosum: 'spinosum', basale: 'basale',
  papillary: 'papillary', reticular: 'reticular', fat: 'fat', septa: 'septa', fascia: 'septa', collagen: 'papillary',
  muscle: 'muscle', sebaceous: 'sebaceous', eccrine: 'gland', apocrine: 'gland', ors: 'spinosum', bulb: 'basale', papilla: 'papillary',
  irs: 'granulosum', pacinian: 'papillary', nerve: 'nerve',
};

function kindOf(s: AnatomicalStructure): string {
  return KIND[s.id] ?? (s.layer === 'nerves' ? 'nerve' : 'papillary');
}

export function realLook(s: AnatomicalStructure): TissueLook {
  return REAL[kindOf(s)] ?? REAL.papillary!;
}
export function patternOf(s: AnatomicalStructure): Pattern {
  return PATTERN[kindOf(s)] ?? 'none';
}
/** Meshes whose real colour comes from their vertex colours (arterial red → venous blue). */
export const VERTEX_COLOURED = new Set(['superficial-plexus', 'deep-plexus']);

/** How see-through each part is in its real look (1 = opaque). */
export function realOpacity(_s: AnatomicalStructure): number {
  return 1;
}

/** One hue per layer (Colour: Layers). */
export const LAYER_COLOUR: Record<string, string> = {
  body: '#e0a88e', epidermis: '#e8b878', dermis: '#e88a9a', hypodermis: '#f2d060', appendages: '#9a7ad8', receptors: '#ffcf4a', vessels: '#d0304a', nerves: '#f6e08a',
};
/** Groups get their own colours for the overview tour step. */
const GROUP_COLOUR: Record<string, string> = {
  'skin-surface': '#e0a88e', epidermis: '#e8b878', dermis: '#e88a9a', hypodermis: '#f2d060', 'hair-unit': '#9a7ad8', 'skin-glands': '#c87ab0',
  'cutaneous-receptors': '#ffcf4a', 'cutaneous-vessels': '#d0304a',
};

/** The colour a structure shows in the current colour mode. */
export function baseColour(s: AnatomicalStructure, colourBy: ColourBy): string {
  if (s.kind === 'group') return GROUP_COLOUR[s.id] ?? LAYER_COLOUR[s.layer] ?? realLook(s).color;
  if (colourBy === 'layer') return LAYER_COLOUR[s.layer] ?? realLook(s).color;
  if (VERTEX_COLOURED.has(s.id)) return '#c0272d';
  return realLook(s).color;
}

export const HIGHLIGHT = '#ffc94d';
export const HOVER = '#ffe7a8';

/** Cut-surface colours: what a section through each tissue shows (a touch deeper than the surface). */
const CUT: Record<string, string> = {
  'body-skin': '#e8c0a8', hair: '#3b2619', corneum: '#efd9a4', lucidum: '#f6ecd4', granulosum: '#a8708c', spinosum: '#e2ae96', basale: '#9a5e46',
  melanocyte: '#4e2c1a', langerhans: '#8a6fb8', papillary: '#f4c6c6', reticular: '#e29aa4', collagen: '#f0d0d0', fat: '#f6e09a', septa: '#ecc8c4', fascia: '#dcd8e4',
  'hair-shaft': '#4a2c1c', irs: '#d66a6a', ors: '#ecd4c4', bulb: '#8a5640', papilla: '#e88888', muscle: '#c47a68', sebaceous: '#f6ead0', eccrine: '#d07aa0', apocrine: '#c088b6',
  meissner: '#f0c080', merkel: '#ffc840', pacinian: '#f0e2d0', ruffini: '#e6c48a', nerve: '#f0cc70', 'free-ending': '#ffd640', vessel: '#b02a30', lymph: '#9ad080',
};
export function cutColour(s: AnatomicalStructure): string {
  if (s.id === 'deep-plexus' || s.id === 'superficial-plexus') return '#b02a30';
  return CUT[kindOf(s)] ?? '#e0b0b0';
}

/** Rule-of-nines region colours, in _REGION order. */
export const REGION_COLOURS = ['#f2c14e', '#5aa9e6', '#3d7cc9', '#f08a5d', '#b8475f', '#7ac77a', '#3f9a5a', '#9b6ad6'];
/**
 * Dermatome colours, in _DERMATOME order (C2…S5): each region of the cord has its own hue family
 * (cervical blue–violet, thoracic warm, lumbar green, sacral magenta) and neighbouring levels
 * alternate strongly in hue and lightness so adjacent bands stay distinct.
 */
export const DERMATOME_COLOURS: string[] = (() => {
  const out: string[] = [];
  const groups: [number, number, number][] = [[7, 190, 34], [12, 0, 22], [5, 95, 30], [5, 290, 26]]; // count, base hue, hue step
  for (const [n, base, step] of groups) for (let i = 0; i < n; i++) out.push(hsl((base + (i % 2 ? 0.5 : 0) * step + i * step * 0.55) % 360, 68, i % 2 ? 74 : 52));
  return out;
})();
export const TRIGEMINAL_COLOUR = '#bdb6b0';
function hsl(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => { const k = (n + h / 30) % 12; const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
