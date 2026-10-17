import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, dirname } from 'node:path';
import type { Tool } from '../core/types.ts';

const fileArgs = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false };

/** Paths are confined to the canonical workspace root. No symlink components are permitted. */
export class Workspace {
  readonly root: string;
  private constructor(root: string) { this.root = root; }
  static async open(root: string): Promise<Workspace> { return new Workspace(await realpath(root)); }

  private lexical(path: string): string {
    if (!path || isAbsolute(path)) throw new Error('Expected a relative workspace path');
    const full = resolve(this.root, path);
    const rel = relative(this.root, full);
    if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
      throw new Error('Path is outside the workspace or refers to its root');
    }
    return full;
  }

  /** Reject symlinks in every existing component, not just the final file. */
  private async check(path: string, allowMissingFinal: boolean): Promise<string> {
    const full = this.lexical(path);
    const rel = relative(this.root, full);
    const parts = rel.split(/[\\/]/);
    let current = this.root;
    for (let i = 0; i < parts.length; i++) {
      current = resolve(current, parts[i]!);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) throw new Error('Symbolic links are not permitted');
        if (i < parts.length - 1 && !stat.isDirectory()) throw new Error('Parent is not a directory');
      } catch (error) {
        if (allowMissingFinal && i === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
    }
    return full;
  }

  async read(path: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const full = await this.check(path, false);
    const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (!(await handle.stat()).isFile()) throw new Error('Not a regular file');
      return await handle.readFile({ encoding: 'utf8', signal });
    } finally { await handle.close(); }
  }

  async write(path: string, content: string, signal: AbortSignal): Promise<{ path: string; bytes: number }> {
    signal.throwIfAborted();
    const full = await this.check(path, true);
    // No recursive directory creation: parent directories must already exist.
    const parent = await realpath(dirname(full));
    const rel = relative(this.root, parent);
    if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Parent outside workspace');
    const handle = await open(full, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(content, { encoding: 'utf8', signal }); }
    finally { await handle.close(); }
    return { path, bytes: Buffer.byteLength(content) };
  }
}

export function workspaceTools(workspace: Workspace): Tool[] {
  return [
    { name: 'read_file', description: 'Read a UTF-8 file relative to the workspace', parameters: fileArgs,
      async execute(value, signal) { return await workspace.read((value as { path: string }).path, signal); } },
    { name: 'write_file', description: 'Write a UTF-8 file relative to the workspace',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
      async execute(value, signal) { const { path, content } = value as { path: string; content: string }; return await workspace.write(path, content, signal); } }
  ];
}
