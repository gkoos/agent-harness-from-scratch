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
