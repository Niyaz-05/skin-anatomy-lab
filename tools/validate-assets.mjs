#!/usr/bin/env node
/**
 * Checks public/models/skin.glb against its provenance and geometry records:
 * file hash and size budget, node set (= the contract in docs/STRUCTURES.md), extras.layer,
 * finite positions, unit normals, in-range indices, sane bounds per scene (body in metres, block in
 * millimetres), the two scenes, the instanced cells, the body's region and dermatome labels, the baked
 * shading attribute, the named anchors and the attribution file. Exits non-zero on any failure so it can gate builds.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (msg) => problems.push(msg);

const glbPath = path.join(root, 'public/models/skin.glb');
const glb = fs.readFileSync(glbPath);
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'src/skin/generated/provenance.json'), 'utf8'));
const geometry = JSON.parse(fs.readFileSync(path.join(root, 'src/skin/generated/geometry.json'), 'utf8'));

const MAX_BYTES = 8 * 1024 * 1024;
if (glb.byteLength > MAX_BYTES) fail(`skin.glb is ${glb.byteLength} bytes, over the ${MAX_BYTES} byte budget`);
const hash = crypto.createHash('sha256').update(glb).digest('hex');
if (hash !== provenance.output.sha256) fail(`skin.glb sha256 ${hash} does not match provenance ${provenance.output.sha256}`);

// The contract: every id and layer listed in docs/STRUCTURES.md.
const contract = fs.readFileSync(path.join(root, 'docs/STRUCTURES.md'), 'utf8');
const contractLayers = {};
for (const line of contract.split('\n')) {
  const m = line.match(/^\| `([a-z-]+)` \| (.*) \|$/);
  if (!m) continue;
  for (const id of m[2].matchAll(/`([a-z0-9-]+)`/g)) contractLayers[id[1]] = m[1];
}

const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(glb));
const sceneNames = doc.getRoot().listScenes().map((sc) => sc.getName()).sort();
if (sceneNames.join() !== 'block,body') fail(`skin.glb must hold the scenes "body" and "block", found ${sceneNames}`);
const nodes = doc.getRoot().listNodes();
const names = nodes.map((n) => n.getName());
const expected = Object.keys(geometry.structures);
for (const id of expected) if (!names.includes(id)) fail(`node "${id}" missing from skin.glb`);
for (const n of names) if (!expected.includes(n)) fail(`unexpected node "${n}" in skin.glb`);
if (new Set(names).size !== names.length) fail('duplicate node names in skin.glb');
for (const [id, layer] of Object.entries(contractLayers)) if (!names.includes(id)) fail(`contract id "${id}" (${layer}) missing from skin.glb`);
for (const n of names) if (!(n in contractLayers)) fail(`node "${n}" is not in docs/STRUCTURES.md`);

let triangles = 0;
for (const node of nodes) {
  const id = node.getName();
  const layer = node.getExtras()?.layer;
  const scene = node.getExtras()?.scene;
  const expectScene = layer === 'body' ? 'body' : 'block';
  if (scene !== expectScene) fail(`${id}: extras.scene "${scene}", expected "${expectScene}"`);
  if (geometry.structures[id]?.scene !== scene) fail(`${id}: geometry.json scene does not match`);
  const parentScene = doc.getRoot().listScenes().find((sc) => sc.listChildren().includes(node))?.getName();
  if (parentScene !== scene) fail(`${id}: node is in scene "${parentScene}", extras say "${scene}"`);
  const instancing = node.getExtension('EXT_mesh_gpu_instancing');
  if ((id === 'melanocytes' || id === 'langerhans-cells') !== !!instancing) fail(`${id}: instancing ${instancing ? 'present' : 'missing'}`);
  if (instancing && instancing.getAttribute('TRANSLATION').getCount() !== geometry.structures[id].instances) fail(`${id}: instance count differs from geometry.json`);
  if (layer !== contractLayers[id]) fail(`${id}: extras.layer "${layer}" but the contract says "${contractLayers[id]}"`);
  const mesh = node.getMesh();
  if (!mesh) { fail(`${id}: node has no mesh`); continue; }
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')?.getArray();
    const nor = prim.getAttribute('NORMAL')?.getArray();
    const idx = prim.getIndices()?.getArray();
    if (!pos || !nor || !idx) { fail(`${id}: missing POSITION, NORMAL or indices`); continue; }
    if (pos.length !== nor.length) fail(`${id}: ${pos.length / 3} positions but ${nor.length / 3} normals`);
    for (let i = 0; i < pos.length; i++) {
      if (!Number.isFinite(pos[i])) { fail(`${id}: non-finite position at ${i}`); break; }
      // Body: metres, within 2 m; block: millimetres, within the 6 × 4 × 6 mm block (+ the hair above it).
      const lim = node.getExtras()?.scene === 'body' ? 2 : 6.5;
      if (Math.abs(pos[i]) > lim) { fail(`${id}: position ${pos[i]} outside the expected range`); break; }
    }
    for (let i = 0; i < nor.length; i += 3) {
      const len = Math.hypot(nor[i], nor[i + 1], nor[i + 2]);
      if (Math.abs(len - 1) > 1e-3) { fail(`${id}: normal ${i / 3} has length ${len}`); break; }
    }
    const vCount = pos.length / 3;
    for (const i of idx) if (i >= vCount) { fail(`${id}: index ${i} >= vertex count ${vCount}`); break; }
    if (idx.length % 3) fail(`${id}: index count ${idx.length} not divisible by 3`);
    const tissue = prim.getAttribute('_TISSUE');
    if (!tissue) fail(`${id}: no baked _TISSUE shading attribute (run tools/bake-shading.mjs)`);
    else if (tissue.getCount() !== vCount || tissue.getElementSize() !== 4 || !tissue.getNormalized()) fail(`${id}: _TISSUE must be normalised VEC4, one per vertex`);
    triangles += idx.length / 3;
    const recorded = geometry.structures[id];
    if (recorded && recorded.triangleCount !== idx.length / 3) fail(`${id}: ${idx.length / 3} triangles, geometry.json says ${recorded.triangleCount}`);
  }
}

// Anchors named in the contract.
const a = geometry.anchors ?? {};
const isVec = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
for (const k of ['hair-exit', 'follicle-bulb', 'arrector-insertion', 'sebaceous-gland']) if (!isVec(a[k])) fail(`anchor "${k}" missing or not a point`);
for (const k of ['depth-epidermis-top', 'depth-dermal-junction', 'depth-dermis-hypodermis', 'depth-fascia']) if (!Number.isFinite(a[k]?.thin) || !Number.isFinite(a[k]?.thick)) fail(`anchor "${k}" needs thin and thick depths`);
if (!(a['depth-dermal-junction']?.thick < a['depth-dermal-junction']?.thin)) fail('thick epidermis must be deeper than thin');
for (const k of ['meissner-corpuscle', 'merkel-discs', 'pacinian-corpuscle', 'ruffini-ending', 'free-nerve-endings']) if (!Array.isArray(a.receptors?.[k]) || !a.receptors[k].length || !a.receptors[k].every((r) => isVec(r.p) && Number.isFinite(r.depthMm))) fail(`receptor anchors "${k}" missing`);
if (!Array.isArray(a['sweat-pore']) || !a['sweat-pore'].length) fail('anchor "sweat-pore" missing');
if (!a['superficial-plexus-lines']?.arterioles?.length || !a['deep-plexus-lines']?.arteries?.length) fail('plexus centre lines missing');
if (!Number.isFinite(a['thick-thin-boundary']?.x)) fail('anchor "thick-thin-boundary" missing');
const regionIds = ['head-neck', 'arm-left', 'arm-right', 'trunk-anterior', 'trunk-posterior', 'leg-left', 'leg-right', 'perineum'];
if (JSON.stringify(a['body-regions']?.regions?.map((r) => r.id)) !== JSON.stringify(regionIds)) fail('body-regions must list the eight rule-of-nines regions in order');
if (a.dermatomes?.levels?.length !== 29 || a.dermatomes.levels[0] !== 'C2' || a.dermatomes.levels[28] !== 'S5') fail('dermatomes must list C2…S5');
{
  const skin = nodes.find((n) => n.getName() === 'body-skin')?.getMesh()?.listPrimitives()[0];
  const reg = skin?.getAttribute('_REGION'), der = skin?.getAttribute('_DERMATOME');
  if (!reg || !der) fail('body-skin needs _REGION and _DERMATOME attributes');
  else {
    const n = skin.getAttribute('POSITION').getCount();
    if (reg.getCount() !== n || der.getCount() !== n) fail('body labels must have one value per vertex');
    if ([...reg.getArray()].some((v) => v > 7)) fail('_REGION values must be 0–7');
    if ([...der.getArray()].some((v) => v > 28 && v !== 255)) fail('_DERMATOME values must be 0–28 or 255');
    const seen = new Set(der.getArray());
    if (seen.size < 25) fail(`only ${seen.size} dermatome labels used on the body`);
  }
  for (const r of a['body-regions']?.regions ?? []) if (Math.abs(r.measuredPercent - r.percent) > Math.max(2, r.percent * 0.2)) fail(`region ${r.id} covers ${r.measuredPercent}% (rule of nines: ${r.percent}%)`);
}

const attribution = path.join(root, 'public/ATTRIBUTION.md');
if (!fs.existsSync(attribution)) fail('public/ATTRIBUTION.md is missing');
else {
  const text = fs.readFileSync(attribution, 'utf8');
  for (const needle of ['BodyParts3D', 'Database Center for Life Science', 'CC BY 4.0', 'FJ2810', 'FJ2813', 'FJ2815', provenance.sources.bodyparts3d.atlasJsonSha256, provenance.output.sha256]) {
    if (!text.includes(needle)) fail(`public/ATTRIBUTION.md does not mention "${needle}"`);
  }
}

if (problems.length) {
  console.error(`Asset validation FAILED (${problems.length}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Asset validation passed: ${names.length} nodes, ${triangles} triangles, ${(glb.byteLength / 1048576).toFixed(2)} MB, sha256 ${hash.slice(0, 12)}…`);
