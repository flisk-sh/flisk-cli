## Context

The default backend, worker, frontend, MCP and agent package scaffold uses Bun but emits a Node-dependent Vitest worker. Node/Python/Go/Rust backend providers emit their own files.

## Decisions

Use the existing Bun runtime as the test runner, aligning scripts and all shared test imports together. Keep CLI contributor tests on Vitest. Keep frontend build configuration and dependency versions unchanged. Keep placeholder tests as TODOs; a clean exit does not mean a TODO was tested.

## Risks and verification

Bun test APIs must support the generated MCP lifecycle and HTTP protocol test. Execute freshly generated backend and MCP tests without real Node, and check worker/frontend TODO behavior honestly. Preserve non-Bun provider fixtures. No automatic migration of user-written Vitest tests.
