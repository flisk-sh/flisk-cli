import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

// Exercise the parked workflow too: do not wait for it to be re-enabled to protect credentials.
const workflow = parse(readFileSync(new URL(
  "../.github/workflows-disabled/nightly-adopters.yml", import.meta.url,
), "utf8"));
const job = workflow.jobs.adopter;
const prepare = job.steps.find((step) => step.name === "Prepare Synthetic Environment");

function render(content) {
  const cwd = mkdtempSync(join(tmpdir(), "flisk-adopter-env-"));
  try {
    const env = { ...process.env, ENV_CONTENT: content };
    delete env.CI_TEST_PASSWORD;
    const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", prepare.run], {
      cwd, env, encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(cwd, "must-not-run")), false, "template content is never evaluated");
    const output = existsSync(join(cwd, ".env")) ? readFileSync(join(cwd, ".env"), "utf8") : null;
    assert.equal(result.stdout, "", "do not print generated credentials");
    return output;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("adopter execution does not receive a reusable repository password", () => {
  assert.doesNotMatch(JSON.stringify(job), /secrets\.CI_TEST_PASSWORD/);
  assert.deepEqual(prepare.env, { ENV_CONTENT: "${{ matrix.env_file }}" });
  assert.equal(prepare.if, "matrix.needs_env");
  assert.equal(prepare["working-directory"], "adopter");
});

test("synthetic credentials support repeated, short, URL and JSON placeholders without secrets", () => {
  const output = render([
    "PASSWORD=@@CI_TEST_PASSWORD@@",
    "REPEAT=@@CI_TEST_PASSWORD@@",
    "SHORT=@@CI_TEST_PASSWORD_16@@",
    "URL=postgres://user:@@CI_TEST_PASSWORD@@@db:5432/app",
    'JSON={"password":"@@CI_TEST_PASSWORD@@"}',
    "LITERAL=$(touch must-not-run); & $HOME",
  ].join("\n"));
  const lines = Object.fromEntries(output.trimEnd().split("\n").map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  assert.match(lines.PASSWORD, /^[A-Za-z0-9]{16,}$/);
  assert.equal(lines.REPEAT, lines.PASSWORD);
  assert.equal(lines.SHORT, lines.PASSWORD.slice(0, 16));
  assert.equal(lines.SHORT.length, 16);
  assert.equal(new URL(lines.URL).password, lines.PASSWORD);
  assert.equal(JSON.parse(lines.JSON).password, lines.PASSWORD);
  assert.equal(lines.LITERAL, "$(touch must-not-run); & $HOME");
  assert.doesNotMatch(output, /@@CI_TEST_PASSWORD/);
  assert.notEqual(render("PASSWORD=@@CI_TEST_PASSWORD@@"), `PASSWORD=${lines.PASSWORD}\n`);
});

for (const entry of job.strategy.matrix.include.filter((entry) => entry.needs_env)) {
  test(`${entry.name}: prepare the actual matrix environment without a repository secret`, () => {
    const output = render(entry.env_file);
    assert.doesNotMatch(output, /@@CI_TEST_PASSWORD/);
    // Apart from password substitutions, preserve the fixture verbatim.
    const pattern = entry.env_file.split(/@@CI_TEST_PASSWORD(?:_16)?@@/g)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[A-Za-z0-9]{16,}");
    assert.match(output, new RegExp(`^${pattern}\\n?$`));
  });
}

test("an empty template does not write an environment file", () => {
  assert.equal(render(""), null);
});
