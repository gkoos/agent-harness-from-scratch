export type ToolCall = { id: string; name: string; arguments: unknown };
export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; callId: string; content: string; isError: boolean };
export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown>; }
export interface Tool extends ToolDefinition { execute(argumentsValue: unknown, signal: AbortSignal): Promise<unknown>; }
export interface Model { generate(input: { messages: readonly Message[]; tools: readonly ToolDefinition[]; signal: AbortSignal; }): Promise<{ content: string; toolCalls?: ToolCall[] }>; }
export type AgentResult = {
  status: 'completed' | 'step_limit' | 'tool_limit' | 'timeout' | 'aborted' | 'model_error' | 'context_limit';
  answer?: string;
  messages: Message[];
  steps: number;
  toolCalls: number;
  error?: string;
};
