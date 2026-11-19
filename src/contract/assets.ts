/**
 * Approved asset registry. Definitions reference assets only by these ids; the runtime resolves
 * the file, and the validators check that every mesh structure has a node in the asset. Adding an
 * asset here requires a provenance and licence entry in public/ATTRIBUTION.md.
 */
import geometry from '../skin/generated/geometry.json';

export interface ApprovedAsset {
  id: string;
  /** Path relative to the app's base URL. */
  file: string;
  format: 'glb';
  license: string;
  attribution: string;
  /** Node names present in the file; generated with the model. */
  nodes: readonly string[];
}

export const APPROVED_ASSETS: Readonly<Record<string, ApprovedAsset>> = {
  'skin-v1': {
    id: 'skin-v1',
    file: 'models/skin.glb',
    format: 'glb',
    license: 'CC-BY-4.0',
    attribution: 'Body surface and hair: BodyParts3D (DBCLS), CC BY 4.0; skin block modelled for this lab',
    nodes: Object.keys(geometry.structures),
  },
};
