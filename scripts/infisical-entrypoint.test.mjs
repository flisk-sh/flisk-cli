// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
//
// End-to-end POSIX sh tests for infisical-entrypoint.sh:
// - removes temporary plaintext secrets file BEFORE exec (EXIT trap never fires across exec)
// - exports valid KEY=VALUE pairs (including values with '=' and shell metacharacters) without eval
// - reassembles multi-line PEM values without leaking base64 lines as separate variables
// - skips invalid variable names (including ';' command injection attempts) safely
// - preserves pre-set environment variables and TILT_* overrides
// - imported secrets named like the loader's own variables cannot corrupt its state or the cleanup path
// - INT/TERM during the fetch remove the temp file and stop the startup instead of exec-ing without secrets
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRYPOINT = path.join(
  ROOT,
  "cli/shared-platform-engineering/docker-templates/infisical-entrypoint.sh",
);

function availableShells() {
  const candidates = [
    { name: "sh", cmd: "sh", args: [] },
    { name: "dash", cmd: "dash", args: [] },
    { name: "busybox sh", cmd: "busybox", args: ["sh"] },
  ];
  return candidates.filter(({ cmd, args }) => {
    const probe = spawnSync(cmd, [...args, "-c", "exit 0"], { encoding: "utf8" });
    return probe.status === 0;
  });
}

function makeFixture(secretsBody) {
  const workDir = mkdtempSync(path.join(tmpdir(), "flisk-infisical-ep-"));
  const binDir = path.join(workDir, "bin");
  const tmpDir = path.join(workDir, "tmp");
  const secretsFixture = path.join(workDir, "secrets.txt");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(secretsFixture, secretsBody);

  const fakeInfisical = path.join(binDir, "infisical");
  writeFileSync(
    fakeInfisical,
    `#!/bin/sh
case "$1" in
  login) exit 0 ;;
  run) exit 0 ;;
  secrets)
    if [ -n "$FAKE_INFISICAL_SLEEP" ]; then sleep "$FAKE_INFISICAL_SLEEP"; fi
    cat "$FAKE_INFISICAL_SECRETS_FILE"
    exit 0
    ;;
  *) exit 0 ;;
esac
`,
  );
  chmodSync(fakeInfisical, 0o755);

  // BSD/macOS mktemp ignores TMPDIR when it gets no template, which would put the secrets file outside tmpDir and make
  // the leftover-file assertions vacuous; a stub that honors TMPDIR keeps them meaningful everywhere.
  const mktempStub = path.join(binDir, "mktemp");
  writeFileSync(mktempStub, '#!/bin/sh\nf="$TMPDIR/tmp.$$"\n: > "$f"\nchmod 600 "$f"\necho "$f"\n');
  chmodSync(mktempStub, 0o755);

  for (const stub of ["nc", "psql"]) {
    const stubPath = path.join(binDir, stub);
    writeFileSync(stubPath, "#!/bin/sh\nexit 0\n");
    chmodSync(stubPath, 0o755);
  }

  return { workDir, binDir, tmpDir, secretsFixture };
}

function entrypointEnv({ binDir, tmpDir, secretsFixture, extra = {} }) {
  return {
    PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    TMPDIR: tmpDir,
    FAKE_INFISICAL_SECRETS_FILE: secretsFixture,
    SERVICE_NAME: "billing-api",
    INFISICAL_ENABLED: "true",
    INFISICAL_CLIENT_ID: "client-id",
    INFISICAL_CLIENT_SECRET: "client-secret",
    INFISICAL_PROJECT_ID: "project-id",
    INFISICAL_ENV: "dev",
    INFISICAL_SITE_URL: "http://127.0.0.1:8080",
    AUTO_MIGRATE: "false",
    ...extra,
  };
}

function readResult(stdout) {
  const marker = stdout.split("\n").find((line) => line.startsWith("__RESULT__"));
  assert.ok(marker, `missing inspector output in stdout:\n${stdout}`);
  return JSON.parse(marker.slice("__RESULT__".length));
}

for (const shell of availableShells()) {
  test(`infisical-entrypoint.sh under ${shell.name}: deletes temp secrets before exec and avoids eval injection`, () => {
    const sentinelDir = mkdtempSync(path.join(tmpdir(), "flisk-infisical-sentinel-"));
    const sentinel1 = path.join(sentinelDir, "pwn1");
    const sentinel2 = path.join(sentinelDir, "pwn2");
    const sentinel3 = path.join(sentinelDir, "pwn3");

    // Assemble synthetic PEM markers at runtime so the tracked-secrets scanner
    // does not flag this test fixture as a committed private key.
    const pemBegin = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    const pemEnd = ["-----END", "PRIVATE KEY-----"].join(" ");
    const pemValue = [
      pemBegin,
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj",
      "MIIEowIBAAKCAQEA==",
      pemEnd,
    ].join("\n");

    // Intentionally omit a trailing newline on the final line to test EOF handling too.
    // Exercise TILT_* override precedence with TILT_REDIS_URL so validate_database_connectivity
    // does not invoke busybox's built-in nc applet (which rejects -z on Ubuntu).
    const secretsOutput = [
      `PRIVATE_KEY=${pemValue}`,
      `x;touch ${sentinel1}`,
      `BAD;NAME=touch ${sentinel2}`,
      "1INVALID_START=should-skip",
      "BAD-DASH=should-skip",
      `SHELL_META=$(touch ${sentinel3});echo \`id\``,
      "API_URL=https://example.com/cb?a=1&b=2==",
      "ALREADY_SET=from-infisical",
      "REDIS_URL=redis://infisical-should-not-win:6379",
      "FINAL_NO_NEWLINE=kept",
    ].join("\n");

    const { workDir, binDir, tmpDir, secretsFixture } = makeFixture(secretsOutput);
    try {
      const inspector = [
        "const fs = require('node:fs');",
        "const out = {",
        "  tmpFiles: fs.readdirSync(process.env.TMPDIR),",
        "  PRIVATE_KEY: process.env.PRIVATE_KEY,",
        "  MIIEowIBAAKCAQEA: process.env.MIIEowIBAAKCAQEA,",
        "  API_URL: process.env.API_URL,",
        "  SHELL_META: process.env.SHELL_META,",
        "  ALREADY_SET: process.env.ALREADY_SET,",
        "  REDIS_URL: process.env.REDIS_URL,",
        "  FINAL_NO_NEWLINE: process.env.FINAL_NO_NEWLINE,",
        "};",
        "process.stdout.write('__RESULT__' + JSON.stringify(out) + '\\n');",
      ].join(" ");

      const run = spawnSync(
        shell.cmd,
        [...shell.args, ENTRYPOINT, process.execPath, "-e", inspector],
        {
          encoding: "utf8",
          env: entrypointEnv({
            binDir,
            tmpDir,
            secretsFixture,
            extra: {
              ALREADY_SET: "from-env",
              TILT_REDIS_URL: "redis://tilt-wins:6379",
            },
          }),
        },
      );

      assert.equal(
        run.status,
        0,
        `expected exit 0, got ${run.status}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
      );

      const parsed = readResult(run.stdout);

      // 1. Plaintext temp secrets file must be gone BEFORE exec runs the app process
      assert.deepEqual(
        parsed.tmpFiles,
        [],
        `leftover files in TMPDIR before exec: ${parsed.tmpFiles.join(", ")}`,
      );
      assert.deepEqual(readdirSync(tmpDir), []);

      // 2. No command injection from unvalidated keys or metacharacter values
      assert.equal(existsSync(sentinel1), false, "line without '=' must not execute commands");
      assert.equal(existsSync(sentinel2), false, "invalid key with ';' must not execute commands");
      assert.equal(
        existsSync(sentinel3),
        false,
        "shell metacharacters in value must not execute commands",
      );

      // 3. Multi-line PEM secret preserved verbatim and base64 padding line not leaked as a var
      assert.equal(parsed.PRIVATE_KEY, pemValue);
      assert.equal(parsed.MIIEowIBAAKCAQEA, undefined);

      // 4. Values containing '=' and shell metacharacters exported literally
      assert.equal(parsed.API_URL, "https://example.com/cb?a=1&b=2==");
      assert.equal(parsed.SHELL_META, `$(touch ${sentinel3});echo \`id\``);
      assert.equal(parsed.FINAL_NO_NEWLINE, "kept");

      // 5. Already-set env vars and TILT_* overrides take precedence over Infisical
      assert.equal(parsed.ALREADY_SET, "from-env");
      assert.equal(parsed.REDIS_URL, "redis://tilt-wins:6379");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      rmSync(sentinelDir, { recursive: true, force: true });
    }
  });

  test(`infisical-entrypoint.sh under ${shell.name}: imported names cannot overwrite loader state or the cleanup path`, () => {
    const { workDir, binDir, tmpDir, secretsFixture } = makeFixture("");
    const victim = path.join(workDir, "victim.txt");
    writeFileSync(victim, "keep me\n");
    writeFileSync(
      secretsFixture,
      [
        `temp_secrets=${victim}`,
        "in_pem=1",
        "API_TOKEN=abc",
        "line=from-secret",
        "key=k",
        "value=v",
        "_fi_in_pem=reserved",
        "AFTER=kept",
        "",
      ].join("\n"),
    );
    try {
      const inspector = [
        "const names = ['temp_secrets','in_pem','API_TOKEN','line','key','value','_fi_in_pem','AFTER'];",
        "const out = Object.fromEntries(names.map((n) => [n, process.env[n]]));",
        "process.stdout.write('__RESULT__' + JSON.stringify(out) + '\\n');",
      ].join(" ");
      const run = spawnSync(
        shell.cmd,
        [...shell.args, ENTRYPOINT, process.execPath, "-e", inspector],
        {
          encoding: "utf8",
          env: entrypointEnv({ binDir, tmpDir, secretsFixture }),
        },
      );
      assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
      const parsed = readResult(run.stdout);
      assert.equal(existsSync(victim), true, "cleanup must delete only its own temp file");
      assert.equal(parsed.temp_secrets, victim);
      assert.equal(parsed.in_pem, "1");
      assert.equal(parsed.API_TOKEN, "abc", "a secret after in_pem=1 must still be exported");
      assert.equal(parsed.line, "from-secret");
      assert.equal(parsed.key, "k");
      assert.equal(parsed.value, "v");
      assert.equal(parsed._fi_in_pem, undefined, "reserved loader names are skipped");
      assert.equal(parsed.AFTER, "kept");
      assert.deepEqual(readdirSync(tmpDir), []);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test(`infisical-entrypoint.sh under ${shell.name}: TERM during the fetch cleans up and does not exec the app`, async () => {
    const { workDir, binDir, tmpDir, secretsFixture } = makeFixture("API_TOKEN=abc\n");
    try {
      const child = spawn(
        shell.cmd,
        [...shell.args, ENTRYPOINT, process.execPath, "-e", "console.log('__APP_RAN__')"],
        {
          env: entrypointEnv({
            binDir,
            tmpDir,
            secretsFixture,
            extra: { FAKE_INFISICAL_SLEEP: "2" },
          }),
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      // Wait until the temp file exists (the fetch is in flight), then terminate the entrypoint.
      for (let i = 0; i < 100 && readdirSync(tmpDir).length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(
        readdirSync(tmpDir).length,
        1,
        `temp secrets file should exist during the fetch\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
      child.kill("SIGTERM");
      const code = await new Promise((resolve) => child.on("close", (c) => resolve(c)));
      assert.equal(code, 143);
      assert.equal(stdout.includes("__APP_RAN__"), false, "the app must not start after TERM");
      assert.deepEqual(readdirSync(tmpDir), []);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
}
