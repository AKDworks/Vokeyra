import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import type { SpeechEngine, TranscriptionRequest } from './types';

export class WhisperCppEngine implements SpeechEngine {
  readonly id = 'whisper.cpp';
  async transcribe(request: TranscriptionRequest): Promise<string> {
    request.signal.throwIfAborted();
    // Some Windows CLI builds use ANSI argv/fopen. Keep generated arguments ASCII
    // even when userData contains Cyrillic; CreateProcess handles the Unicode cwd.
    const cwd = dirname(request.wavPath);
    const args = ['-m', relative(cwd, request.modelPath), '-f', relative(cwd, request.wavPath), '-l', request.language,
      '-otxt', '-of', relative(cwd, request.outputPrefix), '-nt', '-ng'];
    if (request.vocabulary.length) args.push('--prompt', request.vocabulary.join(', '));
    await new Promise<void>((resolve, reject) => {
      // Direct process launch: never interpret a model path or language as shell code.
      const child = spawn(request.executable, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      let timedOut = false;
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
      const abort = () => child.kill();
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 15 * 60_000);
      const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener('abort', abort); };
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
      child.once('error', error => { cleanup(); reject(new Error(`Не удалось запустить whisper.cpp: ${error.message}`)); });
      child.once('close', code => {
        cleanup();
        if (request.signal.aborted) reject(new Error('Распознавание отменено.'));
        else if (timedOut) reject(new Error('Превышен лимит распознавания: 15 минут.'));
        else if (code !== 0) reject(new Error(`whisper.cpp завершился с кодом ${code}. ${stderr}`));
        else resolve();
      });
    });
    return (await readFile(`${request.outputPrefix}.txt`, 'utf8')).trim();
  }
}
