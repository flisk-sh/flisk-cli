## ADDED Requirements

### Requirement: Bun scaffold tests use the Bun runtime

Fresh shared Bun resource scaffolds SHALL run their generated tests without a separate Node.js installation.

#### Scenario: Run tests on a Bun-only host
- **WHEN** a backend, worker, MCP, agent or frontend using the shared Bun scaffold is created and its dependencies installed
- **THEN** its test script uses bun test, its watch script uses bun test --watch, and generated tests import bun:test
- **AND** the scaffold does not require Vitest as a development dependency

#### Scenario: Other language provider
- **WHEN** a backend provider owns its package and test files, such as Node.js
- **THEN** its existing provider-specific runner remains unchanged
