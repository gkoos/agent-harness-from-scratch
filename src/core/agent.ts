import type { AgentResult, Message, Model, Tool } from './types.ts';
import { ToolRegistry, validate } from './registry.ts';

export async function runAgent(options: {
  model: Model;
  tools: readonly Tool[];
  prompt: string;
  maxSteps?: number;
  signal?: AbortSignal;
}): Promise<AgentResult> {
  const { model, tools, prompt, maxSteps = 10 } = options;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) {
    throw new RangeError('maxSteps must be a positive safe integer');
  }
  const signal = options.signal ?? new AbortController().signal;
  const messages: Message[] = [{ role: 'user', content: prompt }];
  const registry = new ToolRegistry(tools);
  const definitions = registry.definitions();

  for (let step = 0; step < maxSteps; step++) {
    if (signal.aborted) return { status: 'aborted', messages, steps: step };
    let response;
    try {
      response = await model.generate({ messages: [...messages], tools: definitions, signal });
    } catch (error) {
      if (signal.aborted) return { status: 'aborted', messages, steps: step };
      return { status: 'model_error', messages, steps: step, error: error instanceof Error ? error.message : String(error) };
    }
    if (signal.aborted) return { status: 'aborted', messages, steps: step };
    const calls = response.toolCalls ?? [];
    messages.push({ role: 'assistant', content: response.content, ...(calls.length ? { toolCalls: calls } : {}) });
    if (!calls.length) return { status: 'completed', answer: response.content, messages, steps: step + 1 };

    for (const call of calls) {
      if (signal.aborted) return { status: 'aborted', messages, steps: step + 1 };
      const tool = registry.get(call.name);
      if (!tool) {
        messages.push({ role: 'tool', callId: call.id, content: `Unknown tool: ${call.name}`, isError: true });
        continue;
      }
      const validationErrors = validate(call.arguments, tool.parameters);
      if (validationErrors.length) {
        messages.push({ role: 'tool', callId: call.id, content: `Invalid arguments: ${validationErrors.join('; ')}`, isError: true });
        continue;
      }
      try {
        const result = await tool.execute(call.arguments, signal);
        if (signal.aborted) return { status: 'aborted', messages, steps: step + 1 };
        messages.push({ role: 'tool', callId: call.id, content: JSON.stringify(result) ?? 'null', isError: false });
      } catch (error) {
        if (signal.aborted) return { status: 'aborted', messages, steps: step + 1 };
        messages.push({ role: 'tool', callId: call.id, content: error instanceof Error ? error.message : String(error), isError: true });
      }
    }
  }
  return { status: 'step_limit', messages, steps: maxSteps };
}
