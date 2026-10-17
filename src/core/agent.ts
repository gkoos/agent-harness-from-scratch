import type { AgentResult, Message, Model, Tool } from './types.ts';
import { ToolRegistry, validate } from './registry.ts';

export async function runAgent(options: {
  model: Model;
  tools: readonly Tool[];
  prompt: string;
  maxSteps?: number;
  maxToolCalls?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AgentResult> {
  const { model, tools, prompt, maxSteps = 10, maxToolCalls = 30, timeoutMs } = options;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new RangeError('maxSteps must be a positive safe integer');
  if (!Number.isSafeInteger(maxToolCalls) || maxToolCalls < 0) throw new RangeError('maxToolCalls must be a nonnegative safe integer');
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) throw new RangeError('timeoutMs must be a positive safe integer');

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
  const stopped = (): AgentResult => ({ status: timedOut ? 'timeout' : 'aborted', messages, steps, toolCalls });

  try {
    const registry = new ToolRegistry(tools);
    const definitions = registry.definitions();
    for (let step = 0; step < maxSteps; step++) {
      if (signal.aborted) return stopped();
      let response: Awaited<ReturnType<Model['generate']>>;
      try { response = await model.generate({ messages: [...messages], tools: definitions, signal }); }
      catch (error) {
        if (signal.aborted) return stopped();
        return { status: 'model_error', messages, steps, toolCalls, error: error instanceof Error ? error.message : String(error) };
      }
      if (signal.aborted) return stopped();
      steps++;
      const calls = response.toolCalls ?? [];
      messages.push({ role: 'assistant', content: response.content, ...(calls.length ? { toolCalls: calls } : {}) });
      if (!calls.length) return { status: 'completed', answer: response.content, messages, steps, toolCalls };
      // Refuse the entire batch before any side effects if the remaining budget is insufficient.
      if (calls.length > maxToolCalls - toolCalls) return { status: 'tool_limit', messages, steps, toolCalls };
      for (const call of calls) {
        if (signal.aborted) return stopped();
        toolCalls++;
        const tool = registry.get(call.name);
        if (!tool) { messages.push({ role: 'tool', callId: call.id, content: `Unknown tool: ${call.name}`, isError: true }); continue; }
        const errors = validate(call.arguments, tool.parameters);
        if (errors.length) { messages.push({ role: 'tool', callId: call.id, content: `Invalid arguments: ${errors.join('; ')}`, isError: true }); continue; }
        try {
          const result = await tool.execute(call.arguments, signal);
          if (signal.aborted) return stopped();
          messages.push({ role: 'tool', callId: call.id, content: JSON.stringify(result) ?? 'null', isError: false });
        } catch (error) {
          if (signal.aborted) return stopped();
          messages.push({ role: 'tool', callId: call.id, content: error instanceof Error ? error.message : String(error), isError: true });
        }
      }
    }
    return { status: 'step_limit', messages, steps, toolCalls };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
