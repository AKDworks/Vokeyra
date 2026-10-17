import { readFile, writeFile } from 'node:fs/promises';
import { mergeUpdateManifests } from './update-manifest.mjs';
const [output, ...inputs] = process.argv.slice(2);
if (!output || !inputs.length) throw new Error('Usage: node scripts/merge-update-manifests.mjs latest.json <platform manifest> ...');
const manifests = await Promise.all(inputs.map(async path => JSON.parse(await readFile(path, 'utf8'))));
await writeFile(output, JSON.stringify(mergeUpdateManifests(manifests), null, 2) + '\n');
