import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../src/core/agent.ts';
import { selectContext } from '../src/core/context.ts';
import { scriptedModel } from '../src/models/fake.ts';
import type { Model, Tool } from '../src/core/types.ts';

const noop: Tool = { name: 'noop', description: 'No-op', parameters: { type: 'object' }, async execute() { return 'ok'; } };
const call = (id: string) => ({ id, name: 'noop', arguments: {} });
const badModel = (response: unknown): Model => ({ async generate() { return response as Awaited<ReturnType<Model['generate']>>; } });

test('malformed model responses fail closed before any tool execution', async t => {
  const malformed: unknown[] = [null, [], {}, { content: 5 }, { content: '', toolCalls: {} },
    { content: '', toolCalls: [null] }, { content: '', toolCalls: [{ id: '', name: 'noop', arguments: {} }] },
    { content: '', toolCalls: [{ id: '1', name: '', arguments: {} }] },
    { content: '', toolCalls: [{ id: '1', name: 'noop' }] },
    { content: '', toolCalls: [call('1'), call('1')] }];
  for (const [i, response] of malformed.entries()) await t.test(`case ${i}`, async () => {
    let executed = 0;
    const result = await runAgent({ prompt: 'test', model: badModel(response), tools: [{ ...noop, async execute() { executed++; } }] });
    assert.equal(result.status, 'model_error');
    assert.equal(result.steps, 0);
    assert.equal(result.toolCalls, 0);
    assert.equal(executed, 0);
    assert.deepEqual(result.messages, [{ role: 'user', content: 'test' }]);
  });
});

test('budget-rejected batches never leave unmatched tool calls in the transcript', async () => {
  const result = await runAgent({ prompt: 'test', maxToolCalls: 1, model: scriptedModel([
    { content: '', toolCalls: [call('1'), call('2')] }
  ]), tools: [noop] });
  assert.equal(result.status, 'tool_limit');
  assert.equal(result.steps, 1);
  assert.equal(result.messages.length, 1);
  assert.deepEqual(selectContext(result.messages, 1000), result.messages);
});

test('invalid arguments are recoverable, allowing the model to correct itself', async () => {
  let executions = 0;
  const result = await runAgent({ prompt: 'test', tools: [{ ...noop, parameters: { type: 'object', required: ['x'], properties: { x: { type: 'integer' } } }, async execute() { executions++; return 'done'; } }], model: scriptedModel([
    { content: '', toolCalls: [{ id: '1', name: 'noop', arguments: { x: 'wrong' } }] },
    { content: '', toolCalls: [{ id: '2', name: 'noop', arguments: { x: 1 } }] },
    { content: 'fixed' }
  ]) });
  assert.equal(result.status, 'completed');
  assert.equal(executions, 1);
  assert.equal((result.messages[2] as { isError: boolean }).isError, true);
  assert.equal((result.messages[4] as { isError: boolean }).isError, false);
});

test('external cancellation while a tool is pending prevents the next tool', async () => {
  const controller = new AbortController();
  let calls = 0;
  const tool: Tool = { ...noop, async execute() { calls++; controller.abort(); return 'ignored'; } };
  const result = await runAgent({ prompt: 'test', signal: controller.signal, tools: [tool], model: scriptedModel([
    { content: '', toolCalls: [call('1'), call('2')] }
  ]) });
  assert.equal(result.status, 'aborted');
  assert.equal(calls, 1);
  assert.equal(result.toolCalls, 1);
});

test('observer exceptions do not change termination or tool execution', async () => {
  let observerErrors = 0;
  const result = await runAgent({ prompt: 'test', model: scriptedModel([{ content: 'done' }]), tools: [],
    onEvent() { throw new Error('telemetry failed'); }, onObserverError() { observerErrors++; throw new Error('also failed'); } });
  assert.equal(result.status, 'completed');
  assert.ok(observerErrors >= 2);
});

test('seeded tool-batch sizes respect admission limits for 150 cases', async () => {
  let seed = 0x12345678;
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let i = 0; i < 150; i++) {
    const limit = next() % 9;
    const batch = next() % 13;
    let executed = 0;
    const result = await runAgent({ prompt: 'test', maxToolCalls: limit, tools: [{ ...noop, async execute() { executed++; return 'ok'; } }], model: scriptedModel([
      { content: '', toolCalls: Array.from({ length: batch }, (_, j) => call(`call-${j}`)) },
      { content: 'done' }
    ]) });
    const admitted = batch <= limit;
    assert.equal(executed, admitted ? batch : 0, `case ${i}`);
    assert.equal(result.status, admitted ? 'completed' : 'tool_limit', `case ${i}`);
    assert.equal(result.toolCalls, admitted ? batch : 0, `case ${i}`);
    if (!admitted) assert.deepEqual(result.messages, [{ role: 'user', content: 'test' }]);
  }
});

test('seeded tool errors never escape as model errors', async () => {
  let executed = 0;
  for (let i = 0; i < 60; i++) {
    const result = await runAgent({ prompt: 'test', tools: [{ ...noop, async execute() { executed++; throw new Error(`failure ${i}`); } }], model: scriptedModel([
      { content: '', toolCalls: [call('1')] }, { content: 'recovered' }
    ]) });
    assert.equal(result.status, 'completed');
    assert.equal((result.messages[2] as { isError: boolean }).isError, true);
  }
  assert.equal(executed, 60);
});
