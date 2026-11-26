// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  arrowText: vi.fn(),
  arrowSelect: vi.fn(),
  arrowMultiSelect: vi.fn(),
}));
vi.mock("../../../utils/arrow-prompt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/arrow-prompt.js")>()),
  ...prompts,
}));

const oneCommand = vi.hoisted(() => ({ installServiceDependencies: vi.fn() }));
vi.mock("../../../utils/one-command.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/one-command.js")>()),
  installServiceDependencies: oneCommand.installServiceDependencies,
}));

import { PromptCancelled } from "../../../utils/arrow-prompt.js";
import type { CreateAnswers, CreateStep } from "../../../utils/create-plan.js";
import { FliskError } from "../../../utils/errors.js";
import {
  dryRunResult,
  installServices,
  renderStep,
  resolveStartIntent,
  runPlanSteps,
  splitCommand,
  startProject,
  writeProjectReadme,
} from "../install-plan.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flisk-create-plan-"));
  for (const mock of Object.values(prompts)) mock.mockReset();
  oneCommand.installServiceDependencies.mockReset();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const localApp: CreateAnswers = {
  name: "shop",
  runtime: "local",
  frontend: "react",
  backend: { language: "bun", framework: "hono" },
  extras: [],
};

const step = (label: string, args: string[], inProject = false): CreateStep => ({
  label,
  args,
  inProject,
});

/** A script that exits with the code in its first argument, so a plan step can pass or fail on demand. */
function exitScript(name = "exit.mjs"): string {
  const script = join(dir, name);
  writeFileSync(script, "process.exit(Number(process.argv[2]) || 0)\n");
  return script;
}

describe("renderStep and splitCommand", () => {
  it("renders a step as the flisk command it runs", () => {
    expect(renderStep(step("add the API", ["resource", "api", "--type", "backend"]))).toBe(
      "flisk resource api --type backend",
    );
  });

  it("splits an install command the way a shell would", () => {
    expect(splitCommand('pip install ".[dev]"')).toEqual(["pip", "install", ".[dev]"]);
  });
});

describe("dryRunResult", () => {
  it("prints the steps and reports the plan without writing anything", () => {
    const steps = [
      step("write the project", ["project", "shop"]),
      step("add the API", ["resource", "api", "--type", "backend"], true),
    ];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let result: ReturnType<typeof dryRunResult>;
    let printed: string[];
    try {
      result = dryRunResult(localApp, join(dir, "shop"), steps);
      printed = log.mock.calls.map((call) => String(call[0]));
    } finally {
      log.mockRestore();
    }
    const data = result.data as Record<string, unknown>;
    expect(data.dryRun).toBe(true);
    expect(data.commands).toEqual(["flisk project shop", "flisk resource api --type backend"]);
    expect(data.resources).toEqual([{ name: "api", type: "backend" }]);
    expect(data.nextSteps).toEqual([]);
    expect(printed.join("\n")).toContain("flisk project shop");
  });
});

describe("runPlanSteps", () => {
  it("runs each step with this CLI and reports them done", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      runPlanSteps(
        [process.execPath, exitScript()],
        [step("first", ["0"]), step("second", ["0"], true)],
        dir,
        true,
      );
      expect(log.mock.calls.map((call) => String(call[0]))).toEqual(["done", "done"]);
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
  });

  it("a failed step aborts with the recovery message for the half-written project", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const run = () =>
        runPlanSteps(
          [process.execPath, exitScript()],
          [step("first", ["0"]), step("second", ["7"]), step("third", ["0"])],
          dir,
          true,
        );
      expect(run).toThrowError(FliskError);
      expect(run).toThrowError(/did not finish/);
      try {
        run();
      } catch (error) {
        const suggestions = (error as FliskError).suggestions.join("\n");
        expect(suggestions).toContain("done: first");
        expect(suggestions).toContain("not run: third");
      }
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
  });
});

describe("writeProjectReadme", () => {
  it("writes the run commands and never replaces an existing README", () => {
    writeProjectReadme(dir, localApp, []);
    const readme = join(dir, "README.md");
    const contents = readFileSync(readme, "utf8");
    expect(contents).toContain("# shop");
    expect(contents).toContain("does not need Docker");
    expect(contents).toContain("flisk status");

    writeFileSync(readme, "handwritten\n");
    expect(() => writeProjectReadme(dir, localApp, [])).not.toThrow();
    expect(readFileSync(readme, "utf8")).toBe("handwritten\n");
  });
});

describe("resolveStartIntent", () => {
  it("a --start request never asks", async () => {
    expect(await resolveStartIntent(localApp, true, true)).toBe(true);
    expect(prompts.arrowSelect).not.toHaveBeenCalled();
  });

  it("asks the local route, and Escape or a no both mean not now", async () => {
    prompts.arrowSelect.mockResolvedValueOnce("yes");
    expect(await resolveStartIntent(localApp, true, false)).toBe(true);
    prompts.arrowSelect.mockResolvedValueOnce("no");
    expect(await resolveStartIntent(localApp, true, false)).toBe(false);
    prompts.arrowSelect.mockRejectedValueOnce(new PromptCancelled());
    expect(await resolveStartIntent(localApp, true, false)).toBe(false);
  });

  it("never asks without a terminal or for a starter", async () => {
    expect(await resolveStartIntent(localApp, false, false)).toBe(false);
    const starter: CreateAnswers = { name: "shop", runtime: "local", starter: "saas", extras: [] };
    expect(await resolveStartIntent(starter, true, false)).toBe(false);
    expect(prompts.arrowSelect).not.toHaveBeenCalled();
  });
});

describe("installServices", () => {
  it("runs each local service's own install command where the service lives", async () => {
    mkdirSync(join(dir, "web"), { recursive: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await installServices(dir, localApp, [
        { dir: "web", install: `${process.execPath} --version`, run: "npm run dev" },
      ]);
      expect(log.mock.calls.map((call) => String(call[0]))).toEqual(["done"]);
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
  });

  it("a failed local install says the project is fine and only the install needs a retry", async () => {
    mkdirSync(join(dir, "web"), { recursive: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const install = installServices(dir, localApp, [
        { dir: "web", install: `${process.execPath} --eval "process.exit(3)"`, run: "npm run dev" },
      ]);
      await expect(install).rejects.toThrowError(/did not finish in web/);
      await expect(install).rejects.toThrowError(FliskError);
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
  });

  it("the Docker route installs through the shared installer and reports the failures", async () => {
    const dockerApp: CreateAnswers = { ...localApp, runtime: "docker" };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      oneCommand.installServiceDependencies.mockResolvedValueOnce([
        { ok: true, dir: "web" },
        { ok: true, dir: "api" },
      ]);
      await expect(installServices(dir, dockerApp, [])).resolves.toBeUndefined();
      expect(oneCommand.installServiceDependencies).toHaveBeenCalledWith(dir);

      oneCommand.installServiceDependencies.mockResolvedValueOnce([
        { ok: false, dir: "web" },
        { ok: true, dir: "api" },
      ]);
      await expect(installServices(dir, dockerApp, [])).rejects.toThrowError(
        /1 of 2 services could not install/,
      );
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
  });
});

describe("startProject", () => {
  it("a failed flisk up keeps the project and points at flisk doctor", () => {
    writeFileSync(join(dir, "exit9.mjs"), "process.exit(9)\n");
    expect(() =>
      startProject([process.execPath, join(dir, "exit9.mjs")], dir, localApp, []),
    ).toThrowError(/flisk up" did not finish/);
  });
});
