import { readFile, writeFile } from 'node:fs/promises';
// Only the public key enters source control. Never print or copy the private key.
const path = 'src-tauri/tauri.conf.json';
const config = JSON.parse(await readFile(path, 'utf8'));
config.plugins.updater.pubkey = (await readFile('.signing/tauri-update.key.pub', 'utf8')).trim();
await writeFile(path, JSON.stringify(config, null, 2) + '\n');
