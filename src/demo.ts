import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from './core/agent.ts';
import { scriptedModel } from './models/fake.ts';
import { Workspace, workspaceTools } from './tools/workspace.ts';

const root = await mkdtemp(join(tmpdir(), 'harness-demo-'));
try {
  await writeFile(join(root, 'hello.txt'), 'Hello from the workspace!');
  const tools = workspaceTools(await Workspace.open(root));
  const result = await runAgent({
    prompt: 'Read hello.txt and report its contents', tools,
    model: scriptedModel([
      { content: '', toolCalls: [{ id: '1', name: 'read_file', arguments: { path: 'hello.txt' } }] },
      { content: 'The file says: Hello from the workspace!' }
    ])
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
