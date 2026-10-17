import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../src/core/agent.ts';
import { scriptedModel } from '../src/models/fake.ts';
import type { AgentEvent } from '../src/core/events.ts';

const tool = { name: 'echo', description: 'Echo', parameters: { type: 'object' }, async execute() { return 'ok'; } };

test('emits ordered, correlated events and accumulates provider usage', async () => {
  const events: AgentEvent[] = [];
  const result = await runAgent({ prompt: 'hi', tools: [tool], onEvent: event => events.push(event), model: scriptedModel([
    { content: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: {} }], usage: { inputTokens: 10, outputTokens: 3 } },
    { content: 'done', usage: { inputTokens: 8, outputTokens: 2 } }
  ]) });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.usage, { inputTokens: 18, outputTokens: 5, modelCallsWithUsage: 2 });
  assert.deepEqual(events.map(e => e.type), ['model_start', 'model_end', 'tool_start', 'tool_end', 'model_start', 'model_end', 'run_end']);
  assert.deepEqual(events.map(e => e.sequence), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(events.every(e => e.runId === result.runId && Number.isFinite(Date.parse(e.timestamp))));
  assert.equal((events[3] as Extract<AgentEvent, { type: 'tool_end' }>).isError, false);
  assert.ok(!JSON.stringify(events).includes('"arguments"'));
});

test('observer failures cannot alter execution', async () => {
  let failures = 0;
  const result = await runAgent({ prompt: 'hi', tools: [], model: scriptedModel([{ content: 'ok' }]),
    onEvent() { throw Error('observer failed'); }, onObserverError() { failures++; throw Error('also failed'); } });
  assert.equal(result.status, 'completed');
  assert.equal(failures, 3);
});

test('missing usage is unknown rather than reported as provider usage', async () => {
  const result = await runAgent({ prompt: 'hi', tools: [], model: scriptedModel([{ content: 'ok' }]) });
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0, modelCallsWithUsage: 0 });
});

test('recoverable tool failures are visible without leaking tool inputs', async () => {
  const events: AgentEvent[] = [];
  const result = await runAgent({ prompt: 'hi', tools: [tool], onEvent: e => events.push(e), model: scriptedModel([
    { content: '', toolCalls: [{ id: 'c1', name: 'missing', arguments: { secret: 'do-not-log' } }] },
    { content: 'done' }
  ]) });
  assert.equal(result.status, 'completed');
  const ended = events.find(e => e.type === 'tool_end');
  assert.equal(ended?.type === 'tool_end' && ended.isError, true);
  assert.ok(!JSON.stringify(events).includes('do-not-log'));
});

test('model errors emit model_error and one run_end', async () => {
  const events: AgentEvent[] = [];
  const result = await runAgent({ prompt: 'hi', tools: [], onEvent: e => events.push(e), model: scriptedModel([]) });
  assert.equal(result.status, 'model_error');
  assert.deepEqual(events.map(e => e.type), ['model_start', 'model_error', 'run_end']);
});

test('pre-aborted runs emit only a terminal event', async () => {
  const controller = new AbortController(); controller.abort();
  const events: AgentEvent[] = [];
  const result = await runAgent({ prompt: 'hi', tools: [], signal: controller.signal, onEvent: e => events.push(e), model: scriptedModel([]) });
  assert.equal(result.status, 'aborted');
  assert.deepEqual(events.map(e => e.type), ['run_end']);
});

test('invalid usage terminates as model error instead of corrupting totals', async () => {
  const result = await runAgent({ prompt: 'hi', tools: [], model: scriptedModel([{ content: 'ok', usage: { inputTokens: -1 } }]) });
  assert.equal(result.status, 'model_error');
  assert.equal(result.usage.modelCallsWithUsage, 0);
});
