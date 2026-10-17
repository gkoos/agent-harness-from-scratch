# Agent Harness from Scratch

A small, provider-independent AI agent harness written in TypeScript, developed alongside a freeCodeCamp tutorial. The project deliberately exposes the orchestration machinery rather than hiding it behind an agent framework.

The model proposes tool calls; the harness validates arguments, dispatches permitted tools, tracks execution budgets, and decides when a run terminates.

## Requirements

- Node.js 24+
- npm

## Getting started

```sh
npm install
npm run typecheck
npm test
npm run demo
```

The demo uses a scripted fake model and does **not** require an API key. There is no real LLM provider adapter yet.

## Repository structure

```text
src/
  core/
    agent.ts       # Model/tool loop, limits, cancellation, and outcomes
    context.ts     # Bounded context selection and tool-result truncation
    registry.ts    # Tool registry and limited argument validation
    types.ts       # Provider-independent interfaces
  models/
    fake.ts        # Scripted deterministic model
  tools/
    workspace.ts   # Workspace-confined read/write tools
    commands.ts    # Developer-configured command presets
  demo.ts          # Runnable example without an API key
tests/             # Node.js built-in test runner
```

## Milestones

| Tag | Feature |
| --- | --- |
| `01-model-loop` | Model and tool contracts, execution loop, scripted model, initial tests |
| `02-tool-dispatch` | Tool registry, argument validation, recoverable tool errors, model-error status |
| `03-workspace-tools` | Workspace-confined file tools and configured command presets |
| `04-execution-limits` | Tool-call budget, cooperative deadline, cancellation, and execution accounting |
| `05-context` | Bounded model-facing context, tool-result truncation, atomic tool-call batches, and context-limit status |

Each tag marks an article milestone. The `main` branch holds the latest implementation.

## Core architecture

`runAgent` receives a `Model`, a list of `Tool` implementations, and a user prompt. The harness passes the conversation and tool definitions to the model, receives a response, validates requested tool calls, executes permitted tools sequentially, and feeds their results back into the conversation. A response without tool calls completes the run.

The model adapter is replaceable. The fake model supplies scripted responses, allowing deterministic tests without network calls or token costs.

## Running an agent

```ts
import { runAgent } from './src/core/agent.ts';
import { scriptedModel } from './src/models/fake.ts';

const result = await runAgent({
  prompt: 'Say hello',
  model: scriptedModel([{ content: 'Hello!' }]),
  tools: [],
  maxSteps: 10,
  maxToolCalls: 30,
  timeoutMs: 15_000,
  context: { maxContextChars: 32_000, maxToolResultChars: 8_000 },
});

console.log(result.status, result.answer);
```

## Execution limits and cancellation

`runAgent` supports:

| Option | Default | Meaning |
| --- | --- | --- |
| `maxSteps` | `10` | Maximum model responses/turns |
| `maxToolCalls` | `30` | Maximum tool calls admitted during a run |
| `timeoutMs` | None | Optional cooperative deadline in milliseconds |
| `signal` | None | Caller-provided `AbortSignal` |

Tool-call budgets count requested calls, including unknown tools and calls with invalid arguments. Calls within a model response are treated as a batch: if the batch cannot fit the remaining budget, the harness rejects it before executing any tool in that batch. This avoids partial execution caused *solely* by budget exhaustion; it does not make a batch transactional in the face of tool failures or cancellation.

A result includes `status`, `messages`, `steps`, and `toolCalls`, plus `answer` on completion or `error` on model failure.

| Status | Meaning |
| --- | --- |
| `completed` | Model returned a response without tool calls |
| `step_limit` | Model-turn budget exhausted |
| `tool_limit` | Next tool-call batch would exceed the budget |
| `aborted` | Caller requested cancellation |
| `timeout` | Harness deadline expired |
| `model_error` | Model adapter threw an error |
| `context_limit` | Required conversation context cannot fit the configured budget |

Unknown tools, invalid arguments, and exceptions raised by tools are reported to the model as error tool messages, allowing the model to recover on a subsequent turn. Model adapter errors terminate the run instead of masquerading as tool failures.

**Cancellation is cooperative.** The harness propagates an abort signal and checks it at execution boundaries. A model or tool that ignores the signal can keep the promise pending beyond the deadline. The deadline does not forcibly terminate CPU-bound JavaScript, detached processes, or a subprocess tree. Hard termination requires external supervision and process or worker isolation.

## Workspace-aware file tools

```ts
import { Workspace, workspaceTools } from './src/tools/workspace.ts';

const workspace = await Workspace.open('/path/to/project');
const tools = workspaceTools(workspace);
```

The `read_file` and `write_file` tools accept paths relative to a canonical workspace root. The implementation rejects traversal outside the workspace and symbolic-link components. Writing requires the parent directory to exist; it does not create directory trees automatically.

These checks are educational safeguards, not complete filesystem isolation. Path checking and opening are not fully atomic, so concurrent filesystem changes can introduce time-of-check/time-of-use races.

## Command tool

```ts
import { commandTool } from './src/tools/commands.ts';

const tool = commandTool('/path/to/project', {
  test: { executable: 'npm', args: ['test'], timeoutMs: 10_000 },
});
```

The model can select only a named command preset. It cannot supply arbitrary shell text or command arguments. Commands are launched without a shell and have bounded output. A command preset may still execute arbitrary code indirectly (for example, through `npm test`), and subprocess descendants may survive termination.

## Tool validation

`ToolRegistry` rejects duplicate and invalid tool names. Tool arguments are checked before execution with an intentionally limited JSON Schema subset supporting `type`, `properties`, `required`, `additionalProperties: false`, `items`, and `enum`.

This is **not** a full JSON Schema implementation. A production harness should validate tool schemas at registration and use a complete, maintained validator.

## Testing

```sh
npm test
npm run typecheck
```

The tests use Node.js's built-in test runner and scripted model responses to exercise both successful runs and failures without making live model API requests. Milestone 4 tests cover budgets, cancellation, and deadlines. Milestone 5 tests cover context selection, atomic tool-call/result groups, truncation, and context-limit termination.

## Security limitations

**Do not treat this project as a sandbox for untrusted code.** Workspace confinement has race-condition limitations. Command execution does not isolate the filesystem, network, or inherited environment. Process termination may not stop descendants. For untrusted repositories, agents, or generated code, use an isolated container or operating-system sandbox with separately enforced resource limits and restricted permissions.

## Milestone 5: Context management

The harness maintains a complete conversation transcript for the caller, but sends a
**bounded projection** to the model. Configure it with `context`:

```ts
const result = await runAgent({
  prompt: 'Inspect the project', model, tools,
  context: {
    maxContextChars: 32_000,
    maxToolResultChars: 8_000,
  },
});
```

`maxContextChars` bounds the JSON-serialized **message array** supplied to the
model, not the provider's token count. It excludes tool definitions and any
provider-specific message wrapping. This is an educational approximation, not
a substitute for model-specific token accounting.

`maxToolResultChars` truncates the serialized result of each tool call before
it enters the transcript. The truncation retains both the beginning and end,
with an omission marker. This is irreversible: the full tool result is **not**
retained in `AgentResult.messages`. Tool exceptions are bounded the same way.
The marker itself may be truncated for extremely small limits.

`selectContext()` always retains the initial user prompt and selects the most
recent complete turns that fit. An assistant message containing tool calls and
all of its tool results form one indivisible group. Older groups are omitted
rather than leaving orphaned results or unmatched calls. No summarization is
performed, and omitted context cannot be recovered by the model. The full
**bounded-output** transcript remains available in `AgentResult.messages`.

If the initial prompt or latest indivisible turn cannot fit, the harness stops
with `status: 'context_limit'` instead of silently dropping required content.
As with other limits, this is harness-owned termination, not a recoverable tool
error. A tool call that returns an oversized result may therefore trigger a
context-limit termination on the next model turn.

The tests in `tests/context.test.ts` cover atomic batches, malformed histories,
truncation, model-facing projections, and impossible context budgets.

### Scope and limitations

This milestone deliberately does not implement tokenization, provider-specific
prompt accounting, summarization, retrieval, or durable external history.
The context budget is measured in JavaScript UTF-16 string units of JSON output,
not bytes or tokens. A future provider adapter must reserve space for tool
schemas, protocol framing, and output tokens.

## What's next

- **Milestone 6 — Observability:** Structured lifecycle events, usage accounting, and traces.
- **Milestone 7 — Testing:** Extended deterministic failure and property tests.
