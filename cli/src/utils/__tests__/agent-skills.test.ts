// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error the hook is plain JavaScript shipped as a template
import { generatedSource } from "../../../templates/agent-hooks/flisk-generated-guard.mjs";
import {
  AGENT_SKILL_DIRS,
  claudeGuardHookIsOrphaned,
  claudeGuardHookNeedsWiring,
  GENERATED_GUARD_HOOK,
  installAgentSkills,
  PROJECT_AGENT_SKILLS,
  PROJECT_AGENTS_MD,
  PROJECT_CLAUDE_SETTINGS,
  rewriteSkillLinks,
} from "../agent-skills.js";
import { isFliskGeneratedPath } from "../generated-paths.js";

const repoRoot = resolve(__dirname, "../../../..");
const templatesDir = join(repoRoot, "cli", "templates", "agent-skills");

/** True when this machine lets us create directory symlinks (Windows without developer mode does not). */
function canCreateSymlinks(): boolean {
  const probeDir = mkdtempSync(join(tmpdir(), "flisk-symlink-probe-"));
  try {
    symlinkSync(probeDir, join(probeDir, "link"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

describe("agent skills shipped to new projects", () => {
  let root = "";
  afterEach(() => {
    if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
  });

  it("ships exactly the listed skills, each identical to .claude/skills", () => {
    expect(readdirSync(templatesDir).sort()).toEqual([...PROJECT_AGENT_SKILLS].sort());
    for (const name of PROJECT_AGENT_SKILLS) {
      const shipped = readFileSync(join(templatesDir, name, "SKILL.md"), "utf-8");
      const source = readFileSync(join(repoRoot, ".claude", "skills", name, "SKILL.md"), "utf-8");
      // When this fails, copy .claude/skills/<name>/SKILL.md to cli/templates/agent-skills/<name>/.
      expect(shipped, name).toBe(source);
    }
  });

  it("points repository-relative docs links at GitHub", () => {
    expect(
      rewriteSkillLinks("see [jobs](../../../docs/byo.md#one-shot) and [x](https://a.b/c)"),
    ).toBe(
      "see [jobs](https://github.com/flisk-sh/flisk/blob/main/docs/byo.md#one-shot) and [x](https://a.b/c)",
    );
  });

  it("writes every skill for Claude Code and other agents, plus AGENTS.md", () => {
    root = mkdtempSync(join(tmpdir(), "flisk-agent-skills-"));
    const written = installAgentSkills(root);
    // The skills are written once; .claude/skills is a link to them (or a full copy where links fail).
    const claudeSkillsIsLink = canCreateSymlinks();
    expect(lstatSync(join(root, ".claude", "skills")).isSymbolicLink()).toBe(claudeSkillsIsLink);
    const skillEntries = claudeSkillsIsLink
      ? PROJECT_AGENT_SKILLS.length + 1
      : PROJECT_AGENT_SKILLS.length * AGENT_SKILL_DIRS.length;
    expect(written).toHaveLength(skillEntries + 5);
    for (const dir of AGENT_SKILL_DIRS) {
      for (const name of PROJECT_AGENT_SKILLS) {
        const file = readFileSync(join(root, dir, name, "SKILL.md"), "utf-8");
        expect(file).toContain(`name: ${name}`);
        expect(file).not.toContain("](../");
      }
    }
    expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe(PROJECT_AGENTS_MD);
    expect(readFileSync(join(root, ".claude", "settings.json"), "utf-8")).toBe(
      PROJECT_CLAUDE_SETTINGS,
    );
    expect(existsSync(join(root, GENERATED_GUARD_HOOK))).toBe(true);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf-8")).toBe("@AGENTS.md\n");
    const ci = readFileSync(join(root, ".github", "workflows", "flisk.yml"), "utf-8");
    expect(ci).toContain("config verify --json");
    expect(ci).toContain("PRIVATE KEY");
  });

  it("keeps one copy of the skills: .claude/skills links to .agents/skills (#5386)", () => {
    // Skip only where this machine cannot create links at all; the copy tests below cover that case.
    if (!canCreateSymlinks()) return;
    root = mkdtempSync(join(tmpdir(), "flisk-agent-skills-"));
    installAgentSkills(root);
    const claudeSkills = join(root, ".claude", "skills");
    expect(lstatSync(claudeSkills).isSymbolicLink()).toBe(true);

    expect(readlinkSync(claudeSkills)).toBe(join("..", ".agents", "skills"));
    expect(readdirSync(claudeSkills).sort()).toEqual([...PROJECT_AGENT_SKILLS].sort());
    // Editing a skill through one path changes it for the other agent too.
    writeFileSync(join(root, ".agents", "skills", "flisk-up", "SKILL.md"), "edited\n");
    expect(readFileSync(join(claudeSkills, "flisk-up", "SKILL.md"), "utf-8")).toBe("edited\n");
  });

  it("copies instead of linking when .claude is a link to another folder (#5386)", () => {
    root = mkdtempSync(join(tmpdir(), "flisk-agent-skills-"));
    const elsewhere = mkdtempSync(join(tmpdir(), "flisk-agent-skills-config-"));
    try {
      try {
        symlinkSync(elsewhere, join(root, ".claude"), "dir");
      } catch {
        return; // No symlink support on this filesystem.
      }

      installAgentSkills(root);

      // A relative link made inside the redirected folder would resolve from there and miss .agents/skills.
      const claudeSkills = join(root, ".claude", "skills");
      expect(lstatSync(claudeSkills).isSymbolicLink()).toBe(false);
      for (const name of PROJECT_AGENT_SKILLS) {
        expect(existsSync(join(claudeSkills, name, "SKILL.md")), name).toBe(true);
      }
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("copies the skills into an existing .claude/skills folder instead of replacing it (#5386)", () => {
    root = mkdtempSync(join(tmpdir(), "flisk-agent-skills-"));
    mkdirSync(join(root, ".claude", "skills", "my-own-skill"), { recursive: true });
    writeFileSync(join(root, ".claude", "skills", "my-own-skill", "SKILL.md"), "mine\n");

    installAgentSkills(root);

    const claudeSkills = join(root, ".claude", "skills");
    expect(lstatSync(claudeSkills).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(claudeSkills, "my-own-skill", "SKILL.md"), "utf-8")).toBe("mine\n");
    for (const name of PROJECT_AGENT_SKILLS) {
      expect(existsSync(join(claudeSkills, name, "SKILL.md")), name).toBe(true);
    }
  });

  it("points the start-and-check flow at `flisk status --json`, right for both runtimes (#3889)", () => {
    // `flisk networks` only knows the Docker routes: in a local-process project it prints Traefik URLs that
    // nothing answers on, so an agent following the old line debugged a healthy app. `flisk status --json`
    // reports the address each resource answers on in both runtimes: `url` (the routed URL in a Docker
    // project) or `directUrl` (`http://localhost:<port>` in a local-process one), plus `status` per resource.
    expect(PROJECT_AGENTS_MD).toContain("flisk status --json");
    expect(PROJECT_AGENTS_MD).not.toContain("flisk networks");
    for (const name of PROJECT_AGENT_SKILLS) {
      const skill = readFileSync(join(templatesDir, name, "SKILL.md"), "utf-8");
      let fenced = false;
      for (const line of skill.split("\n")) {
        if (line.startsWith("```")) {
          fenced = !fenced;
          continue;
        }
        // A fenced `flisk networks` line is a step to run; none may send an agent to it for URLs.
        if (fenced) expect(line, `${name}: ${line}`).not.toContain("flisk networks");
        // No "check every URL" step may read the URLs from `flisk networks`.
        if (/check every url/i.test(line)) {
          expect(line, `${name}: ${line}`).not.toContain("flisk networks");
        }
      }
    }
    // The flisk-build check step is the one every "check every URL" pointer delegates to: pin its source.
    const build = readFileSync(join(templatesDir, "flisk-build", "SKILL.md"), "utf-8");
    const checkStep = build.split("\n").find((line) => /check every url/i.test(line));
    expect(checkStep).toContain("flisk status --json");
  });

  it("writes the exact generated AGENTS.md, including the several-agents section", async () => {
    root = mkdtempSync(join(tmpdir(), "flisk-agent-skills-"));
    installAgentSkills(root);
    await expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toMatchFileSnapshot(
      "./__golden__/project-agents-md.golden.txt",
    );
  });

  it("denies reading env files, asks before git push and allows read-only flisk checks (#4052)", () => {
    const settings = JSON.parse(PROJECT_CLAUDE_SETTINGS);
    expect(settings.permissions.deny).toEqual(["Read(**/.env)", "Read(**/.env.*)"]);
    expect(settings.permissions.ask).toEqual(["Bash(git push:*)"]);
    expect(settings.permissions.allow).toEqual(
      expect.arrayContaining(["Bash(flisk status:*)", "mcp__flisk__config_verify"]),
    );
    // A destructive tool is never pre-approved.
    expect(settings.permissions.allow.join(" ")).not.toMatch(/resource_run|\bdown\b|project_eject/);
  });

  it("leaves user-edited settings, CLAUDE.md and workflow alone on a second run (#4052)", () => {
    root = mkdtempSync(join(tmpdir(), "flisk-agent-skills-"));
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, ".github", "workflows", "flisk.yml"), "mine\n");
    writeFileSync(join(root, "CLAUDE.md"), "# mine\n");
    installAgentSkills(root);
    writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
    expect(installAgentSkills(root)).toEqual([]);
    expect(readFileSync(join(root, ".github", "workflows", "flisk.yml"), "utf-8")).toBe("mine\n");
    expect(readFileSync(join(root, "CLAUDE.md"), "utf-8")).toBe("# mine\n");
    expect(readFileSync(join(root, ".claude", "settings.json"), "utf-8")).toBe("{}\n");
  });

  it("does not write an orphan guard hook when existing settings do not wire it (#5425)", () => {
    root = mkdtempSync(join(tmpdir(), "flisk-agent-skills-"));
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.json"), "{}\n");

    const written = installAgentSkills(root);

    expect(claudeGuardHookNeedsWiring(root)).toBe(true);
    expect(written).not.toContain(GENERATED_GUARD_HOOK);
    expect(existsSync(join(root, GENERATED_GUARD_HOOK))).toBe(false);
    expect(readFileSync(join(root, ".claude", "settings.json"), "utf-8")).toBe("{}\n");
  });

  it("writes the hook when existing settings already wire it (#5425)", () => {
    root = mkdtempSync(join(tmpdir(), "flisk-agent-skills-"));
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.json"), PROJECT_CLAUDE_SETTINGS);

    installAgentSkills(root);

    expect(claudeGuardHookNeedsWiring(root)).toBe(false);
    expect(existsSync(join(root, GENERATED_GUARD_HOOK))).toBe(true);
  });

  it("does not count a path mention or a non-editing matcher as wiring (#5425)", () => {
    root = mkdtempSync(join(tmpdir(), "flisk-agent-skills-"));
    mkdirSync(join(root, ".claude"), { recursive: true });
    const wire = (matcher: string, command: string) =>
      writeFileSync(
        join(root, ".claude", "settings.json"),
        JSON.stringify({
          hooks: { PreToolUse: [{ matcher, hooks: [{ type: "command", command }] }] },
        }),
      );

    wire("Edit|Write", `echo "${GENERATED_GUARD_HOOK}"`);
    expect(claudeGuardHookNeedsWiring(root)).toBe(true);
    wire("Bash", `node "$CLAUDE_PROJECT_DIR/${GENERATED_GUARD_HOOK}"`);
    expect(claudeGuardHookNeedsWiring(root)).toBe(true);
    wire("Edit|MultiEdit|Write|NotebookEdit", `node "$CLAUDE_PROJECT_DIR/${GENERATED_GUARD_HOOK}"`);
    expect(claudeGuardHookNeedsWiring(root)).toBe(false);
  });

  it("reports an old hook that no settings file runs as orphaned (#5425)", () => {
    root = mkdtempSync(join(tmpdir(), "flisk-agent-skills-"));
    mkdirSync(join(root, ".claude", "hooks"), { recursive: true });
    writeFileSync(join(root, GENERATED_GUARD_HOOK), "// old hook\n");

    expect(claudeGuardHookIsOrphaned(root)).toBe(true);
    writeFileSync(join(root, ".claude", "settings.json"), PROJECT_CLAUDE_SETTINGS);
    expect(claudeGuardHookIsOrphaned(root)).toBe(false);
  });

  it("never overwrites a file that already exists", () => {
    root = mkdtempSync(join(tmpdir(), "flisk-agent-skills-"));
    mkdirSync(join(root, ".claude", "skills", "flisk-build"), { recursive: true });
    writeFileSync(join(root, ".claude", "skills", "flisk-build", "SKILL.md"), "mine");
    writeFileSync(join(root, "AGENTS.md"), "# my rules\n");

    const written = installAgentSkills(root);

    expect(readFileSync(join(root, ".claude", "skills", "flisk-build", "SKILL.md"), "utf-8")).toBe(
      "mine",
    );
    expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe("# my rules\n");
    expect(written).not.toContain("AGENTS.md");
    expect(written).toContain(".claude/settings.json");
    expect(existsSync(join(root, ".agents", "skills", "flisk-build", "SKILL.md"))).toBe(true);
    expect(installAgentSkills(root)).toEqual([]);
  });
});

describe("generated-file guard hook", () => {
  let root = "";
  afterEach(() => {
    if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
  });

  const samples = [
    "services/api/.autogenerated/Dockerfile",
    ".autogenerated/x",
    ".flisk/.flisk-out/registry.json",
    "Tiltfile",
    "TILT_TECH_STACK.star",
    ".tiltignore",
    "shared-platform-engineering/docker-templates/node/Dockerfile",
    "product_autogenerated_services_list/list.json",
    "product_autogenerated_resource_manifests/a.json",
    "services/platform/database-management/docker-compose.yml",
    "services/api/src/index.ts",
    "services/api/service.json",
    ".flisk/project.json",
    "web/Tiltfile",
    "docs/autogenerated.md",
    "../elsewhere/.autogenerated/x",
  ];

  it("blocks exactly Flisk's generated paths, except package.json which users edit", () => {
    for (const rel of samples) {
      expect(generatedSource(rel) !== null, rel).toBe(isFliskGeneratedPath(rel));
    }
    expect(isFliskGeneratedPath("package.json")).toBe(true);
    expect(generatedSource("package.json")).toBeNull();
    expect(generatedSource("services/api/.autogenerated/Dockerfile")).toBe(
      "services/api/service.json",
    );
  });

  it("runs as a Claude Code hook: exit 2 with the file to change, exit 0 otherwise", () => {
    root = mkdtempSync(join(tmpdir(), "flisk-guard-"));
    installAgentSkills(root);
    const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf-8"));
    expect(settings.hooks.PreToolUse[0].matcher).toContain("Edit");
    const run = (file: string) =>
      spawnSync(process.execPath, [join(root, GENERATED_GUARD_HOOK)], {
        input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file } }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        encoding: "utf-8",
      });
    const blocked = run(join(root, "services", "api", ".autogenerated", "Dockerfile"));
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain("services/api/service.json");
    expect(run(join(root, "services", "api", "src", "index.ts")).status).toBe(0);
    expect(run("Tiltfile").status).toBe(2);
  });
});
