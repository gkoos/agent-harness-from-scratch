import { spawn } from 'node:child_process';
import type { Tool } from '../core/types.ts';

export type CommandPreset = { executable: string; args: readonly string[]; timeoutMs?: number };

/** Model selects a named, developer-configured command. It cannot supply shell text or arguments. */
export function commandTool(cwd: string, presets: Readonly<Record<string, CommandPreset>>): Tool {
  const names = Object.keys(presets);
  if (!names.length) throw new Error('At least one command preset is required');
  return {
    name: 'run_command', description: `Run one configured command: ${names.join(', ')}`,
    parameters: { type: 'object', properties: { command: { type: 'string', enum: names } }, required: ['command'], additionalProperties: false },
    async execute(value, signal) {
      signal.throwIfAborted();
      const name = (value as { command: string }).command;
      if (!Object.hasOwn(presets, name)) throw new Error('Command not permitted');
      const preset = presets[name]!;
      const timeout = preset.timeoutMs ?? 10_000;
      if (!Number.isSafeInteger(timeout) || timeout < 1) throw new Error('Invalid timeout');
      return await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(preset.executable, [...preset.args], { cwd, shell: false, signal, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        const limit = 64 * 1024;
        let exceeded = false;
        const timer = setTimeout(() => child.kill(), timeout);
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          if (stdout.length > limit) { exceeded = true; child.kill(); }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
          if (stderr.length > limit) { exceeded = true; child.kill(); }
        });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => {
          clearTimeout(timer);
          if (signal.aborted) return reject(signal.reason ?? new Error('Aborted'));
          if (exceeded) return reject(new Error('Command output limit exceeded'));
          resolve({ exitCode: code, stdout, stderr });
        });
      });
    }
  };
}
