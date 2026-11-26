// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  describe,
  expect,
  getBackendIndexTemplate,
  getWorkerIndexTemplate,
  it,
} from "./test-support.js";

describe("backend index.ts template", () => {
  it("should have health check endpoints via getBackendIndexTemplate", () => {
    const name = "test-service";
    const indexContent = getBackendIndexTemplate(name);

    expect(indexContent).toContain("app.get('/health'");
    expect(indexContent).toContain("app.get('/health/live'");
    expect(indexContent).toContain("app.get('/health/ready'");
    expect(indexContent).toContain("async (c)");
    expect(indexContent).toContain(`service: '${name}'`);
  });

  it("allows CORS from the *.localhost frontend origins and keeps /health unchanged", () => {
    const indexContent = getBackendIndexTemplate("test-service");

    expect(indexContent).toContain("import { cors } from 'hono/cors';");
    expect(indexContent).toContain("app.use('*', cors({");
    expect(indexContent).toContain(String.raw`/^https?:\/\/([a-z0-9-]+\.)+localhost(:\d+)?$/`);
    expect(indexContent).not.toContain("origin: '*'");
    expect(indexContent).toContain("app.get('/health', (c) => {");
    expect(indexContent).toContain("return c.json({ status: 'ok', service: 'test-service' });");
  });

  it("should have root endpoint with service info", () => {
    const name = "test-service";
    const indexContent = getBackendIndexTemplate(name);

    expect(indexContent).toContain("app.get('/',");
    expect(indexContent).toContain("endpoints:");
  });
});

describe("worker index.ts template", () => {
  it("should have worker configuration via getWorkerIndexTemplate", () => {
    const name = "test-worker";
    const workerContent = getWorkerIndexTemplate(name);

    expect(workerContent).toContain("WORKER_POLL_INTERVAL");
    expect(workerContent).toContain("WORKER_MAX_RETRIES");
    expect(workerContent).toContain("WORKER_BATCH_SIZE");
    expect(workerContent).toContain("interface Job");
    expect(workerContent).toContain("async function main()");
  });

  it("does not reference CLI-internal types the scaffolded project cannot resolve (#588)", () => {
    const workerContent = getWorkerIndexTemplate("test-worker");

    // JsonValue exists only inside the CLI (cli/src/types); the generated worker has no import for it.
    expect(workerContent).not.toContain("JsonValue");
    expect(workerContent).toContain("payload: Record<string, unknown>;");
  });

  it("should have graceful shutdown handling", () => {
    const name = "test-worker";
    const workerContent = getWorkerIndexTemplate(name);

    expect(workerContent).toContain("process.on('SIGTERM'");
    expect(workerContent).toContain("process.on('SIGINT'");
    expect(workerContent).toContain("shutting down gracefully");
  });
});
