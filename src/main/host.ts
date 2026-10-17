import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

// The service talks only to its parent over inherited pipes, never a TCP port.
export interface HostConfig { dataPath: string; resourcePath: string; version: string; packaged: boolean; hidden: boolean }
export const config: HostConfig = JSON.parse(process.env.VOKEYRA_HOST_CONFIG || '{}');
if (!config.dataPath || !config.resourcePath || !config.version) throw new Error('Missing desktop host configuration.');
const output = process.stdout.write.bind(process.stdout);
console.log = (...values) => console.error(...values);
const send = (message: unknown) => output(JSON.stringify(message) + '\n');
export const hostEvents = new EventEmitter();
const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
let next = 0;
let connected = true;
export function host<T = void>(method: string, ...args: unknown[]): Promise<T> {
  if (!connected) return Promise.reject(new Error('Desktop host disconnected.'));
  return new Promise((resolve, reject) => {
    const hostId = ++next;
    const timer = setTimeout(() => { pending.delete(hostId); reject(new Error(`Desktop host timeout: ${method}`)); }, method === 'update:check' ? 20 * 60_000 : 30_000);
    pending.set(hostId, { resolve, reject, timer });
    send({ hostId, method, args });
  });
}
export function emit(event: string, payload?: unknown, target = 'main'): void { send({ event, payload: payload ?? null, target }); }
const routes = new Map<string, (...args: any[]) => unknown>();
export function route(method: string, handler: (...args: any[]) => unknown): void { routes.set(method, handler); }
let ready: Promise<void> = Promise.resolve();
export function serve(initialize: () => Promise<void>, shutdown: () => Promise<void>): void {
  ready = initialize();
  ready.catch(error => emit('service:error', String(error)));
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', line => {
    let message: any;
    try { message = JSON.parse(line); } catch { return; }
    if (typeof message.hostId === 'number') {
      const request = pending.get(message.hostId);
      if (request) { pending.delete(message.hostId); clearTimeout(request.timer); message.error ? request.reject(new Error(message.error)) : request.resolve(message.result); }
      return;
    }
    if (typeof message.event === 'string') { hostEvents.emit(message.event, message.payload); return; }
    if (typeof message.id !== 'number' || typeof message.method !== 'string' || !Array.isArray(message.args)) return;
    const { id, method, args } = message;
    void ready.then(async () => {
      if (method === 'service:shutdown') { await shutdown(); return; }
      const handler = routes.get(method);
      if (!handler) throw new Error('Unknown desktop command.');
      return handler(...args);
    }).then(result => send({ id, result: result ?? null }), error => send({ id, error: error instanceof Error ? error.message : String(error) }));
  });
  const disconnected = () => {
    if (!connected) return;
    connected = false;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Desktop host disconnected.')); }
    pending.clear();
    void shutdown().finally(() => process.exit());
  };
  input.on('close', disconnected);
  process.stdout.on('error', disconnected);
}
