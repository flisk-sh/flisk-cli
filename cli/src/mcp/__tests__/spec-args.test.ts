// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * Tests for the spec-bound argument tables (`mcp/spec-args.ts` and the per-tool tables in
 * `mcp/tools.ts`):
 *
 *   - the mapper itself (flag parsing, spec lookup, row resolution, schema generation);
 *   - the argv every tool's table emits, across boolean flags, array flags, undefined and
 *     empty omissions and positional arguments;
 *   - the round trip the refactor rests on: argv the mapper builds parses back to the same
 *     values under the real Commander program, for every spec'd command and for every tool
 *     table (proving a tool table can never name a flag the command does not have);
 *   - the generated inputSchemas, which must stay identical to what the hand-written
 *     OBJECT() literals advertised before.
 */
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { COMMAND_SPECS } from "../../commands/command-specs.generated.js";
import type { CommandSpec } from "../../commands/command-specs.js";
import { getRegisteredCommands } from "../../commands/registry.js";
import {
  type ArgRow,
  type ArgSpec,
  argSpec,
  buildArgs,
  guard,
  inputSchema,
  mcpArg,
  option,
  PROJECT_PATH,
  parseOptionFlags,
  positional,
  specOf,
} from "../spec-args.js";
import { buildLogsArgs } from "../tools/families/logs.js";
import { buildWaitArgs } from "../tools/families/wait.js";
import { createFliskTools, TOOL_ARG_SPECS } from "../tools.js";

describe("parseOptionFlags", () => {
  it.each([
    [
      "-v, --verbose",
      {
        long: "--verbose",
        attribute: "verbose",
        negated: false,
        takesValue: false,
        variadic: false,
      },
    ],
    [
      "--no-ping",
      { long: "--no-ping", attribute: "ping", negated: true, takesValue: false, variadic: false },
    ],
    [
      "--no-agent-skills",
      {
        long: "--no-agent-skills",
        attribute: "agentSkills",
        negated: true,
        takesValue: false,
        variadic: false,
      },
    ],
    [
      "-s, --service <names...>",
      {
        long: "--service",
        attribute: "service",
        negated: false,
        takesValue: true,
        variadic: true,
      },
    ],
    [
      "--prune-cache [age]",
      {
        long: "--prune-cache",
        attribute: "pruneCache",
        negated: false,
        takesValue: true,
        variadic: false,
      },
    ],
    [
      "--wait-timeout <seconds>",
      {
        long: "--wait-timeout",
        attribute: "waitTimeout",
        negated: false,
        takesValue: true,
        variadic: false,
      },
    ],
    [
      "--env-file <path>",
      {
        long: "--env-file",
        attribute: "envFile",
        negated: false,
        takesValue: true,
        variadic: false,
      },
    ],
  ])("reads %s as the flag it declares", (flags, expected) => {
    expect(parseOptionFlags(flags)).toEqual(expected);
  });
});

describe("specOf and argSpec", () => {
  it("finds nested commands and refuses paths that are not runnable commands", () => {
    expect(specOf(["config", "verify"]).path).toEqual(["config", "verify"]);
    expect(() => specOf(["config"])).toThrow('argSpec: "config" is a command group');
    expect(() => specOf(["nope"])).toThrow('argSpec: no command spec for "nope"');
    expect(() => specOf(["config", "nope"])).toThrow('argSpec: no command spec for "config nope"');
  });

  it("fails at declaration time when a row names a flag or argument the command lacks", () => {
    expect(() => argSpec(["logs"], [option("--bogus")])).toThrow("logs has no option --bogus");
    expect(() => argSpec(["logs"], [positional("bogus")])).toThrow("logs has no argument bogus");
    expect(() => argSpec(["logs"], [option("--tail")])).toThrow(
      '--tail takes a value and needs an explicit "as"',
    );
    expect(() => argSpec(["logs"], [option("--tail", { as: "names" })])).toThrow(
      '--tail is not variadic and cannot take "names"',
    );
    expect(() => argSpec(["run"], [positional("service", { as: "boolean" })])).toThrow(
      'service is a positional and cannot be "boolean"',
    );
  });
});

describe("review regressions", () => {
  it("resolves a row past a short-only option declared before it", () => {
    const down = specOf(["down"]);
    const dryRun = down.options.find((o) => o.flags.includes("--dry-run"));
    if (!dryRun) throw new Error("down has no --dry-run");
    const withShortOnly: CommandSpec = {
      ...down,
      options: [{ ...dryRun, flags: "-q" }, ...down.options],
    };
    const rows: ArgRow[] = [option("--dry-run", { arg: "dryRun" })];
    expect(buildArgs(withShortOnly, rows, { dryRun: true })).toEqual(["down", "--dry-run"]);
    expect(() => buildArgs(withShortOnly, [option("--bogus")], {})).toThrow(
      "down has no option --bogus",
    );
  });

  it("refuses an omitted required boolean, and accepts an explicit false", () => {
    const down = specOf(["down"]);
    const rows: ArgRow[] = [option("--dry-run", { arg: "dryRun", required: true })];
    expect(() => buildArgs(down, rows, {})).toThrow("dryRun is required");
    expect(buildArgs(down, rows, { dryRun: false })).toEqual(["down"]);
    expect(buildArgs(down, rows, { dryRun: true })).toEqual(["down", "--dry-run"]);
  });

  it("logs: validates grep and context before they are turned into argv", () => {
    expect(() => buildLogsArgs({ grep: { toString: null } })).toThrow("grep must be a string");
    expect(() => buildLogsArgs({ context: -1 })).toThrow("context requires grep");
    expect(() => buildLogsArgs({ grep: "error", context: 2 ** 53 })).toThrow(
      "context must be a non-negative safe integer",
    );
    expect(buildLogsArgs({ grep: "", context: 0 })).toContain("--context=0");
    expect(buildLogsArgs({ grep: "e", context: Number.MAX_SAFE_INTEGER })).toContain(
      "--context=9007199254740991",
    );
  });

  it("wait: still accepts a numeric-string timeoutSeconds", () => {
    expect(buildWaitArgs({ timeoutSeconds: "60" })).toContain("--timeout=60");
    expect(buildWaitArgs({ timeoutSeconds: 60 })).toContain("--timeout=60");
    expect(() => buildWaitArgs({ timeoutSeconds: "0" })).toThrow("timeoutSeconds must be a whole");
    expect(() => buildWaitArgs({ timeoutSeconds: "abc" })).toThrow("timeoutSeconds must be");
  });
});

describe("buildArgs", () => {
  const spec = specOf(["down"]);

  it("emits the command path first, literals where the row sits, and omits absent values", () => {
    const rows: ArgRow[] = ["--json", option("--dry-run", { arg: "dryRun" })];
    expect(buildArgs(spec, rows, {})).toEqual(["down", "--json"]);
    expect(buildArgs(spec, rows, { dryRun: true })).toEqual(["down", "--json", "--dry-run"]);
    expect(buildArgs(spec, rows, { dryRun: false })).toEqual(["down", "--json"]);
  });

  it("keeps literal tokens and guards in row order, and skips MCP-only rows", () => {
    const checked: string[] = [];
    const rows: ArgRow[] = [
      mcpArg("confirm", { type: "boolean" }),
      guard((args) => {
        checked.push(String(args.confirm));
      }),
      "--yes",
    ];
    expect(buildArgs(spec, rows, { confirm: true })).toEqual(["down", "--yes"]);
    expect(checked).toEqual(["true"]);
  });
});

describe("inputSchema", () => {
  it("generates types, enums, bounds, defaults and required from the same rows build reads", () => {
    const spec = specOf(["logs"]);
    const rows: ArgRow[] = [
      option("--service", { arg: "services", description: "Only these services" }),
      option("--unhealthy"),
      option("--tail", { as: "int", min: 1, description: null, schema: { maximum: 10000 } }),
      mcpArg("confirm", { type: "boolean", description: "Ask first" }),
    ];
    expect(inputSchema(spec, rows, { projectPath: true })).toEqual({
      type: "object",
      properties: {
        projectPath: PROJECT_PATH,
        services: {
          type: "array",
          items: { type: "string" },
          description: "Only these services",
        },
        unhealthy: {
          type: "boolean",
          description: "Only services that are failing or still starting",
        },
        tail: { type: "integer", minimum: 1, maximum: 10000 },
        confirm: { type: "boolean", description: "Ask first" },
      },
      additionalProperties: false,
    });
  });
});

// The argv every tool table emits. Each case exercises a flag kind the table has: booleans
// (emitted when true, or false for the negated/default-true ones), array flags (one --flag=
// per element), values that must be omitted when undefined or empty, positional arguments
// and the literal tokens (--json, --yes, --) that pin a tool to its command's contract.
describe("tool argument tables emit the argv the contract promises", () => {
  it.each([
    // tool, args, expected argv
    ["doctor", {}, ["doctor", "--json"]],
    [
      "doctor",
      { problemsOnly: true, noPing: true },
      ["doctor", "--json", "--problems-only", "--no-ping"],
    ],
    ["doctor", { problemsOnly: false }, ["doctor", "--json"]],
    ["up", {}, ["up", "--json"]],
    [
      "up",
      {
        stack: "store",
        only: ["api", "web"],
        profile: ["heavy"],
        envFile: ".env.e2e",
        force: true,
        dryRun: true,
      },
      [
        "up",
        "store",
        "--only=api",
        "--only=web",
        "--profile=heavy",
        "--env-file=.env.e2e",
        "--force",
        "--dry-run",
        "--json",
      ],
    ],
    ["up", { only: [], profile: [], envFile: undefined }, ["up", "--json"]],
    ["down", {}, ["down", "--json"]],
    ["down", { dryRun: true }, ["down", "--json", "--dry-run"]],
    ["down", { dryRun: false }, ["down", "--json"]],
    ["status", {}, ["status", "--json"]],
    [
      "status",
      { unhealthy: true, stack: "shop" },
      ["status", "--json", "--unhealthy", "--stack=shop"],
    ],
    ["logs", {}, ["logs", "--json"]],
    [
      "logs",
      {
        services: ["api", "web"],
        unhealthy: true,
        tail: 50,
        since: "5m",
        after: "12",
        source: "runtime",
      },
      [
        "logs",
        "--json",
        "--unhealthy",
        "--service=api",
        "--service=web",
        "--tail=50",
        "--since=5m",
        "--after=12",
        "--source=runtime",
      ],
    ],
    ["logs", { services: [] }, ["logs", "--json"]],
    ["resource_list", {}, ["resources", "--json"]],
    ["resource_list", { stack: "shop" }, ["resources", "--json", "--stack=shop"]],
    ["resource_restart", { resource: "api" }, ["restart", "api", "--json", "--wait=60"]],
    [
      "resource_restart",
      { resource: "api", waitSeconds: 20, rebuild: true },
      ["restart", "api", "--json", "--wait=20", "--rebuild"],
    ],
    [
      "resource_run",
      { resource: "api", command: ["node", "seed.js"], confirm: true },
      ["run", "api", "--json", "--", "node", "seed.js"],
    ],
    ["agent_list", {}, ["resources", "--type=agent", "--json"]],
    ["agent_list", { stack: "shop" }, ["resources", "--type=agent", "--json", "--stack=shop"]],
    ["agent_sessions", { resource: "bot" }, ["agent", "sessions", "bot", "--json"]],
    [
      "agent_sessions",
      { resource: "bot", sessionId: "s-1" },
      ["agent", "sessions", "bot", "--session-id=s-1", "--json"],
    ],
    ["stack_list", {}, ["stacks", "--json"]],
    [
      "stack_list",
      { services: true, verbose: true },
      ["stacks", "--json", "--services", "--verbose"],
    ],
    ["project_info", {}, ["projects", "--json"]],
    ["network_list", { stack: "shop" }, ["networks", "--json", "--stack=shop"]],
    ["config_verify", {}, ["config", "verify", "--json"]],
    [
      "config_explain",
      { file: ".flisk/.flisk-out/Tiltfile" },
      ["config", "explain", ".flisk/.flisk-out/Tiltfile", "--json"],
    ],
    ["runtime_check", {}, ["runtime", "--check-assets", "--json"]],
    ["config_regenerate", {}, ["config", "regenerate", "--dry-run", "--json"]],
    ["config_regenerate", { dryRun: false }, ["config", "regenerate", "--json"]],
    ["resource_create", { name: "api" }, ["resource", "api", "--json"]],
    [
      "resource_create",
      {
        name: "api",
        type: "backend",
        stack: "shop",
        framework: "hono",
        language: "bun",
        port: 4100,
        features: ["prisma", "drizzle"],
        runtime: "custom",
        durability: "postgres",
        local: true,
      },
      [
        "resource",
        "api",
        "--type=backend",
        "--stack=shop",
        "--framework=hono",
        "--language=bun",
        "--port=4100",
        "--feature=prisma",
        "--feature=drizzle",
        "--runtime=custom",
        "--durability=postgres",
        "--local",
        "--json",
      ],
    ],
    ["tool_add", { tool: "react" }, ["tool", "add", "react", "--json"]],
    ["tool_add", { tool: "Next.js" }, ["tool", "add", "nextjs", "--json"]],
    [
      "tool_add",
      { tool: "react", name: "web", stack: "shop", dryRun: true },
      ["tool", "add", "react", "web", "--json", "--stack=shop", "--dry-run"],
    ],
    [
      "stack_assign",
      { stack: "shop", resources: ["api", "web"] },
      ["stack", "shop", "--resources=api", "--resources=web", "--json"],
    ],
    [
      "stack_assign",
      { stack: "shop", resources: ["api"], move: true },
      ["stack", "shop", "--move", "--resources=api", "--json"],
    ],
    ["project_init", {}, ["project", "--yes"]],
    ["project_init", { agentSkills: false }, ["project", "--no-agent-skills", "--yes"]],
    [
      "project_init",
      { template: "saas", path: "apps/my saas" },
      ["project", "saas", "--path=apps/my saas", "--yes"],
    ],
    ["project_eject", { confirm: true }, ["eject", "--yes", "--json"]],
    ["project_eject", { dryRun: true }, ["eject", "--dry-run", "--json"]],
    ["project_eject", { confirm: true, dryRun: true }, ["eject", "--dry-run", "--json"]],
    ["project_import", {}, ["import", "--json"]],
    ["project_import", { dir: "./compose" }, ["import", "./compose", "--json"]],
    ["project_import", { force: true, dryRun: true }, ["import", "--dry-run", "--force", "--json"]],
    ["project_import", { force: true, confirm: true }, ["import", "--force", "--json"]],
  ] as const)("builds %s argv for %o", (tool, args, expected) => {
    expect(TOOL_ARG_SPECS[tool]?.build(args)).toEqual(expected);
  });

  it.each([
    // Refusals reach the caller before any command runs, with the same text the
    // hand-written builders produced.
    ["status", { stack: "--strict" }, "stack must be a name"],
    ["logs", { tail: "5" }, "tail must be a positive integer"],
    ["logs", { since: 5 }, "since must be a duration"],
    ["logs", { source: "stderr" }, "source must be runtime or build"],
    ["resource_restart", {}, "resource is required"],
    ["resource_run", { resource: "api", command: [] }, "command is required"],
    ["resource_run", { resource: "api", command: ["ls"] }, "needs confirm: true"],
    ["config_explain", {}, "file is required"],
    ["resource_create", {}, "name is required"],
    [
      "resource_create",
      { name: "x", type: "database", local: true },
      "local applies to type frontend, backend, worker, mcp and agent",
    ],
    ["tool_add", {}, "tool is required"],
    ["tool_add", { tool: "cobol" }, 'does not know the tool "cobol"'],
    ["stack_assign", {}, "stack is required"],
    ["stack_assign", { stack: "shop", resources: [] }, "resources must name at least one resource"],
    ["project_init", { path: "apps/x" }, "path applies only with a template"],
    [
      "project_init",
      { template: "saas", agentSkills: false },
      "agentSkills applies only to a blank project",
    ],
    ["project_eject", {}, "needs confirm: true"],
    ["project_import", { force: true }, "needs confirm: true"],
  ] as const)("refuses %s with %o", (tool, args, message) => {
    expect(() => TOOL_ARG_SPECS[tool]?.build(args)).toThrow(message);
  });
});

// The registered (real) Commander command at a spec path, for example ["config", "verify"].
function commandAt(path: readonly string[]): Command {
  let command = getRegisteredCommands().find((cmd) => cmd.name() === path[0]);
  for (const name of path.slice(1)) {
    command = command?.commands.find((cmd) => cmd.name() === name) as Command | undefined;
  }
  if (!command) throw new Error(`no registered command for ${path.join(" ")}`);
  return command;
}

// The real command's option parser, run on argv and left inspectable: parsed option values
// plus the operand and unknown token lists. _optionValues and _optionValueSources are cleared and restored so the
// shared Command object does not leak defaults or values between calls.
function parseOnReal(
  spec: CommandSpec,
  argv: string[],
): { opts: Record<string, unknown>; operands: string[]; unknown: string[] } {
  const command = commandAt(spec.path);
  const holder = command as unknown as {
    _optionValues: Record<string, unknown>;
    _optionValueSources: Record<string, unknown>;
  };
  const savedValues = holder._optionValues;
  // Parsing writes the source of each option ("cli", "default") in place, so keep a copy.
  const savedSources = { ...holder._optionValueSources };
  holder._optionValues = {};
  try {
    const { operands, unknown } = command.parseOptions(argv.slice(spec.path.length));
    return { opts: { ...(command.opts() as Record<string, unknown>) }, operands, unknown };
  } finally {
    holder._optionValues = savedValues;
    holder._optionValueSources = savedSources;
  }
}

const runnable = (spec: CommandSpec): CommandSpec[] => [
  ...(spec.hasAction ? [spec] : []),
  ...spec.subcommands.flatMap(runnable),
];
const specs = COMMAND_SPECS.flatMap(runnable).filter((spec) => !spec.positionalOptions);

describe("every spec'd command round-trips through the real Commander program", () => {
  // One case per spec element (an option or an argument), not per command: two options can
  // share one attribute (--stack and --no-stack both write "stack"), so binding a whole
  // command at once would collide. Binding each element alone proves the mapper speaks the
  // spec's own language for every flag and positional the CLI declares.
  const cases = specs.flatMap((spec) => [
    ...spec.options.map(
      (specOption) =>
        [
          `${spec.path.join(" ")} ${specOption.flags}`,
          { spec, specOption, specArgument: undefined as undefined },
        ] as const,
    ),
    ...spec.arguments.map(
      (specArgument) =>
        [
          `${spec.path.join(" ")} <${specArgument.name}>`,
          { spec, specOption: undefined as undefined, specArgument },
        ] as const,
    ),
  ]);

  it.each(cases)(
    "%s builds from the spec and parses back",
    (_label, { spec, specOption, specArgument }) => {
      if (specOption) {
        const flags = parseOptionFlags(specOption.flags);
        const value = !flags.takesValue
          ? !flags.negated // a --no-* row emits when its attribute is false
          : specOption.argChoices?.length
            ? specOption.argChoices[0]
            : flags.variadic
              ? ["alpha", "beta"]
              : "alpha";
        const row = option(flags.long, {
          arg: flags.attribute,
          as: flags.takesValue ? (flags.variadic ? "strings" : "raw") : "boolean",
        });
        const argv = buildArgs(spec, [row], { [flags.attribute]: value });
        const command = commandAt(spec.path);
        const { opts, operands, unknown: rejected } = parseOnReal(spec, argv);
        expect(rejected, `unknown tokens in ${argv.join(" ")}`).toEqual([]);
        // The real Option knows its own key: a --no- flag a command repurposed on purpose
        // (`resources --no-stack` clears negate and keeps its own noStack key) does not share
        // the bare name. A collect-style parseArg (`os --scan-root`) wraps the value, which
        // flat() absorbs.
        const real = command.options.find((candidate) => candidate.long === flags.long);
        const attribute = real?.attributeName() ?? flags.attribute;
        const emitted = flags.takesValue ? (Array.isArray(value) ? value : [value]) : value;
        const expected = flags.takesValue ? emitted : real?.negate !== true;
        const parsed = flags.takesValue ? [opts[attribute]].flat() : opts[attribute];
        expect(parsed, `${spec.path.join(" ")} ${flags.long} -> ${attribute}`).toEqual(expected);
        expect(operands, `operands in ${argv.join(" ")}`).toEqual([]);
      } else {
        const value = specArgument.variadic ? ["alpha", "beta"] : "alpha";
        const row = positional(specArgument.name, {
          as: specArgument.variadic ? "strings" : "raw",
        });
        const argv = buildArgs(spec, [row], { [specArgument.name]: value });
        const { operands, unknown: rejected } = parseOnReal(spec, argv);
        expect(rejected, `unknown tokens in ${argv.join(" ")}`).toEqual([]);
        expect(operands, `operands in ${argv.join(" ")}`).toEqual(
          Array.isArray(value) ? value : [value],
        );
      }
    },
  );
});

// A value each binding kind can take, so every bound flag and positional of a tool table is
// exercised in one argv.
function sampleFor(spec: ArgSpec): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const binding of spec.bindings) {
    const { row, as, arg } = binding;
    // Two rows may share one argument (project_eject binds dryRun to --dry-run and --yes);
    // the first wins, which is also the one the argument belongs to in the schema.
    if (args[arg] !== undefined) continue;
    switch (as) {
      case "boolean": {
        const negatedSelf =
          binding.option?.flags.negated === true && arg === binding.option.flags.attribute;
        args[arg] = row.when ?? !negatedSelf;
        break;
      }
      case "names":
      case "strings":
        args[arg] = ["orders-api"];
        break;
      case "port":
        args[arg] = 4100;
        break;
      case "int":
        args[arg] = Math.max(row.min ?? 1, 2);
        break;
      case "number":
        args[arg] = row.default ?? 42;
        break;
      case "duration":
        args[arg] = "5m";
        break;
      case "cursor":
        args[arg] = "42";
        break;
      case "choice":
        args[arg] =
          row.choices?.[0] ??
          binding.option?.spec.argChoices?.[0] ??
          binding.argument?.argChoices?.[0];
        break;
      default:
        args[arg] = "orders-api";
    }
  }
  return args;
}

describe("every tool table's argv parses under the real Commander program", () => {
  // Sample arguments a binding kind cannot invent for itself: the catalog lookup in
  // tool_add's coerce, the confirm gates, and a negated flag a template forbids.
  const overrides: Record<string, Record<string, unknown>> = {
    tool_add: { tool: "react" },
    resource_run: { confirm: true },
    project_init: { agentSkills: undefined, name: undefined },
    logs: { run: "current" },
    config_verify: { diffFiles: ["Tiltfile"] },
  };

  it.each(Object.entries(TOOL_ARG_SPECS))(
    "%s argv resolves to real options and positionals",
    (tool, table) => {
      const args = { ...sampleFor(table), ...overrides[tool] };
      const argv = table.build(args);
      const { unknown } = parseOnReal(table.spec, argv);
      expect(unknown, `unknown tokens in ${argv.join(" ")}`).toEqual([]);
    },
  );

  it("every tool that runs the CLI derives its inputSchema from its argument table", () => {
    const run = async () => ({ exitCode: 0, stdout: "", stderr: "" });
    const tools = createFliskTools(run);
    for (const tool of tools) {
      if (tool.name === "project_templates") continue;
      const table = TOOL_ARG_SPECS[tool.name];
      expect(table, `${tool.name} has no argument table`).toBeDefined();
      const projectPath =
        tool.name === "project_init"
          ? {
              type: "string",
              description:
                "Absolute path to an existing directory to create the project in (or to clone the template from)",
            }
          : true;
      expect(tool.inputSchema, tool.name).toEqual(table.inputSchema({ projectPath }));
    }
  });
});
