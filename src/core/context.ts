import type { Message } from './types.ts';

export interface ContextPolicy {
  /** Maximum JSON-serialized characters passed to the model, excluding tool definitions. */
  maxContextChars: number;
  /** Maximum characters of each serialized tool result, before storing it. */
  maxToolResultChars: number;
}

export const defaultContextPolicy: ContextPolicy = {
  maxContextChars: 32_000,
  maxToolResultChars: 8_000
};

export function validateContextPolicy(policy: ContextPolicy): void {
  for (const [key, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${key} must be a positive safe integer`);
  }
}

const size = (messages: readonly Message[]): number => JSON.stringify(messages).length;

/** Retain the start and end of an oversized tool result. */
export function boundToolResult(content: string, limit: number): string {
  if (content.length <= limit) return content;
  const marker = `\n...[${content.length - limit} or more characters omitted]...\n`;
  if (marker.length >= limit) return marker.slice(0, limit);
  const remaining = limit - marker.length;
  const front = Math.ceil(remaining / 2);
  return content.slice(0, front) + marker + content.slice(-Math.floor(remaining / 2));
}

/**
 * Model-facing projection of the full transcript. Never splits an assistant
 * tool-call batch from its results; the full transcript is retained by the agent.
 * If the latest atomic turn alone exceeds the limit, fail closed.
 */
export function selectContext(messages: readonly Message[], maxChars: number): Message[] {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) throw new RangeError('maxContextChars must be a positive safe integer');
  if (!messages.length) return [];
  const groups: Message[][] = [];
  for (let i = 0; i < messages.length;) {
    const message = messages[i]!;
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const ids = new Set(message.toolCalls.map(call => call.id));
      if (ids.size !== message.toolCalls.length) throw new Error('Duplicate tool call IDs in assistant turn');
      const group: Message[] = [message];
      i++;
      while (i < messages.length && messages[i]!.role === 'tool') {
        const result = messages[i]!;
        if (result.role === 'tool' && !ids.delete(result.callId)) throw new Error('Orphan or duplicate tool result');
        group.push(result);
        i++;
      }
      if (ids.size) throw new Error('Incomplete tool result batch');
      groups.push(group);
    } else {
      if (message.role === 'tool') throw new Error('Orphan tool result');
      groups.push([message]);
      i++;
    }
  }
  const first = groups[0]!;
  if (first[0]?.role !== 'user') throw new Error('Conversation must start with a user message');
  const recent: Message[][] = [];
  for (let i = groups.length - 1; i >= 1; i--) {
    const group = groups[i]!;
    const next = [...first, ...[group, ...recent].flat()];
    if (size(next) > maxChars) {
      if (recent.length === 0) throw new Error('Context budget too small for latest turn');
      break;
    }
    recent.unshift(group);
  }
  const selected = [...first, ...recent.flat()];
  if (size(selected) > maxChars) throw new Error('Context budget too small for required messages');
  return selected;
}
