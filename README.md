# Agent Harness from Scratch

A small, provider-independent TypeScript agent harness, developed alongside a freeCodeCamp tutorial.

## Run

Requires Node.js 24+.

```sh
npm install
npm run typecheck
npm test
npm run demo
```

The demo uses a scripted fake model, so no API key is needed.

## Milestones

- `01-model-loop`: bounded model/tool loop and deterministic fake model.
- `02-tool-dispatch`: tool registry, limited schema validation, recoverable tool failures and model-error termination.
- **`03-workspace-tools`**: file tools restricted to a workspace, plus developer-configured command presets.

## Workspace tools

```ts
const workspace = await Workspace.open('/path/to/project');
const tools = workspaceTools(workspace);
```

Paths must be relative, remain inside the canonical workspace, and cannot traverse symbolic links. Parent directories must exist before writing. Commands are fixed presets supplied by the application; the model can select a preset but cannot provide shell text or arguments.

## Security limitations

**This is educational code, not a hardened sandbox.** File checks and opens are not atomic across every path component, so an attacker concurrently changing directories could create a time-of-check/time-of-use race. Command presets can run arbitrary code indirectly (for example, a test script), and child processes can spawn descendants. A process kill on timeout does not reliably kill the whole process tree. Command execution does not restrict network access, filesystem access, or environment inheritance. Use an isolated container or OS sandbox for untrusted repositories or agents. The JSON Schema validator is intentionally incomplete.

The model/tool loop currently counts model turns, not individual tool calls. Per-tool execution budgets and stronger cancellation semantics belong to the next milestone.
