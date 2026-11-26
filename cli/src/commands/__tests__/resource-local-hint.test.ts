// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCommandInProcess } from "../../test-support/run-in-process.js";
import { createTempProject, type TempProjectSpec } from "../../test-support/temp-project.js";

const promptMocks = vi.hoisted(() => ({
  promptSelect: vi.fn(),
  promptText: vi.fn(),
  promptConfirm: vi.fn(),
  promptMultiSelect: vi.fn(),
}));
vi.mock("../../utils/prompt.js", () => promptMocks);

const PROJECT_JSON = {
  version: "1.0.0",
  project: { name: "shop", version: "1.0.0" },
  discovery: { paths: ["services/**"] },
};

const NATIVE_WEB = { appType: "frontend", command: "npm run dev", port: 3000 };
const NATIVE_API = { appType: "backend", command: "node server.js", port: 4000 };

function nativeProjectSpec(extra?: TempProjectSpec): TempProjectSpec {
  return {
    projectJson: PROJECT_JSON,
    stacks: { app: { web: NATIVE_WEB, api: NATIVE_API } },
    ...extra,
  };
}

// Commander keeps option values between parses of one command instance, so each run imports the command again.
async function runResource(root: string, args: string[]) {
  vi.resetModules();
  const { resourceCommand } = await import("../resource.js");
  const { clearDiscoveryCache } = await import("../../utils/discovery-context.js");
  clearDiscoveryCache();
  const result = await runCommandInProcess(resourceCommand, args, root);
  clearDiscoveryCache();
  return result;
}

function createdManifest(root: string, name: string) {
  return JSON.parse(
    readFileSync(join(root, "services", "app", name, "service.json"), "utf8"),
  ) as Record<string, unknown>;
}

// #3687: `flisk resource <name> --yes` in a local-processes project scaffolded a Dockerfile service, printed
// `flisk up app` as the next step, and that `flisk up` then refused the mixed runtimes. The command now warns
// about the mismatch and points at --local instead of naming `flisk up` as a next step.
describe("resource in a local-processes project (#3687)", () => {
  it("warns that a new backend cannot join `flisk up` and points at --local", async () => {
    const root = createTempProject(nativeProjectSpec());
    const result = await runResource(root, ["probe-api", "--yes"]);

    expect(result.status ?? 0).toBe(0);
    expect(result.stdout).toContain("runs as local processes");
    expect(result.stdout).toContain("has a Dockerfile and cannot join `flisk up`");
    expect(result.stdout).toContain("flisk resource probe-api --local --yes");
    expect(result.stdout).not.toContain("flisk up app");
    expect(existsSync(join(root, "services", "app", "probe-api"))).toBe(true);
    expect(createdManifest(root, "probe-api").command).toBeUndefined();
  });

  it("warns that a new frontend cannot join `flisk up` and names --type frontend", async () => {
    const root = createTempProject(nativeProjectSpec());
    const result = await runResource(root, ["probe-web", "--type", "frontend", "--yes"]);

    expect(result.status ?? 0).toBe(0);
    expect(result.stdout).toContain("runs as local processes");
    expect(result.stdout).toContain("flisk resource probe-web --type frontend --local --yes");
    expect(result.stdout).not.toContain("flisk up app");
  });

  it("warns that a new agent cannot join `flisk up` and names --type agent", async () => {
    const root = createTempProject(nativeProjectSpec());
    const result = await runResource(root, ["probe-bot", "--type", "agent", "--yes"]);

    expect(result.status ?? 0).toBe(0);
    expect(result.stdout).toContain("runs as local processes");
    expect(result.stdout).toContain("has a Dockerfile and cannot join `flisk up`");
    expect(result.stdout).toContain("flisk resource probe-bot --type agent --local --yes");
    expect(result.stdout).not.toContain("flisk up app");
  });

  it("scaffolds a local-process agent with --local: a command, no Dockerfile, a localhost bind", async () => {
    const root = createTempProject(nativeProjectSpec());
    const result = await runResource(root, ["probe-bot", "--type", "agent", "--local", "--yes"]);

    expect(result.status ?? 0).toBe(0);
    expect(result.stdout).not.toContain("runs as local processes");
    expect(result.stdout).toContain("flisk up app");
    const manifest = createdManifest(root, "probe-bot");
    expect(manifest.command).toBe("bun run dev");
    expect(manifest.agent).toEqual({ runtime: "custom", durability: "files" });
    expect(manifest.build).toBeUndefined();
    expect(manifest.dev).toBeUndefined();
    expect(existsSync(join(root, "services", "app", "probe-bot", "Dockerfile"))).toBe(false);
    const index = readFileSync(
      join(root, "services", "app", "probe-bot", "src", "index.ts"),
      "utf8",
    );
    expect(index).toContain("server.listen(PORT, 'localhost'");
    expect(index).not.toContain("0.0.0.0");
    // The same runtime as the container scaffold: the contract routes survive the localhost rewrite.
    expect(index).toContain("url.pathname === '/health'");
    expect(index).toContain("url.pathname === '/ready'");
    expect(index).toContain("url.pathname === '/turn'");
    expect(index).toContain("url.pathname === '/sessions'");
  });

  it("keeps --durability postgres with --local, checkpointing to DATABASE_URL", async () => {
    const root = createTempProject(nativeProjectSpec());
    const result = await runResource(root, [
      "probe-pg",
      "--type",
      "agent",
      "--local",
      "--durability",
      "postgres",
      "--yes",
    ]);

    expect(result.status ?? 0).toBe(0);
    const manifest = createdManifest(root, "probe-pg");
    expect(manifest.command).toBeTypeOf("string");
    expect(manifest.agent).toEqual({ runtime: "custom", durability: "postgres" });
    expect(existsSync(join(root, "services", "app", "probe-pg", "Dockerfile"))).toBe(false);
  });

  it("still warns when the project also runs an image-based container", async () => {
    const root = createTempProject(
      nativeProjectSpec({
        stacks: {
          app: {
            web: NATIVE_WEB,
            api: NATIVE_API,
            db: { appType: "database", image: "postgres:16", port: 5432 },
          },
        },
      }),
    );
    const result = await runResource(root, ["probe-api", "--yes"]);

    expect(result.status ?? 0).toBe(0);
    expect(result.stdout).toContain("flisk resource probe-api --local --yes");
    expect(result.stdout).not.toContain("flisk up app");
  });

  it("prints no warning for a --local backend, and keeps `flisk up` in the next steps", async () => {
    const root = createTempProject(nativeProjectSpec());
    const result = await runResource(root, ["probe-api", "--yes", "--local"]);

    expect(result.status ?? 0).toBe(0);
    expect(result.stdout).not.toContain("runs as local processes");
    expect(result.stdout).toContain("flisk up app");
    expect(createdManifest(root, "probe-api").command).toBeTypeOf("string");
  });

  it("prints no warning in a Docker project", async () => {
    const root = createTempProject({
      projectJson: PROJECT_JSON,
      stacks: {
        app: {
          web: { appType: "frontend", port: 3000 },
          api: { appType: "backend", port: 4000 },
        },
      },
    });
    const result = await runResource(root, ["probe-api", "--yes"]);

    expect(result.status ?? 0).toBe(0);
    expect(result.stdout).not.toContain("runs as local processes");
    expect(result.stdout).toContain("flisk up app");
  });

  it("prints no warning in an empty project, where `flisk up` runs Docker", async () => {
    const root = createTempProject({ projectJson: PROJECT_JSON });
    const result = await runResource(root, ["probe-api", "--yes"]);

    expect(result.status ?? 0).toBe(0);
    expect(result.stdout).not.toContain("runs as local processes");
    expect(result.stdout).toContain("flisk up main");
  });
});
