import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTempProject, parseEnvelope, runFlisk } from "../../test-support/index.js";

const baseProjectJson = () => ({
  version: "1.0",
  project: { name: "repos", version: "1.0.0" },
  phases: Object.fromEntries(
    ["pre_alpha", "alpha", "beta", "out_of_scope"].map((name) => [
      name,
      { name, description: "", enabledStacks: [] },
    ]),
  ),
  optional_infra: {
    monitoring: false,
    elk: false,
    debezium: false,
    golden_image: false,
    verdaccio: false,
  },
  discovery: { paths: ["services"] },
});

const writeRepos = (root: string, repos: { url: string; dir: string }[]): void => {
  const configPath = join(root, ".flisk", "project.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.repos = repos;
  writeFileSync(configPath, JSON.stringify(config));
};

it("lists cloned and missing repositories without cloning", () => {
  const root = createTempProject({ projectJson: baseProjectJson() });
  writeRepos(root, [
    { url: "https://example.com/team/app.git", dir: "services/app" },
    { url: "https://example.com/team/missing.git", dir: "services/missing" },
  ]);
  mkdirSync(join(root, "services", "app", ".git"), { recursive: true });
  const result = runFlisk(["repos", "list", "--json"], { cwd: root });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(parseEnvelope(result.stdout).data.repos).toEqual([
    {
      name: "app",
      url: "https://example.com/team/app.git",
      path: "services/app",
      cloned: true,
      state: "cloned",
    },
    {
      name: "missing",
      url: "https://example.com/team/missing.git",
      path: "services/missing",
      cloned: false,
      state: "missing",
    },
  ]);
});

it("prints the clone empty-state message and no table header when nothing is configured", () => {
  const root = createTempProject({ projectJson: baseProjectJson() });
  const result = runFlisk(["repos", "list"], { cwd: root });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe("No external repositories configured in .flisk/project.json.");
  expect(result.stdout).not.toContain("Name");
});

it("shows the redacted URL and a clone-aligned state for each destination", () => {
  const root = createTempProject({ projectJson: baseProjectJson() });
  writeRepos(root, [
    { url: "https://user:secret@example.com/team/app.git", dir: "services/app" },
    { url: "https://example.com/team/plain.git", dir: "services/plain" },
    { url: "https://example.com/team/missing.git", dir: "services/missing" },
  ]);
  mkdirSync(join(root, "services", "app", ".git"), { recursive: true });
  mkdirSync(join(root, "services", "plain"), { recursive: true });

  const result = runFlisk(["repos", "list"], { cwd: root });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout.trim().split("\n")).toEqual([
    "Name\tURL\tPath\tCloned",
    "app\thttps://***@example.com/team/app.git\tservices/app\tyes",
    "plain\thttps://example.com/team/plain.git\tservices/plain\tnot a git repository (clone will skip it)",
    "missing\thttps://example.com/team/missing.git\tservices/missing\tno",
  ]);
  expect(result.stdout).not.toContain("secret");
});

it("marks a folder without .git as not a git repo in --json", () => {
  const root = createTempProject({ projectJson: baseProjectJson() });
  writeRepos(root, [{ url: "https://example.com/team/plain.git", dir: "services/plain" }]);
  mkdirSync(join(root, "services", "plain"), { recursive: true });

  const result = runFlisk(["repos", "list", "--json"], { cwd: root });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(parseEnvelope(result.stdout).data.repos).toEqual([
    {
      name: "plain",
      url: "https://example.com/team/plain.git",
      path: "services/plain",
      cloned: false,
      state: "not a git repo",
    },
  ]);
});
