import { createServer } from 'vite';
import { buildDesktop } from './build-tauri.mjs';
await buildDesktop({ frontend: false });
const server = await createServer();
await server.listen(); server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void server.close().finally(() => process.exit()); });
