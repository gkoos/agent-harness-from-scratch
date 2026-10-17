import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../src/core/agent.ts';
import { scriptedModel } from '../src/models/fake.ts';

test('executes a tool and returns the model answer', async () => {
  const result = await runAgent({
    prompt: 'Calculate',
    model: scriptedModel([
      { content: '', toolCalls: [{ id: '1', name: 'double', arguments: 4 }] },
      { content: 'Eight.' }
    ]),
    tools: [{ name: 'double', description: 'Double a number', parameters: { type: 'number' }, async execute(n) { return Number(n) * 2; } }]
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.answer, 'Eight.');
  assert.deepEqual(result.messages[2], { role: 'tool', callId: '1', content: '8', isError: false });
});

test('unknown tools return an error to the model', async () => {
  const result = await runAgent({ prompt: 'Test', tools: [], model: scriptedModel([
    { content: '', toolCalls: [{ id: '1', name: 'missing', arguments: {} }] },
    { content: 'Recovered.' }
  ]) });
  assert.equal(result.status, 'completed');
  assert.equal(result.messages[2]?.role, 'tool');
  assert.equal((result.messages[2] as { isError: boolean }).isError, true);
});

test('terminates when step budget is exhausted', async () => {
  const result = await runAgent({ prompt: 'Test', maxSteps: 1, tools: [], model: scriptedModel([
    { content: '', toolCalls: [{ id: '1', name: 'missing', arguments: {} }] }
  ]) });
  assert.equal(result.status, 'step_limit');
  assert.equal(result.steps, 1);
});

test('does not call model when already aborted', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await runAgent({ prompt: 'Test', signal: controller.signal, tools: [], model: scriptedModel([]) });
  assert.equal(result.status, 'aborted');
});

test('invalid tool arguments are reported without execution', async () => {
  let executed = false;
  const result = await runAgent({ prompt: 'Test', model: scriptedModel([
    { content: '', toolCalls: [{ id: 'bad', name: 'echo', arguments: { text: 42 } }] },
    { content: 'I will correct my input.' }
  ]), tools: [{ name: 'echo', description: 'Echo text', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, async execute() { executed = true; return 'ok'; } }] });
  assert.equal(executed, false);
  assert.equal(result.status, 'completed');
  assert.match((result.messages[2] as { content: string }).content, /expected string/);
});

test('tool exceptions are recoverable', async () => {
  const result = await runAgent({ prompt: 'Test', model: scriptedModel([
    { content: '', toolCalls: [{ id: '1', name: 'fail', arguments: {} }] },
    { content: 'Recovered.' }
  ]), tools: [{ name: 'fail', description: 'Fails', parameters: { type: 'object' }, async execute() { throw new Error('disk unavailable'); } }] });
  assert.equal(result.status, 'completed');
  assert.equal((result.messages[2] as { isError: boolean }).isError, true);
});

test('model errors terminate without becoming tool messages', async () => {
  const result = await runAgent({ prompt: 'Test', tools: [], model: scriptedModel([]) });
  assert.equal(result.status, 'model_error');
  assert.match(result.error!, /exhausted/);
});

test('duplicate tool names are rejected before model invocation', async () => {
  const tool = { name: 'echo', description: 'Echo', parameters: { type: 'string' }, async execute() { return 'ok'; } };
  await assert.rejects(runAgent({ prompt: 'Test', model: scriptedModel([]), tools: [tool, tool] }), /Duplicate tool/);
});
