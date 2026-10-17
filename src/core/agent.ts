import type { AgentResult, Message, Model, Tool } from './types.ts';
import { ToolRegistry, validate } from './registry.ts';
import { validateModelResponse } from './response.ts';
import { boundToolResult, defaultContextPolicy, selectContext, validateContextPolicy, type ContextPolicy } from './context.ts';
import { addUsage, createEventEmitter, type EventLogger, type UsageTotals } from './events.ts';

export async function runAgent(options: {
  model: Model;
  tools: readonly Tool[];
  prompt: string;
  maxSteps?: number;
  maxToolCalls?: number;
  timeoutMs?: number;
  context?: Partial<ContextPolicy>;
  signal?: AbortSignal;
} & EventLogger): Promise<AgentResult> {
  const { model, tools, prompt, maxSteps = 10, maxToolCalls = 30, timeoutMs } = options;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new RangeError('maxSteps must be a positive safe integer');
  if (!Number.isSafeInteger(maxToolCalls) || maxToolCalls < 0) throw new RangeError('maxToolCalls must be a nonnegative safe integer');
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) throw new RangeError('timeoutMs must be a positive safe integer');
  const context: ContextPolicy = { ...defaultContextPolicy, ...options.context };
  validateContextPolicy(context);

  // Registration failures remain programmer errors, rather than run outcomes.
  const registry = new ToolRegistry(tools);
  const definitions = registry.definitions();
  const telemetry = createEventEmitter(options);
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, modelCallsWithUsage: 0 };
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('Agent deadline exceeded'));
  }, timeoutMs);
  const signal = controller.signal;
  const messages: Message[] = [{ role: 'user', content: prompt }];
  let toolCalls = 0;
  let steps = 0;
  const finish = (status: AgentResult['status'], extra: Pick<AgentResult, 'answer' | 'error'> = {}): AgentResult => {
    const result: AgentResult = { status, messages, steps, toolCalls, runId: telemetry.runId, usage: { ...usage }, ...extra };
    telemetry.emit({ type: 'run_end', status, steps, toolCalls, durationMs: telemetry.elapsed() });
    return result;
  };
  const stopped = () => finish(timedOut ? 'timeout' : 'aborted');

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (signal.aborted) return stopped();
      let response: Awaited<ReturnType<Model['generate']>>;
      let modelMessages: Message[];
      try { modelMessages = selectContext(messages, context.maxContextChars); }
      catch (error) { return finish('context_limit', { error: error instanceof Error ? error.message : String(error) }); }
      const modelStart = performance.now();
      telemetry.emit({ type: 'model_start', step: step + 1, messageCount: modelMessages.length });
      try { response = await model.generate({ messages: modelMessages, tools: definitions, signal }); }
      catch (error) {
        if (signal.aborted) return stopped();
        const message = error instanceof Error ? error.message : String(error);
        telemetry.emit({ type: 'model_error', step: step + 1, durationMs: performance.now() - modelStart, error: message });
        return finish('model_error', { error: message });
      }
      if (signal.aborted) return stopped();
      try { validateModelResponse(response); addUsage(usage, response.usage); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        telemetry.emit({ type: 'model_error', step: step + 1, durationMs: performance.now() - modelStart, error: message });
        return finish('model_error', { error: message });
      }
      steps++;
      const calls = response.toolCalls ?? [];
      telemetry.emit({ type: 'model_end', step: steps, durationMs: performance.now() - modelStart, toolCallCount: calls.length, ...(response.usage ? { usage: response.usage } : {}) });
      // Reject an entire batch before recording an unmatched assistant tool-call turn.
      if (calls.length > maxToolCalls - toolCalls) return finish('tool_limit');
      messages.push({ role: 'assistant', content: response.content, ...(calls.length ? { toolCalls: calls } : {}) });
      if (!calls.length) return finish('completed', { answer: response.content });
      for (const call of calls) {
        if (signal.aborted) return stopped();
        toolCalls++;
        const toolStart = performance.now();
        telemetry.emit({ type: 'tool_start', step: steps, callId: call.id, tool: call.name });
        const record = (content: string, isError: boolean) => {
          messages.push({ role: 'tool', callId: call.id, content: boundToolResult(content, context.maxToolResultChars), isError });
          telemetry.emit({ type: 'tool_end', step: steps, callId: call.id, tool: call.name, durationMs: performance.now() - toolStart, isError });
        };
        const tool = registry.get(call.name);
        if (!tool) { record(`Unknown tool: ${call.name}`, true); continue; }
        const errors = validate(call.arguments, tool.parameters);
        if (errors.length) { record(`Invalid arguments: ${errors.join('; ')}`, true); continue; }
        try {
          const result = await tool.execute(call.arguments, signal);
          if (signal.aborted) return stopped();
          record(JSON.stringify(result) ?? 'null', false);
        } catch (error) {
          if (signal.aborted) return stopped();
          record(error instanceof Error ? error.message : String(error), true);
        }
      }
    }
    return finish('step_limit');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
