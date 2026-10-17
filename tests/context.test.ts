import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundToolResult, selectContext } from '../src/core/context.ts';
import { runAgent } from '../src/core/agent.ts';
import type { Message, Model } from '../src/core/types.ts';
import { scriptedModel } from '../src/models/fake.ts';

const batch: Message[] = [
  { role: 'assistant', content: '', toolCalls: [{ id: 'x', name: 'echo', arguments: {} }, { id: 'y', name: 'echo', arguments: {} }] },
  { role: 'tool', callId: 'x', content: 'a', isError: false },
  { role: 'tool', callId: 'y', content: 'b', isError: false }
];

test('context selection preserves complete tool batches', () => {
  const messages: Message[] = [{ role: 'user', content: 'start' }, ...batch, { role: 'assistant', content: 'finished' }];
  const full = selectContext(messages, 5000);
  assert.deepEqual(full, messages);
  const small = selectContext(messages, JSON.stringify([messages[0], messages[4]]).length);
  assert.deepEqual(small, [messages[0], messages[4]]);
});

test('orphan and incomplete tool batches are rejected', () => {
  assert.throws(() => selectContext([{ role: 'user', content: 'x' }, batch[0]!], 1000), /Incomplete/);
  assert.throws(() => selectContext([{ role: 'user', content: 'x' }, batch[1]!], 1000), /Orphan/);
});

test('tool output truncation is bounded and includes both ends', () => {
  const text = 'START' + 'x'.repeat(500) + 'END';
  const bounded = boundToolResult(text, 80);
  assert.ok(bounded.length <= 80);
  assert.ok(bounded.startsWith('START'));
  assert.ok(bounded.endsWith('END'));
  assert.match(bounded, /omitted/);
});

test('agent sends a bounded view but retains full conversation', async () => {
  const seen: Message[][] = [];
  const responses = scriptedModel([
    { content: '', toolCalls: [{ id: '1', name: 'echo', arguments: {} }] },
    { content: 'done' }
  ]);
  const model: Model = { async generate(input) { seen.push([...input.messages]); return responses.generate(input); } };
  const result = await runAgent({ prompt: 'go', model, tools: [{ name: 'echo', description: 'echo', parameters: { type: 'object' }, async execute() { return 'x'.repeat(1000); } }], context: { maxToolResultChars: 80, maxContextChars: 500 } });
  assert.equal(result.status, 'completed');
  assert.ok((result.messages[2] as { content: string }).content.length <= 80);
  assert.deepEqual(seen[1], result.messages.slice(0, 3));
});

test('oversized latest turn terminates without calling model again', async () => {
  let invocations = 0;
  const model: Model = { async generate() { invocations++; return { content: 'x'.repeat(200) }; } };
  const result = await runAgent({ prompt: 'go', model, tools: [], context: { maxContextChars: 40 } });
  assert.equal(result.status, 'completed');
  assert.equal(invocations, 1);
  const second = await runAgent({ prompt: 'a'.repeat(100), model, tools: [], context: { maxContextChars: 40 } });
  assert.equal(second.status, 'context_limit');
  assert.equal(invocations, 1);
});

test('invalid context configuration fails before model invocation', async () => {
  await assert.rejects(runAgent({ prompt: 'x', model: scriptedModel([]), tools: [], context: { maxContextChars: 0 } }), /positive safe integer/);
});
