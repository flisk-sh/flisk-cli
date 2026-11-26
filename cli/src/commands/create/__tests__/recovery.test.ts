// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateAnswers, CreateStep } from "../../../utils/create-plan.js";
import {
  firstPort,
  generatedServices,
  localInstallHint,
  nextSteps,
  recoveryMessage,
  whereToOpen,
} from "../recovery.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flisk-create-recovery-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const steps: CreateStep[] = [
  { label: "write the project", args: ["project", "shop"], inProject: false },
  { label: "add the website", args: ["resource", "web", "--type", "frontend"], inProject: true },
  { label: "add the API", args: ["resource", "api", "--type", "backend"], inProject: true },
];

describe("recoveryMessage", () => {
  it("names the failed step, what finished and what did not run", () => {
    const lines = recoveryMessage("/tmp/shop", steps, 1);
    expect(lines[0]).toBe(
      'The project in /tmp/shop is incomplete: "add the website" did not finish.',
    );
    expect(lines).toContain("  done: write the project");
    expect(lines).toContain("  not run: add the API");
    expect(lines).toContain('Project folder (absolute path): "/tmp/shop"');
  });

  it("says who made the folder: create when it did, the person when it was already there", () => {
    expect(recoveryMessage("/tmp/shop", steps, 0, true).at(-1)).toContain(
      "flisk create made this folder just now",
    );
    expect(recoveryMessage("/tmp/shop", steps, 0, false).at(-1)).toContain(
      "This folder was already there (empty) before flisk create",
    );
  });
});

describe("generatedServices", () => {
  const answers: CreateAnswers = { name: "shop", runtime: "local", extras: [] };

  it("reads install, run and port back from the files a generator wrote", () => {
    mkdirSync(join(dir, "web"), { recursive: true });
    writeFileSync(join(dir, "web", "service.json"), JSON.stringify({ port: 4173 }));
    writeFileSync(join(dir, "web", "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
    expect(generatedServices(dir, answers)).toEqual([
      { dir: "web", install: "npm install", run: "npm run dev", port: 4173 },
    ]);
  });

  it("takes the install and run lines from the package manager written into service.json (#3609)", () => {
    mkdirSync(join(dir, "api"), { recursive: true });
    writeFileSync(
      join(dir, "api", "service.json"),
      JSON.stringify({ port: 4000, command: "bun run dev" }),
    );
    writeFileSync(
      join(dir, "api", "package.json"),
      JSON.stringify({ scripts: { dev: "bun run --watch src/index.ts" } }),
    );
    mkdirSync(join(dir, "web"), { recursive: true });
    writeFileSync(
      join(dir, "web", "service.json"),
      JSON.stringify({ port: 4173, command: "pnpm run dev" }),
    );
    writeFileSync(join(dir, "web", "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
    expect(generatedServices(dir, answers)).toEqual([
      { dir: "web", install: "pnpm install", run: "pnpm run dev", port: 4173 },
      { dir: "api", install: "bun install", run: "bun run dev", port: 4000 },
    ]);
  });

  it("reports nothing for a project without local services", () => {
    expect(generatedServices(dir, answers)).toEqual([]);
  });
});

describe("firstPort", () => {
  it("finds the grouped starter layout services/<group>/<name>", () => {
    mkdirSync(join(dir, "services", "stack", "web"), { recursive: true });
    writeFileSync(join(dir, "services", "stack", "web", "service.json"), '{"port": 8080}');
    expect(firstPort(dir)).toBe(8080);
  });

  it("is undefined when nothing declares a port or the folder cannot be read", () => {
    expect(firstPort(dir)).toBeUndefined();
    expect(firstPort(join(dir, "missing"))).toBeUndefined();
  });
});

describe("nextSteps", () => {
  it("a Docker project is started with flisk up <default-stack> naming the existing stack", () => {
    const answers: CreateAnswers = { name: "shop", runtime: "docker", extras: [] };
    const steps = nextSteps(dir, answers);
    expect(steps).toEqual(["cd shop", "flisk up main"]);
    // Hints must name the canonical configured stack, not a hardcoded "app"
    expect(steps[1]).toBe("flisk up main");
  });

  it("a local app lists the installs, then flisk up, then where to open", () => {
    const answers: CreateAnswers = { name: "shop", runtime: "local", extras: [] };
    const services = [{ dir: "web", install: "npm install", run: "npm run dev", port: 4173 }];
    expect(nextSteps(dir, answers, services)).toEqual([
      "cd shop",
      "(cd web && npm install)",
      "flisk up        # starts it",
      "Then open http://localhost:4173 in your browser.",
    ]);
  });
});

describe("whereToOpen and localInstallHint", () => {
  it("points at the API health check when there is no website", () => {
    expect(whereToOpen([{ dir: "api", run: "npm run dev", port: 4000 }])).toBe(
      "Then check it works: http://localhost:4000/health",
    );
  });

  it("drops the Docker-only note from an install hint", () => {
    expect(localInstallHint("pip install .[dev] # optional: Docker builds the image")).toBe(
      "pip install .[dev]",
    );
  });
});
