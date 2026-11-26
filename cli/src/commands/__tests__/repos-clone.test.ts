// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTempDir,
  createTempProject,
  parseEnvelope,
  runFlisk,
  validProjectJson,
} from "../../test-support/index.js";

const PROJECT_JSON = validProjectJson({ name: "repos", discoveryPaths: ["services"] });

/** A real local bare repository with one commit, so `git clone` works without network. */
function createOriginRepo(): { root: string; url: string } {
  const root = createTempDir("flisk-origin-");
  const bare = join(root, "origin.git");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", bare]);
  const work = join(root, "work");
  execFileSync("git", ["clone", bare, work]);
  execFileSync("git", ["-C", work, "config", "user.name", "Test User"]);
  execFileSync("git", ["-C", work, "config", "user.email", "test@example.com"]);
  writeFileSync(join(work, "service.json"), JSON.stringify({ appName: "billing" }));
  execFileSync("git", ["-C", work, "add", "service.json"]);
  execFileSync("git", ["-C", work, "commit", "-m", "init billing"]);
  execFileSync("git", ["-C", work, "push", "origin", "HEAD:main"]);
  return { root, url: bare };
}

/** A project with `repos` configured: the first entry never resolves, the second is real. */
function projectWithRepos(repos: Array<{ url: string; dir: string }>): string {
  const root = createTempProject({ projectJson: PROJECT_JSON });
  const configPath = join(root, ".flisk", "project.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.repos = repos;
  writeFileSync(configPath, JSON.stringify(config));
  return root;
}

describe("flisk repos clone", () => {
  it("clones the repositories that work, reports each outcome and exits non-zero", () => {
    const origin = createOriginRepo();
    const missingUrl = join(origin.root, "does-not-exist.git");
    const root = projectWithRepos([
      { url: missingUrl, dir: "services/orders" },
      { url: origin.url, dir: "services/billing" },
    ]);

    const result = runFlisk(["repos", "clone", "--json"], { cwd: root });

    expect(result.status, result.stdout + result.stderr).toBe(1);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.data.results).toHaveLength(2);
    expect(envelope.data.results[0]).toMatchObject({
      url: missingUrl,
      dir: "services/orders",
      status: "failed",
    });
    expect(envelope.data.results[0].reason).toContain("Failed to clone");
    expect(envelope.data.results[1]).toMatchObject({
      url: origin.url,
      dir: "services/billing",
      status: "cloned",
    });
    expect(envelope.data.cloned).toEqual([{ url: origin.url, dir: "services/billing" }]);
    expect(envelope.errors).toHaveLength(1);
    expect(envelope.errors[0]?.code).toBe("REPO_CLONE_FAILED");
    // The second repository was really cloned even though the first failed.
    expect(existsSync(join(root, "services", "billing", "service.json"))).toBe(true);
    expect(existsSync(join(root, "services", "orders"))).toBe(false);
  });

  it("prints each outcome and a one-line summary in human output", () => {
    const origin = createOriginRepo();
    const root = projectWithRepos([
      { url: join(origin.root, "does-not-exist.git"), dir: "services/orders" },
      { url: origin.url, dir: "services/billing" },
    ]);

    const result = runFlisk(["repos", "clone"], { cwd: root });

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("Failed to clone");
    expect(result.stdout).toContain("services/orders");
    expect(result.stdout).toContain("Cloned");
    expect(result.stdout).toContain("1 cloned, 1 failed");
  });

  it("reports every repository as cloned or skipped when nothing fails", () => {
    const origin = createOriginRepo();
    const root = projectWithRepos([{ url: origin.url, dir: "services/billing" }]);

    const result = runFlisk(["repos", "clone", "--json"], { cwd: root });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.data.results).toEqual([
      { url: origin.url, dir: "services/billing", status: "cloned" },
    ]);
    expect(envelope.errors).toEqual([]);

    const second = runFlisk(["repos", "clone", "--json"], { cwd: root });
    expect(second.status, second.stdout + second.stderr).toBe(0);
    const secondEnvelope = parseEnvelope(second.stdout);
    expect(secondEnvelope.data.results).toEqual([
      {
        url: origin.url,
        dir: "services/billing",
        status: "skipped",
        reason: "destination directory already exists",
      },
    ]);
  });
});
