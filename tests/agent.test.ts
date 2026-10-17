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
