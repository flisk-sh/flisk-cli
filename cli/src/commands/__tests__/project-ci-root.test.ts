// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CI_WORKFLOW } from "../../utils/agent-skills.js";
import { runFlisk } from "./project-e2e-helpers.js";

describe("project CI belongs at the Git root", () => {
  const roots: string[] = [];
  function directory(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "flisk-ci-root-")));
    roots.push(root);
    return root;
  }
  function git(root: string, args: string[]): void {
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  }
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("skips a dead nested workflow and explains where CI belongs", () => {
    const root = directory();
    git(root, ["init", "-q"]);
    const nested = join(root, "apps", "shop");
    mkdirSync(nested, { recursive: true });
    const output = runFlisk(["project", "--yes"], nested);
    expect(existsSync(join(nested, CI_WORKFLOW))).toBe(false);
    expect(existsSync(join(root, ".github"))).toBe(false);
    expect(output).toContain("CI workflow skipped");
    expect(output).toContain("working-directory");
    expect(existsSync(join(nested, "AGENTS.md"))).toBe(true);
  });

  it.each([true, false])("keeps CI for a root project (git=%s)", (withGit) => {
    const root = directory();
    if (withGit) git(root, ["init", "-q"]);
    const output = runFlisk(["project", "--yes"], root);
    expect(existsSync(join(root, CI_WORKFLOW))).toBe(true);
    expect(output).not.toContain("CI workflow skipped");
  });

  it("reports the omission in JSON without replacing an existing nested workflow", () => {
    const root = directory();
    git(root, ["init", "-q"]);
    const nested = join(root, "apps", "shop");
    mkdirSync(join(nested, ".github", "workflows"), { recursive: true });
    writeFileSync(join(nested, CI_WORKFLOW), "# user-owned workflow\n");
    const result = JSON.parse(runFlisk(["project", "--yes", "--json"], nested));
    expect(result.errors).toEqual([]);
    expect(result.data.warnings).toEqual([expect.stringContaining("CI workflow skipped")]);
    expect(result.data.agentSkills).not.toContain(CI_WORKFLOW);
    expect(readFileSync(join(nested, CI_WORKFLOW), "utf-8")).toBe("# user-owned workflow\n");
    expect(existsSync(join(root, ".github"))).toBe(false);
  });

  it("recognizes linked worktrees as separate Git roots", () => {
    const root = directory();
    const repo = join(root, "repo");
    mkdirSync(repo);
    git(repo, ["init", "-q"]);
    git(repo, [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "--no-gpg-sign",
      "-qm",
      "fixture",
    ]);
    const worktree = join(root, "linked");
    git(repo, ["worktree", "add", "--detach", worktree, "HEAD"]);
    runFlisk(["project", "--yes"], worktree);
    expect(existsSync(join(worktree, CI_WORKFLOW))).toBe(true);
    const nested = join(worktree, "apps", "shop");
    mkdirSync(nested, { recursive: true });
    const output = runFlisk(["project", "--path", nested, "--yes"], worktree);
    expect(existsSync(join(nested, CI_WORKFLOW))).toBe(false);
    expect(output).toContain("CI workflow skipped");
  });
});
