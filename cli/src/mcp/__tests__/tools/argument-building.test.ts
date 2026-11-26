// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/// <reference types="vite/client" />

import { beforeEach, describe, expect, it } from "vitest";
import { resetSpawnMock } from "./test-support.js";

beforeEach(() => {
  resetSpawnMock();
});

import { FliskError } from "../../../utils/errors.js";
import { PROJECT_TEMPLATES } from "../../../utils/project-templates.js";
import { KEBAB_CASE_REGEX, validateResourceName } from "../../../utils/validation.js";

import {
  buildLogsArgs,
  buildResourceCreateArgs,
  configRegenerateArgs,
  createFliskTools,
  logsArgs,
  projectInitArgs,
  resourceCreateArgs,
  stackAssignArgs,
  statusArgs,
  toolAddArgs,
  trimStatusToUnhealthy,
  upArgs,
  waitArgs,
} from "../../tools.js";

describe("argument building", () => {
  it("forwards log content filtering options and keeps meta-characters literal", () => {
    expect(logsArgs.build({ grep: "ERROR|warn", context: 2 })).toEqual([
      "logs",
      "--json",
      "--grep=ERROR|warn",
      "--context=2",
    ]);
    expect(logsArgs.build({ grep: "[ok]" })).toEqual(["logs", "--json", "--grep=[ok]"]);
    expect(() => logsArgs.build({ grep: 5 })).toThrow();
    expect(() => logsArgs.build({ grep: "error", context: -1 })).toThrow();
    expect(() => logsArgs.build({ context: 1 })).toThrow();
  });

  it("builds up arguments, one --only= per service so a value is never a flag", () => {
    expect(
      upArgs.build({ stack: "store", only: ["api", "web"], force: true, dryRun: true }),
    ).toEqual(["up", "store", "--only=api", "--only=web", "--force", "--dry-run", "--json"]);
    expect(upArgs.build({})).toEqual(["up", "--json"]);
  });
  it("builds wait arguments with the named services and bounded timeout", () => {
    expect(waitArgs.build({ services: ["api", "web"], timeoutSeconds: 30 })).toEqual([
      "wait",
      "api",
      "web",
      "--timeout=30",
      "--json",
    ]);
    expect(waitArgs.build({})).toEqual(["wait", "--timeout=1800", "--json"]);
    expect(() => waitArgs.build({ timeoutSeconds: 0 })).toThrow(/timeoutSeconds/);
  });
  it("passes profiles and an env file to up, as the CLI flags they wrap", () => {
    expect(upArgs.build({ profile: ["heavy", "admin-ui"], envFile: ".env.integration" })).toEqual([
      "up",
      "--profile=heavy",
      "--profile=admin-ui",
      "--env-file=.env.integration",
      "--json",
    ]);
    expect(upArgs.build({ profile: [], envFile: undefined })).toEqual(["up", "--json"]);
  });
  it.each([
    [{ stack: "-rf" }],
    [{ only: ["ok", "--json"] }],
    [{ only: "api" }],
    [{ force: "yes" }],
    [{ stack: "a b" }],
  ])("rejects %j", (args) => {
    expect(() => upArgs.build(args)).toThrow();
  });
  it("rejects non-string names, non-boolean flags, and non-integer tails", () => {
    expect(() => upArgs.build({ only: ["api", 7] })).toThrow("only must be an array");
    expect(() => upArgs.build({ stack: 7 })).toThrow("stack must be a name");
    expect(() => upArgs.build({ dryRun: "yes" })).toThrow("dryRun must be a boolean");
    expect(() => upArgs.build({ profile: ["ok", "--json"] })).toThrow("profile must be an array");
    expect(() => upArgs.build({ profile: "heavy" })).toThrow("profile must be an array");
    expect(() => upArgs.build({ envFile: "" })).toThrow("envFile must be a non-empty path");
    expect(() => upArgs.build({ envFile: "-rf" })).toThrow("envFile must be a non-empty path");
    expect(() => logsArgs.build({ tail: "5" })).toThrow("tail must be a positive integer");
    expect(() => logsArgs.build({ since: 5 })).toThrow("since must be a duration");
  });
  it("builds and validates logs arguments", () => {
    expect(logsArgs.build({ services: ["api"], tail: 50, since: "5m" })).toEqual([
      "logs",
      "--json",
      "--service=api",
      "--tail=50",
      "--since=5m",
    ]);
    for (const bad of [{ tail: 0 }, { tail: 1.5 }, { since: "5" }, { services: ["-x"] }]) {
      expect(() => logsArgs.build(bad)).toThrow();
    }
  });

  it("passes the logs run selector and rejects anything else", () => {
    expect(buildLogsArgs({ run: "current" })).toEqual(["logs", "--json", "--run=current"]);
    expect(buildLogsArgs({ run: "previous" })).toEqual(["logs", "--json", "--run=previous"]);
    expect(buildLogsArgs({ run: "42" })).toContain("--run=42");
    for (const bad of ["latest", "", 1, "--tail=1"]) {
      expect(() => buildLogsArgs({ run: bad })).toThrow(
        "run must be current, previous or a run id",
      );
    }
  });

  it("passes a logs cursor through to --after and rejects invalid cursors", () => {
    expect(logsArgs.build({ after: "1763500000000000" })).toEqual([
      "logs",
      "--json",
      "--after=1763500000000000",
    ]);
    expect(logsArgs.build({ after: 42 })).toEqual(["logs", "--json", "--after=42"]);
    expect(logsArgs.build({ after: 0 })).toContain("--after=0");
    for (const bad of ["-1", "1.5", "abc", {}, -1]) {
      expect(() => logsArgs.build({ after: bad })).toThrow("after must be a non-negative integer");
    }
  });

  it("passes the logs source filter and rejects any other value", () => {
    expect(logsArgs.build({ services: ["api"], source: "runtime" })).toEqual([
      "logs",
      "--json",
      "--service=api",
      "--source=runtime",
    ]);
    expect(logsArgs.build({ source: "build" })).toContain("--source=build");
    for (const bad of ["other", "", 1, "--tail=1"]) {
      expect(() => logsArgs.build({ source: bad })).toThrow("source must be runtime or build");
    }
  });

  it("builds status arguments from unhealthy and stack, and rejects bad values", () => {
    expect(statusArgs.build({})).toEqual(["status", "--json"]);
    expect(statusArgs.build({ unhealthy: true })).toEqual(["status", "--json", "--unhealthy"]);
    expect(statusArgs.build({ unhealthy: false })).toEqual(["status", "--json"]);
    expect(statusArgs.build({ unhealthy: true, stack: "shop" })).toEqual([
      "status",
      "--json",
      "--unhealthy",
      "--stack=shop",
    ]);
    expect(() => statusArgs.build({ unhealthy: "yes" })).toThrow("unhealthy must be a boolean");
    expect(() => statusArgs.build({ stack: "--strict" })).toThrow("stack must be a name");
    expect(() => statusArgs.build({ stack: 7 })).toThrow("stack must be a name");
  });

  it("passes the unhealthy filter to logs and rejects a non-boolean", () => {
    expect(logsArgs.build({ unhealthy: true })).toEqual(["logs", "--json", "--unhealthy"]);
    expect(logsArgs.build({ unhealthy: false })).toEqual(["logs", "--json"]);
    expect(() => logsArgs.build({ unhealthy: "yes" })).toThrow("unhealthy must be a boolean");
  });

  it("advertises unhealthy on status and logs and stack on status in tools/list", () => {
    const tools = createFliskTools();
    const props = (name: string) => {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema as unknown as
        | { properties: Record<string, { type?: string }> }
        | undefined;
      return schema?.properties ?? {};
    };
    expect(props("status").unhealthy?.type).toBe("boolean");
    expect(props("status").stack?.type).toBe("string");
    expect(props("logs").unhealthy?.type).toBe("boolean");
    expect(props("logs").run?.type).toBe("string");
    expect(props("logs").after?.type).toBe("string");
    for (const name of ["status", "logs"]) {
      expect(tools.find((tool) => tool.name === name)?.description).toContain("unhealthy: true");
    }
  });

  it("advertises the doctor tool's fresh-worktree dependency and .env findings", () => {
    const doctor = createFliskTools().find((tool) => tool.name === "doctor");
    expect(doctor?.description).toContain("missing node_modules/.venv");
    expect(doctor?.description).toContain("exact install command");
    expect(doctor?.description).toContain("copy command");
    expect(doctor?.description).toContain("never copies");
  });

  it("trims status to the unhealthy services, in resources and in each stack, and marks it", () => {
    const full = {
      data: {
        resourceCount: 3,
        unhealthy: ["api"],
        resources: [
          { name: "api", status: "error" },
          { name: "web", status: "ready" },
          { name: "db", status: "ready" },
        ],
        stacks: [
          { name: "app", resources: ["api", "web"], healthyCount: 1 },
          { name: "data", resources: ["db"], healthyCount: 1 },
        ],
        ports: { gateway: 80 },
      },
      errors: [],
    };
    const out = trimStatusToUnhealthy({ data: full, isError: false });
    const data = (out.data as { data: Record<string, unknown> }).data;
    expect(data.resources).toEqual([{ name: "api", status: "error" }]);
    expect(data.stacks).toEqual([
      { name: "app", resources: ["api"], healthyCount: 1 },
      { name: "data", resources: [], healthyCount: 1 },
    ]);
    expect(data.filteredTo).toBe("unhealthy");
    expect(data.unhealthy).toEqual(["api"]);
    expect(data.resourceCount).toBe(3);
    expect(data.ports).toEqual({ gateway: 80 });
    expect(out.isError).toBe(false);
  });

  it("keeps a service whose periodic re-probe reported it unhealthy in the status tool", () => {
    const full = {
      data: {
        resourceCount: 2,
        unhealthy: ["api"],
        resources: [
          {
            name: "api",
            status: "unhealthy",
            statusReason: "GET /health failed 3 consecutive probes",
          },
          { name: "web", status: "ready" },
        ],
      },
      errors: [],
    };
    const out = trimStatusToUnhealthy({ data: full, isError: false });
    const data = (out.data as { data: Record<string, unknown> }).data;
    expect(data.resources).toEqual([
      {
        name: "api",
        status: "unhealthy",
        statusReason: "GET /health failed 3 consecutive probes",
      },
    ]);
    expect(data.unhealthy).toEqual(["api"]);
  });

  it("returns an empty resource list, not an error, when every service is healthy", () => {
    const out = trimStatusToUnhealthy({
      data: {
        data: { unhealthy: [], resources: [{ name: "api", status: "ready" }], stacks: [] },
        errors: [],
      },
      isError: false,
    });
    expect(out.isError).toBe(false);
    expect((out.data as { data: { resources: unknown[] } }).data.resources).toEqual([]);
  });

  it("trims a bare Node project's status by each resource's own status", () => {
    const envelope = (status: string) => ({
      data: { inferred: true, resourceCount: 1, resources: [{ name: "app", stack: null, status }] },
      errors: [],
    });
    const ready = trimStatusToUnhealthy({ data: envelope("ready"), isError: false });
    const readyData = (ready.data as { data: Record<string, unknown> }).data;
    expect(readyData.resources).toEqual([]);
    expect(readyData.filteredTo).toBe("unhealthy");
    expect(readyData.unhealthy).toEqual([]);
    const waiting = trimStatusToUnhealthy({ data: envelope("unknown"), isError: false });
    const waitingData = (waiting.data as { data: Record<string, unknown> }).data;
    expect(waitingData.resources).toEqual([{ name: "app", stack: null, status: "unknown" }]);
    expect(waitingData.filteredTo).toBe("unhealthy");
    expect(waitingData.unhealthy).toEqual(["app"]);
  });

  it("leaves a status result alone when it has no unhealthy list or is an error", () => {
    const odd = { data: { data: [], errors: [] }, isError: false };
    expect(trimStatusToUnhealthy(odd)).toBe(odd);
    const failed = { data: { data: null, errors: [{ code: "X", message: "m" }] }, isError: true };
    expect(trimStatusToUnhealthy(failed)).toBe(failed);
  });

  it("trims the status tool result only when unhealthy is true", async () => {
    const stdout = JSON.stringify({
      schemaVersion: 1,
      data: {
        unhealthy: ["api"],
        resources: [{ name: "api" }, { name: "web" }],
        stacks: [],
      },
      errors: [],
    });
    const tools = createFliskTools(async () => ({ exitCode: 0, stdout, stderr: "" }));
    const names = async (args: Record<string, unknown>) => {
      const r = await tools.find((t) => t.name === "status")?.handler(args);
      const body = r?.data as { data: { resources: { name: string }[] } } | undefined;
      return (body?.data.resources ?? []).map((x) => x.name);
    };
    expect(await names({})).toEqual(["api", "web"]);
    expect(await names({ unhealthy: false })).toEqual(["api", "web"]);
    expect(await names({ unhealthy: true })).toEqual(["api"]);
  });

  it("calls the CLI with the unhealthy filters for status and logs", async () => {
    const seen: string[][] = [];
    const tools = createFliskTools(async (args) => {
      seen.push(args);
      return { exitCode: 0, stdout: '{"schemaVersion":1,"data":[],"errors":[]}', stderr: "" };
    });
    const status = await tools
      .find((t) => t.name === "status")
      ?.handler({ unhealthy: true, stack: "shop" });
    const logs = await tools.find((t) => t.name === "logs")?.handler({ unhealthy: true });
    expect(seen).toEqual([
      ["status", "--json", "--unhealthy", "--stack=shop"],
      ["logs", "--json", "--unhealthy"],
    ]);
    // every service healthy: an empty list, not an error
    expect(status?.isError).toBe(false);
    expect(logs?.isError).toBe(false);
  });

  it("advertises source as an enum on the logs tool schema", () => {
    const logs = createFliskTools().find((tool) => tool.name === "logs");
    const schema = logs?.inputSchema as unknown as {
      properties: Record<string, { enum?: string[] }>;
    };
    expect(schema.properties.source?.enum).toEqual(["runtime", "build"]);
  });

  it("advertises profile and envFile on the up tool schema", () => {
    const up = createFliskTools().find((tool) => tool.name === "up");
    const schema = up?.inputSchema as unknown as {
      properties: Record<string, { type?: string; items?: { type?: string } }>;
    };
    expect(schema.properties.profile).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
    expect(schema.properties.envFile).toMatchObject({ type: "string" });
  });

  it("builds resource_create arguments, always non-interactive, with options after the name", () => {
    expect(resourceCreateArgs.build({ name: "api" })).toEqual(["resource", "api", "--json"]);
  });

  it("builds flisk tool add arguments for tool_add and rejects an unknown tool before running", () => {
    expect(toolAddArgs.build({ tool: "react" })).toEqual(["tool", "add", "react", "--json"]);
    expect(
      toolAddArgs.build({ tool: "postgresql", name: "db", stack: "shop", dryRun: true }),
    ).toEqual(["tool", "add", "postgresql", "db", "--json", "--stack=shop", "--dry-run"]);
    expect(() => toolAddArgs.build({})).toThrow(/tool is required/);
    expect(() => toolAddArgs.build({ tool: "cobol" })).toThrow(/does not know the tool "cobol"/);
    // The hint lists only tools that can be added; the rejected cloud tools are never offered.
    for (const args of [{}, { tool: "cobol" }] as Array<Record<string, unknown>>) {
      let error: unknown;
      try {
        toolAddArgs.build(args);
      } catch (caught) {
        error = caught;
      }
      const hint = (error as FliskError).suggestions.join("\n");
      for (const id of ["aws", "google-cloud", "azure", "kubernetes"]) {
        expect(hint).not.toContain(id);
      }
      expect(hint).toContain("react");
    }
    // Everyday spellings resolve to the id, so a rejected cloud provider reaches the CLI and its reason.
    expect(toolAddArgs.build({ tool: "google cloud" })).toEqual([
      "tool",
      "add",
      "google-cloud",
      "--json",
    ]);
    expect(toolAddArgs.build({ tool: "Next.js" })).toEqual(["tool", "add", "nextjs", "--json"]);
    expect(() => toolAddArgs.build({ tool: "react", name: "--evil" })).toThrow(
      /name must be a name/,
    );
    expect(resourceCreateArgs.build({ name: "api", type: "backend", local: true })).toEqual([
      "resource",
      "api",
      "--type=backend",
      "--local",
      "--json",
    ]);
    expect(() => resourceCreateArgs.build({ name: "api", local: "yes" })).toThrow(/boolean/);
    expect(resourceCreateArgs.build({ name: "web", type: "frontend", local: true })).toContain(
      "--local",
    );
    for (const type of ["worker", "agent", "mcp"]) {
      expect(resourceCreateArgs.build({ name: "x", type, local: true }), type).toContain("--local");
    }
    for (const type of ["database", "queue"]) {
      expect(() => resourceCreateArgs.build({ name: "x", type, local: true }), type).toThrow(
        /frontend, backend, worker, mcp and agent/,
      );
    }
    expect(
      resourceCreateArgs.build({
        name: "api",
        type: "backend",
        stack: "shop",
        framework: "hono",
        language: "bun",
        port: 4100,
        features: ["prisma", "drizzle"],
      }),
    ).toEqual([
      "resource",
      "api",
      "--type=backend",
      "--stack=shop",
      "--framework=hono",
      "--language=bun",
      "--port=4100",
      "--feature=prisma",
      "--feature=drizzle",
      "--json",
    ]);
    expect(
      resourceCreateArgs.build({
        name: "bot",
        type: "agent",
        runtime: "custom",
        durability: "files",
      }),
    ).toEqual([
      "resource",
      "bot",
      "--type=agent",
      "--runtime=custom",
      "--durability=files",
      "--json",
    ]);
  });
  it.each([
    [{ name: "" }, "Resource name is required"],
    [{ name: "-rf" }, 'Resource name "-rf" is not valid'],
    [{ name: "a b" }, 'Resource name "a b" is not valid'],
    [{ name: 7 }, "name must be a string"],
    // The CLI's own rule: ".", "_" and uppercase pass the shared name pattern but are refused.
    [{ name: "My.Api_1" }, 'Resource name "My.Api_1" is not valid'],
    [{ name: "my_service" }, 'Resource name "my_service" is not valid'],
    [{ name: "MyService" }, 'Resource name "MyService" is not valid'],
    [{ name: "-api" }, 'Resource name "-api" is not valid'],
    [{ name: "api-" }, 'Resource name "api-" is not valid'],
    [{ name: "con" }, "Windows reserves it for a device"],
    [{ name: "x".repeat(64) }, "the limit is 63"],
    [{ name: "api", type: "lambda" }, "type must be one of: backend, frontend"],
    [{ name: "api", type: "sdk" }, "type must be one of"],
    [{ name: "api", stack: "--json" }, "stack must be a name"],
    [{ name: "api", framework: "react native" }, "framework must be a name"],
    [{ name: "api", language: "-x" }, "language must be a name"],
    [{ name: "api", port: 0 }, "port must be an integer from 1 to 65535"],
    [{ name: "api", port: 70000 }, "port must be an integer from 1 to 65535"],
    [{ name: "api", port: "4000" }, "port must be an integer from 1 to 65535"],
    [{ name: "api", port: 4000.5 }, "port must be an integer from 1 to 65535"],
    [{ name: "api", features: "prisma" }, "features must be an array of names"],
    [{ name: "api", features: ["--force"] }, "features must be an array of names"],
    [{ name: "bot", runtime: "a/b" }, "runtime must be a name"],
    [{ name: "bot", durability: "" }, "durability must be a name"],
  ])("rejects resource_create arguments %j", (args, message) => {
    expect(() => resourceCreateArgs.build(args)).toThrow(message);
  });

  it("rejects a bad resource_create name with the CLI's own message and rule", () => {
    for (const name of ["My.Api_1", "my_service", "MyService"]) {
      const error = (() => {
        try {
          buildResourceCreateArgs({ name });
        } catch (caught) {
          return caught as FliskError;
        }
        throw new Error("expected to throw");
      })();
      expect(error).toBeInstanceOf(FliskError);
      expect(error.message).toBe(validateResourceName(name).error);
      expect(error.message).toContain("Use lowercase letters, numbers, and hyphens only");
      expect(error.suggestions.join(" ")).toContain("my-service");
    }
  });

  it("publishes the CLI's kebab-case rule as the name schema's pattern", () => {
    const tool = createFliskTools(async () => ({ exitCode: 0, stdout: "", stderr: "" })).find(
      (t) => t.name === "resource_create",
    );
    const schema = tool?.inputSchema as { properties: { name: { pattern?: string } } };
    expect(schema.properties.name.pattern).toBe(KEBAB_CASE_REGEX.source);
  });

  it("builds stack_assign arguments with one --resources= per name", () => {
    expect(stackAssignArgs.build({ stack: "shop", resources: ["api", "web"] })).toEqual([
      "stack",
      "shop",
      "--resources=api",
      "--resources=web",
      "--json",
    ]);
  });
  it("passes --move to stack_assign only when move is true", () => {
    expect(stackAssignArgs.build({ stack: "shop", resources: ["api"], move: true })).toEqual([
      "stack",
      "shop",
      "--move",
      "--resources=api",
      "--json",
    ]);
    expect(stackAssignArgs.build({ stack: "shop", resources: ["api"], move: false })).not.toContain(
      "--move",
    );
  });
  it.each([
    [{ resources: ["api"] }, "stack is required"],
    [{ stack: "shop" }, "resources must name at least one resource"],
    [{ stack: "shop", resources: [] }, "resources must name at least one resource"],
    [{ stack: "-shop", resources: ["api"] }, "stack must be a name"],
    [{ stack: "shop", resources: "api" }, "resources must be an array of names"],
    [{ stack: "shop", resources: ["api", "--list"] }, "resources must be an array of names"],
  ])("rejects stack_assign arguments %j", (args, message) => {
    expect(() => stackAssignArgs.build(args)).toThrow(message);
  });

  it("builds project_init arguments and never passes --force", () => {
    expect(projectInitArgs.build({})).toEqual(["project", "--yes"]);
    expect(projectInitArgs.build({ agentSkills: false })).toEqual([
      "project",
      "--no-agent-skills",
      "--yes",
    ]);
    expect(projectInitArgs.build({ agentSkills: true })).toEqual(["project", "--yes"]);
    expect(projectInitArgs.build({ template: "agent-stack" })).toEqual([
      "project",
      "agent-stack",
      "--yes",
    ]);
    expect(projectInitArgs.build({ template: "saas", path: "apps/my saas" })).toEqual([
      "project",
      "saas",
      "--path=apps/my saas",
      "--yes",
    ]);
    expect(projectInitArgs.build({ name: "my-shop" })).toEqual([
      "project",
      "--name=my-shop",
      "--yes",
    ]);
    expect(projectInitArgs.build({ name: "my-shop", agentSkills: false })).toEqual([
      "project",
      "--name=my-shop",
      "--no-agent-skills",
      "--yes",
    ]);
    for (const template of Object.keys(PROJECT_TEMPLATES)) {
      expect(projectInitArgs.build({ template })).toEqual(["project", template, "--yes"]);
    }
    expect(JSON.stringify(projectInitArgs.build({ force: true }))).not.toContain("--force");
  });
  it.each([
    [{ template: "rails" }, "template must be one of: demo"],
    [{ template: "--force" }, "template must be one of"],
    [{ path: "elsewhere" }, "path applies only with a template"],
    [
      { template: "saas", path: "-x" },
      'path must be a non-empty path that does not start with "-"',
    ],
    [{ template: "saas", path: "" }, "path must be a non-empty path"],
    [{ template: "saas", path: "a\nb" }, "path must be a non-empty path"],
    [{ template: "saas", agentSkills: false }, "agentSkills applies only to a blank project"],
    [{ agentSkills: "no" }, "agentSkills must be a boolean"],
    [{ template: "saas", name: "my-shop" }, "name applies only to a blank project"],
    [{ name: "My Shop" }, 'Project name "My Shop" is not valid'],
    [{ name: "my_shop" }, 'Project name "my_shop" is not valid'],
    [{ name: "--yes" }, 'Project name "--yes" is not valid'],
    [{ name: "" }, "Project name is required"],
    [{ name: "  " }, "Project name is required"],
    [{ name: 42 }, "name must be a string"],
    [{ name: "a".repeat(64) }, "is 64 characters; the limit is 63"],
  ])("rejects project_init arguments %j", (args, message) => {
    expect(() => projectInitArgs.build(args)).toThrow(message);
  });

  it("makes config_regenerate a dry run unless dryRun is explicitly false", () => {
    expect(configRegenerateArgs.build({})).toEqual(["config", "regenerate", "--dry-run", "--json"]);
    expect(configRegenerateArgs.build({ dryRun: true })).toEqual([
      "config",
      "regenerate",
      "--dry-run",
      "--json",
    ]);
    expect(configRegenerateArgs.build({ dryRun: false })).toEqual([
      "config",
      "regenerate",
      "--json",
    ]);
    expect(() => configRegenerateArgs.build({ dryRun: "false" })).toThrow(
      "dryRun must be a boolean",
    );
    expect(() => configRegenerateArgs.build({ dryRun: 0 })).toThrow("dryRun must be a boolean");
  });
});
