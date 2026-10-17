# Agent Harness from Scratch

Educational TypeScript implementation of a provider-independent agent execution loop.

## Requirements

Node.js 24+, npm.

```sh
npm install
npm run typecheck
npm test
npm run demo
```

The demo uses a scripted model and requires no API key.

## Current scope

The first milestone implements a model interface, tool contract, bounded execution loop, fake model, and deterministic tests. Tool argument schemas are currently advertised but **not automatically validated**; the demo tool validates its own arguments. Real model adapters, tool sandboxing, context budgets, tracing, and hard cancellation are future milestones.

**Security:** Do not connect untrusted models to filesystem or shell tools until workspace confinement and execution controls are implemented.

## Milestone 2: Tool dispatch and failure semantics

`ToolRegistry` rejects duplicate/invalid names and exposes model-facing tool definitions.
The harness validates arguments before execution using a **deliberately limited** JSON Schema subset:
`type`, `properties`, `required`, `additionalProperties: false`, `items`, and `enum`.
This is not a general JSON Schema validator. Production systems should use a complete
validator and validate schemas at registration time.

Unknown tools, invalid arguments, and tool exceptions become `isError: true` tool
messages so the model can attempt recovery. Model exceptions terminate the run with
`status: 'model_error'`. Aborts and step limits remain harness-owned termination statuses.
Tool calls are executed sequentially, and step limits count model turns rather than
individual tool calls. Per-tool timeouts and tool-call budgets come later.
