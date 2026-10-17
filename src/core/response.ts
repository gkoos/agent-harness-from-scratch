import type { Model, ToolCall } from './types.ts';

/** Validate the adapter boundary before accepting a model turn or running side effects. */
export function validateModelResponse(value: unknown): asserts value is Awaited<ReturnType<Model['generate']>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Model response must be an object');
  const response = value as Record<string, unknown>;
  if (typeof response.content !== 'string') throw new TypeError('Model response content must be a string');
  if (response.toolCalls === undefined) return;
  if (!Array.isArray(response.toolCalls)) throw new TypeError('Model toolCalls must be an array');
  const ids = new Set<string>();
  for (const call of response.toolCalls as unknown[]) {
    if (call === null || typeof call !== 'object' || Array.isArray(call)) throw new TypeError('Tool call must be an object');
    const item = call as Partial<ToolCall>;
    if (typeof item.id !== 'string' || !item.id.trim()) throw new TypeError('Tool call id must be a nonempty string');
    if (typeof item.name !== 'string' || !item.name.trim()) throw new TypeError('Tool call name must be a nonempty string');
    if (!Object.hasOwn(item, 'arguments')) throw new TypeError('Tool call arguments are missing');
    if (ids.has(item.id)) throw new TypeError(`Duplicate tool call id: ${item.id}`);
    ids.add(item.id);
  }
}
