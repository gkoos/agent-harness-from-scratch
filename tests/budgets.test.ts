import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../src/core/agent.ts';
import { scriptedModel } from '../src/models/fake.ts';

const noop = { name: 'noop', description: 'No operation', parameters: { type: 'object' }, async execute() { return 'ok'; } };

test('rejects an over-budget batch before executing any tools', async () => {
  let executed = 0;
  const result = await runAgent({ prompt: 'test', maxToolCalls: 1, model: scriptedModel([
    { content: '', toolCalls: [{ id: '1', name: 'noop', arguments: {} }, { id: '2', name: 'noop', arguments: {} }] }
  ]), tools: [{ ...noop, async execute() { executed++; return 'ok'; } }] });
  assert.equal(result.status, 'tool_limit');
  assert.equal(result.toolCalls, 0);
  assert.equal(executed, 0);
});

test('counts invalid and unknown tool requests against the budget', async () => {
  const result = await runAgent({ prompt: 'test', maxToolCalls: 1, model: scriptedModel([
    { content: '', toolCalls: [{ id: '1', name: 'unknown', arguments: {} }] },
    { content: '', toolCalls: [{ id: '2', name: 'noop', arguments: {} }] }
  ]), tools: [noop] });
  assert.equal(result.status, 'tool_limit');
  assert.equal(result.toolCalls, 1);
});

test('pre-aborted signals prevent model invocation', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await runAgent({ prompt: 'test', signal: controller.signal, model: scriptedModel([]), tools: [] });
  assert.equal(result.status, 'aborted');
  assert.equal(result.steps, 0);
});

test('deadline aborts a cooperative model', async () => {
  const result = await runAgent({ prompt: 'test', timeoutMs: 15, tools: [], model: {
    async generate({ signal }) {
      await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
      return { content: 'unreachable' };
    }
  } });
  assert.equal(result.status, 'timeout');
});

test('deadline aborts a cooperative tool', async () => {
  const result = await runAgent({ prompt: 'test', timeoutMs: 15, tools: [{ ...noop, async execute(_args, signal) {
    await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } }], model: scriptedModel([{ content: '', toolCalls: [{ id: '1', name: 'noop', arguments: {} }] }]) });
  assert.equal(result.status, 'timeout');
  assert.equal(result.toolCalls, 1);
});

test('rejects invalid budget configuration', async () => {
  await assert.rejects(runAgent({ prompt: 'test', model: scriptedModel([]), tools: [], maxToolCalls: -1 }), RangeError);
  await assert.rejects(runAgent({ prompt: 'test', model: scriptedModel([]), tools: [], timeoutMs: 0 }), RangeError);
});
