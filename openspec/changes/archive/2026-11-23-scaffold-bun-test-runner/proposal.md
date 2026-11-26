## Why

#5391 reports that newly scaffolded Bun projects cannot run tests without real Node: Vitest starts a worker requiring child.channel.unref, absent from Bun.

## What Changes

Use bun test and bun test --watch, import bun:test in generated smoke/TODO/MCP protocol tests, and omit Vitest from shared Bun package dependencies. Other language providers keep their own runners. Existing projects are not rewritten.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- self-contained-generated-projects: fresh Bun scaffolds run tests without a separate Node installation.

## Impact

Shared resource package/test templates, MCP test template, scaffold regression fixtures and documentation. No engine, manifest or deployment changes. Separate Biome issue3718 remains outside scope.
