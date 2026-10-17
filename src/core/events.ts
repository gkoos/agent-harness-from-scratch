import { randomUUID } from 'node:crypto';
import type { AgentResult } from './types.ts';

/** Optional provider-reported usage. Missing fields mean unknown, not zero. */
export type Usage = { inputTokens?: number; outputTokens?: number };
export type UsageTotals = { inputTokens: number; outputTokens: number; modelCallsWithUsage: number };

type EventPayload = (
  | { type: 'model_start'; step: number; messageCount: number }
  | { type: 'model_end'; step: number; durationMs: number; toolCallCount: number; usage?: Usage }
  | { type: 'model_error'; step: number; durationMs: number; error: string }
  | { type: 'tool_start'; step: number; callId: string; tool: string }
  | { type: 'tool_end'; step: number; callId: string; tool: string; durationMs: number; isError: boolean }
  | { type: 'run_end'; status: AgentResult['status']; steps: number; toolCalls: number; durationMs: number }
);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type AgentEvent = EventPayload & { runId: string; sequence: number; timestamp: string };

export type EventSink = (event: AgentEvent) => void;
export type EventLogger = { onEvent?: EventSink; onObserverError?: (error: unknown) => void };

/** Events deliberately exclude prompts, tool arguments, and tool outputs. */
export function createEventEmitter(options: EventLogger = {}) {
  const runId = randomUUID();
  const started = performance.now();
  let sequence = 0;
  return {
    runId,
    elapsed: () => Math.max(0, performance.now() - started),
    emit(event: DistributiveOmit<AgentEvent, 'runId' | 'sequence' | 'timestamp'>) {
      const enriched = { ...event, runId, sequence: ++sequence, timestamp: new Date().toISOString() } as AgentEvent;
      try { options.onEvent?.(enriched); }
      catch (error) {
        // Telemetry is best-effort and must not change agent execution.
        try { options.onObserverError?.(error); } catch { /* observer errors are isolated */ }
      }
    }
  };
}

export function addUsage(totals: UsageTotals, usage: Usage | undefined): void {
  if (!usage) return;
  for (const value of [usage.inputTokens, usage.outputTokens]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError('Model usage must contain nonnegative safe integers');
    }
  }
  if (!Number.isSafeInteger(totals.inputTokens + (usage.inputTokens ?? 0)) ||
      !Number.isSafeInteger(totals.outputTokens + (usage.outputTokens ?? 0))) {
    throw new RangeError('Accumulated model usage exceeds safe integer range');
  }
  totals.inputTokens += usage.inputTokens ?? 0;
  totals.outputTokens += usage.outputTokens ?? 0;
  totals.modelCallsWithUsage++;
}
