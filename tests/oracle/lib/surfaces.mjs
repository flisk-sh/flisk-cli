// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Scaffolds a scenario with the real CLI and reads every surface ORACLE compares. Nothing here needs Docker or Tilt: status,
// doctor, config verify and export compose all run on the files alone (the doctor checks that need Docker are never compared).
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./scenario.mjs";

// git is looked up on PATH like every developer tool here; a variable keeps one place to pin it (ORACLE_GIT).
const GIT = process.env.ORACLE_GIT ?? "git";
const FLISK = process.env.ORACLE_FLISK ?? path.join(ROOT, "cli", "bin", "flisk.js");

export function runFlisk(cwd, args) {
  const r = spawnSync(process.execPath, [FLISK, ...args], {
    cwd, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, FLISK_QUIET_DEPRECATIONS: "1", NO_COLOR: "1", CI: "1" },
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// The JSON envelope of a --json run. Some commands pretty-print it, so take the whole trimmed stdout, else the last column-0 "{".
export function parseEnvelope(stdout) {
  const text = stdout.trim();
  for (const candidate of [text, text.slice(text.lastIndexOf("\n{") + 1)]) {
    try { return JSON.parse(candidate); } catch { /* try the next */ }
  }
  throw new Error(`no JSON envelope in output: ${text.slice(0, 200)}`);
}

export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

function must(label, r) {
  if (r.code !== 0) throw new Error(`${label} exited ${r.code}: ${(r.stderr || r.stdout).slice(0, 400)}`);
  return r;
}

export function scaffold(scenario, dir) {
  mkdirSync(dir, { recursive: true });
  spawnSync(GIT, ["init", "-q", "."], { cwd: dir });
  must("flisk project", runFlisk(dir, ["project", "--yes", "--json"]));
  for (const res of scenario.resources) {
    const args = ["resource", res.name, "--type", res.kind, "--stack", res.stack, "--json", ...res.args];
    if (res.kind === "bring-your-own") args.push("--dockerfile", "Dockerfile");
    if (res.kind === "sdk") {
      const pkg = `packages/${res.name}`;
      mkdirSync(path.join(dir, pkg), { recursive: true });
      writeFileSync(path.join(dir, pkg, "service.json"), JSON.stringify({ appName: res.name, appType: "sdk" }));
      writeFileSync(path.join(dir, pkg, "package.json"), JSON.stringify({ name: res.name, version: "0.0.0", type: "module", scripts: { dev: "true", build: "true" } }));
      args.push("--path", pkg);
    }
    const out = parseEnvelope(must(`flisk resource ${res.name}`, runFlisk(dir, args)).stdout);
    if (res.byo) {
      const file = path.join(dir, out.data.path, "service.json");
      const json = JSON.parse(readFileSync(file, "utf8"));
      if (res.byo.exposeViaProxy === false) json.exposeViaProxy = false;
      if (res.byo.dependsOn.length > 0) json.dependsOn = res.byo.dependsOn;
      writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    }
  }
  // Services that depend on each other are wired by editing service.json, as a developer does.
  for (const res of scenario.resources.filter((r) => r.dependsOn?.length)) {
    const file = path.join(dir, "services", res.stack, res.name, "service.json");
    const json = JSON.parse(readFileSync(file, "utf8"));
    json.dependsOn = res.dependsOn;
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  }
  let stale = null;
  for (const [name, on] of Object.entries(scenario.infra ?? {})) {
    must(`flisk config ${on ? "enable" : "disable"}-infra ${name}`, runFlisk(dir, ["config", on ? "enable-infra" : "disable-infra", name, "--json"]));
  }
  if (scenario.infra) stale = readOnly(dir, ["config", "verify", "--json"]); // before regenerate: verify must notice the change
  // service.json is the source of the generated project files; a flisk up regenerates them, so the scenario does too.
  must("flisk config regenerate", runFlisk(dir, ["config", "regenerate"]));
  return { staleVerify: stale, stacks: scenario.shape === "multi-stack" ? [...new Set(scenario.resources.map((r) => r.stack))] : [] };
}

function readOnly(dir, args) {
  const r = runFlisk(dir, args);
  try { return { code: r.code, json: parseEnvelope(r.stdout) }; } catch (e) { return { code: r.code, error: String(e.message) }; }
}

// Every surface for one scaffolded project. A command that fails is recorded, not thrown: a crash is itself a finding.
// `flisk up --dry-run <stack>` for each stack the scenario used (it starts nothing).
function upByStack(dir, stacks) {
  return Object.fromEntries(stacks.map((st) => [st, readOnly(dir, ["up", "--dry-run", st, "--json"])]));
}

// What `flisk config explain` says about one file: "generated" (Flisk rewrites it, nobody edits it) or "user-owned". It is the
// CLI's own answer to "who owns this path", so it decides which files `config verify` must care about, instead of a list here.
export function ownershipOf(dir, rel) {
  const r = readOnly(dir, ["config", "explain", rel, "--json"]);
  return r.json?.data?.ownership ?? null;
}

// A project is a git repo from scaffold on, so this is what a contributor would push.
// `all` also lists what .gitignore hides (shared-platform-engineering/ and .tiltignore are ignored), `tracked` only what a push carries.
export function gitFiles(dir) {
  spawnSync(GIT, ["add", "-A"], { cwd: dir });
  const list = (args) => {
    const r = spawnSync(GIT, ["ls-files", ...args], { cwd: dir, encoding: "utf8" });
    return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : null;
  };
  return { tracked: list([]), all: list(["--cached", "--others"]) };
}

// Delete each file `config explain` calls generated (outside .flisk/, which verify compares by content) in turn, run
// `config verify`, put the file back. Reads like a clone that lost a file Flisk rewrites on regenerate.
function probeOwnedFiles(dir, files) {
  // A symlink (.claude/skills points at the one shared copy of the agent skills) is not a file `config explain` can answer for,
  // and deleting it would hide the real files behind it, so it is not probed.
  const isSymlink = (rel) => { try { return lstatSync(path.join(dir, rel)).isSymbolicLink(); } catch { return false; } };
  return files.filter((f) => !f.startsWith(".flisk/") && !isSymlink(f)).flatMap((rel) => {
    const owner = ownershipOf(dir, rel);
    if (owner === null) return [{ path: rel, verifyValid: null, error: "config explain returned no ownership" }];
    if (owner !== "generated") return [];
    const abs = path.join(dir, rel);
    const body = readFileSync(abs);
    rmSync(abs);
    const r = readOnly(dir, ["config", "verify", "--json"]);
    writeFileSync(abs, body);
    return [{ path: rel, verifyValid: r.json?.data?.valid ?? null, error: r.error }];
  });
}

// Package names: the root one and every service's, so the scope rule can be checked.
function packageNames(dir) {
  const read = (file) => { try { return JSON.parse(readFileSync(path.join(dir, file), "utf8")).name ?? null; } catch { return null; } };
  const services = [];
  const top = path.join(dir, "services");
  if (existsSync(top)) {
    for (const stack of readdirSync(top, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      for (const svc of readdirSync(path.join(top, stack.name), { withFileTypes: true }).filter((e) => e.isDirectory())) {
        const rel = `services/${stack.name}/${svc.name}/package.json`;
        const name = read(rel);
        if (name) services.push({ path: rel, name });
      }
    }
  }
  return { root: read("package.json"), services };
}

export function collectSurfaces(dir, extra = {}) {
  const read = (args) => readOnly(dir, args);
  const text = (file) => { try { return readFileSync(path.join(dir, file), "utf8"); } catch { return null; } };
  const compose = runFlisk(dir, ["export", "compose", "--dry-run"]);
  const files = gitFiles(dir);
  return {
    verify: read(["config", "verify", "--json"]),
    status: read(["status", "--json"]),
    doctor: read(["doctor", "--json", "--no-ping"]),
    stacks: read(["stacks", "--json"]),
    up: read(["up", "--dry-run", "--json"]),
    resources: read(["resources", "--json"]),
    upByStack: upByStack(dir, extra.stacks ?? []),
    render: runFlisk(dir, ["export", "render", "--dry-run"]),
    projectJson: JSON.parse(text(".flisk/project.json") ?? "{}"),
    specMaster: text(".flisk/.flisk-out/spec.master"),
    staleVerify: extra.staleVerify ?? null,
    compose: { code: compose.code, text: compose.stdout },
    env: parseEnv(readFileSync(path.join(dir, ".env"), "utf8")),
    packages: packageNames(dir),
    committable: files.tracked,
    ownedFiles: probeOwnedFiles(dir, files.all ?? []),
  };
}

// The folder is not called "project": a package scope that is a hard-coded word would otherwise match the folder name by chance.
export function makeProjectDir(seed) {
  return path.join(mkdtempSync(path.join(os.tmpdir(), `oracle-${seed}-`)), "oracle-app");
}
