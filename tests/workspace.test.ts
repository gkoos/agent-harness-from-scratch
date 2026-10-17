import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, workspaceTools } from '../src/tools/workspace.ts';
import { commandTool } from '../src/tools/commands.ts';
import { runAgent } from '../src/core/agent.ts';
import { scriptedModel } from '../src/models/fake.ts';

async function fixture(fn: (root: string, workspace: Workspace) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'harness-test-'));
  try { await fn(root, await Workspace.open(root)); } finally { await rm(root, { recursive: true, force: true }); }
}
const signal = new AbortController().signal;

test('read and write files within the workspace', async () => fixture(async (root, workspace) => {
  await mkdir(join(root, 'src'));
  await workspace.write('src/a.txt', 'hello', signal);
  assert.equal(await workspace.read('src/a.txt', signal), 'hello');
  assert.equal(await readFile(join(root, 'src/a.txt'), 'utf8'), 'hello');
}));

test('rejects traversal and absolute paths', async () => fixture(async (root, workspace) => {
  for (const path of ['../outside.txt', root, '/etc/passwd', '.']) {
    await assert.rejects(workspace.read(path, signal));
    await assert.rejects(workspace.write(path, 'oops', signal));
  }
}));

test('rejects symbolic links in path components', async () => fixture(async (root, workspace) => {
  await mkdir(join(root, 'real'));
  await writeFile(join(root, 'real', 'data.txt'), 'data');
  await symlink(join(root, 'real'), join(root, 'alias'), 'dir');
  await assert.rejects(workspace.read('alias/data.txt', signal), /Symbolic links/);
  await assert.rejects(workspace.write('alias/new.txt', 'no', signal), /Symbolic links/);
}));

test('invalid tool path is returned to model as recoverable error', async () => fixture(async (_root, workspace) => {
  const result = await runAgent({ prompt: 'Read outside', tools: workspaceTools(workspace), model: scriptedModel([
    { content: '', toolCalls: [{ id: '1', name: 'read_file', arguments: { path: '../secret' } }] },
    { content: 'Access denied.' }
  ]) });
  assert.equal(result.status, 'completed');
  assert.equal((result.messages[2] as { isError: boolean }).isError, true);
}));

test('command presets reject arbitrary command names', async () => fixture(async (root) => {
  const tool = commandTool(root, { version: { executable: process.execPath, args: ['--version'] } });
  await assert.rejects(tool.execute({ command: 'rm -rf .' }, signal), /not permitted/);
  const result = await tool.execute({ command: 'version' }, signal) as { exitCode: number; stdout: string };
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^v\d+/);
}));
