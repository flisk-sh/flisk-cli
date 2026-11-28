// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parse } from "yaml";

import { MARKER, transformBody } from "./ai-spec-buttons.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const url = "https://github.com/flisk-sh/flisk-cli/issues/123";
const formats = [
  ["unchanged", (body) => body, "skip"],
  ["trailing whitespace", (body) => `${body}\n \t\r\n`, "skip"],
  ["CRLF", (body) => body.replaceAll("\n", "\r\n"), "patch"],
  ["extra blank lines", (body) => body.replaceAll("\n\n", "\n\n\n"), "patch"],
  ["wrapped badges", (body) => body.replaceAll("&nbsp;", "&nbsp;\n"), "patch"],
  ["edited author text", (body) => body.replace("Author", "Updated author"), "skip"],
];

describe("spec button reformatting reaches a fixed point (#17)", () => {
  for (const labels of ["bug", "enhancement"]) {
    for (const [name, reformat, expectedAction] of formats) {
      it(`${labels}: ${name} needs at most one rewrite`, () => {
        const initial = transformBody("Author\n\nNotes  \n", "T", url, labels);
        const edited = reformat(initial.body);
        const author = edited.slice(0, edited.indexOf(MARKER));
        const first = transformBody(edited, "T", url, labels);
        assert.equal(first.action, expectedAction);
        assert.ok(first.body.startsWith(author), "preserve every author byte");
        assert.equal(first.body.split(MARKER).length - 1, 1);
        for (let event = 0; event < 3; event++) {
          const next = transformBody(first.body, "T", url, labels);
          assert.equal(next.action, "skip");
          assert.equal(next.body, first.body, "no rewrite on follow-up edited events");
        }
      });
    }
  }
});

// Exercise the workflow's real run block, not a second implementation of its
// cmp/PATCH guard. Only gh is replaced; bash, node, base64, cmp and jq run normally.
const shellAvailable =
  process.platform !== "win32" &&
  ["bash", "jq"].every(
    (command) => spawnSync(command, ["--version"], { timeout: 5000 }).status === 0,
  );

describe("parked spec workflow PATCH guard (#17)", () => {
  for (const [name, reformat, expectedAction] of formats) {
    it(name, { skip: !shellAvailable && "requires POSIX bash and jq" }, () => {
      const dir = mkdtempSync(path.join(tmpdir(), "flisk-spec-idempotence-"));
      try {
        const bodyFile = path.join(dir, "live-body.md");
        const callsFile = path.join(dir, "calls.log");
        const initial = transformBody("Author\n\nNotes  \n", "T", url, "bug");
        writeFileSync(bodyFile, reformat(initial.body));
        writeFileSync(callsFile, "");
        // Fake API stores PATCH bodies verbatim, just like the raw issue body.
        // Any unexpected request fails; this fixture never contacts GitHub.
        writeFileSync(
          path.join(dir, "gh"),
          `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const endpoint = "repos/flisk-sh/flisk-cli/issues/123";
if (JSON.stringify(args) === JSON.stringify(["api", endpoint, "--jq", '(.body // "") | @base64'])) {
  fs.appendFileSync(process.env.CALLS_FILE, "GET\\n");
  console.log(Buffer.from(fs.readFileSync(process.env.LIVE_BODY)).toString("base64"));
} else if (JSON.stringify(args) === JSON.stringify(["api", "--method", "PATCH", endpoint, "--input", "-"])) {
  const payload = JSON.parse(fs.readFileSync(0, "utf8"));
  if (typeof payload.body !== "string") throw new Error("missing body");
  fs.appendFileSync(process.env.CALLS_FILE, "PATCH\\n");
  fs.writeFileSync(process.env.LIVE_BODY, payload.body);
} else {
  throw new Error("unexpected gh request: " + JSON.stringify(args));
}
`,
          { mode: 0o755 },
        );
        const workflow = parse(
          readFileSync(path.join(root, ".github/workflows-disabled/ai-spec-buttons.yml"), "utf8"),
        );
        const step = workflow.jobs.append.steps.find((entry) => entry.run);
        assert.ok(step?.run, "find the actual issue-body write step");
        const run = () => {
          const result = spawnSync("bash", ["-c", step.run], {
            cwd: root,
            env: {
              ...process.env,
              PATH: `${dir}${path.delimiter}${process.env.PATH}`,
              GH_TOKEN: "offline-fixture",
              GITHUB_REPOSITORY: "flisk-sh/flisk-cli",
              ISSUE_NUMBER: "123",
              ISSUE_URL: url,
              ISSUE_LABELS: "bug",
              OUT_FILE: path.join(dir, "out.md"),
              PATCH_FILE: path.join(dir, "patch.json"),
              LIVE_BODY: bodyFile,
              CALLS_FILE: callsFile,
            },
            encoding: "utf8",
            timeout: 10000,
            killSignal: "SIGKILL",
          });
          assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stderr}`);
          return result.stdout;
        };
        const firstOutput = run();
        const afterFirst = readFileSync(bodyFile, "utf8");
        const expectedPatches = expectedAction === "patch" ? 1 : 0;
        const firstCalls = readFileSync(callsFile, "utf8");
        assert.equal(firstCalls, expectedPatches ? "GET\nGET\nPATCH\n" : "GET\n");
        if (!expectedPatches) assert.match(firstOutput, /Body unchanged; nothing to PATCH/);
        for (let event = 0; event < 3; event++) {
          assert.match(run(), /Body unchanged; nothing to PATCH/);
          assert.equal(readFileSync(bodyFile, "utf8"), afterFirst);
        }
        assert.equal(readFileSync(callsFile, "utf8"), `${firstCalls}GET\nGET\nGET\n`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
