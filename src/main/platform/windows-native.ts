import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { config } from '../host';

export class WindowsNative {
  private child?: ChildProcessWithoutNullStreams;
  private next = 1;
  private pending = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  onRelease = () => {};
  onFailure = (_error: Error) => {};

  async start(): Promise<void> {
    if (this.child) return;
    const file = join(config.resourcePath, 'native', 'Vokeyra.Desktop.exe');
    const child = spawn(file, [String(process.pid)], { windowsHide: true, stdio: 'pipe' });
    this.child = child;
    const fail = (error: Error) => {
      if (this.child !== child) return;
      this.child = undefined;
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
      this.pending.clear();
      this.onFailure(error);
    };
    child.on('error', fail);
    child.on('exit', () => fail(new Error('Системный модуль Windows завершился. Перезапустите Vokeyra.')));
    child.stdin.on('error', fail);
    child.stderr.on('data', data => console.error(String(data)));
    createInterface({ input: child.stdout }).on('line', line => {
      const [id, status, value = ''] = line.split('\t');
      if (id === '0' && status === 'release') { this.onRelease(); return; }
      const item = this.pending.get(Number(id));
      if (!item) return;
      this.pending.delete(Number(id)); clearTimeout(item.timer);
      if (status === 'ok') item.resolve(value);
      else item.reject(new Error(`Системный модуль: ${Buffer.from(value, 'base64').toString('utf8')}`));
    });
    await this.command('ping');
  }
  command(command: 'ping' | 'watch' | 'unwatch' | 'mute' | 'restore' | 'audio-state' | 'key' | 'type', argument = ''): Promise<string> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('Системный модуль Windows недоступен.'));
    return new Promise((resolve, reject) => {
      const id = this.next++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Системный модуль Windows не отвечает.')); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${id}\t${command}\t${argument}\n`);
    });
  }
  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.onFailure = () => {};
    await this.command('restore').catch(() => {});
    child.stdin.end();
    await new Promise<void>(resolve => { child.once('exit', () => resolve()); if (child.exitCode !== null) resolve(); });
  }
}
