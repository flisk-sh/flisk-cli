// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal shell and migrator references are test fixtures
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { native } from "../../test-support/native-runtime.js";

describe("migrator output propagation", () => {
  native.nativeTestContext();

  describe("migrator output propagation (#2864)", () => {
    const ECHO_SERVER = `
import { createServer } from "node:http";
const port = Number(process.env.PORT);
createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
  } else if (req.url === "/token") {
    res.writeHead(200);
    res.end(JSON.stringify({
      apiKey: process.env.PLATFORM_API_KEY ?? null,
      secondVal: process.env.EXTRA_VAL ?? null,
      fallbackVal: process.env.FALLBACK_VAL ?? null,
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(port);
`;

    it("propagates single and multiple outputs to dependent service with key renaming", async () => {
      const root = native.createTempDir();
      native.writeFileSync(native.join(root, "echo-server.mjs"), ECHO_SERVER);
      const port = await native.freePort();

      const plan = native.planNativeRun([
        native.nativeService(root, "migrator", {
          appType: "migrator",
          command:
            'printf "SERVICE_TOKEN=token_abc123\\nEXTRA_KEY=extra_value_456\\n" > "$FLISK_OUTPUT"',
        }),
        native.nativeService(root, "api", {
          command: `${native.NODE} echo-server.mjs`,
          port,
          healthCheckPath: "/health",
          dependsOn: ["migrator"],
          env: {
            PLATFORM_API_KEY: "${migrator:SERVICE_TOKEN}",
            EXTRA_VAL: "${migrator:EXTRA_KEY}",
            FALLBACK_VAL: "${migrator:MISSING_KEY:-default_fallback}",
          },
        }),
      ]);

      const notes: string[] = [];
      const supervisor = new native.NativeSupervisor(root, plan.services, {
        onNote: (name, message) => notes.push(`${name}: ${message}`),
      });
      native.supervisors.push(supervisor);

      const failures = await supervisor.start();
      expect(failures).toEqual([]);
      expect(notes).toContain("migrator: finished (exit code 0)");

      // Verify dependent received the renamed and resolved environment variables
      const res = await fetch(native.localUrl(port, "/token"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        apiKey: "token_abc123",
        secondVal: "extra_value_456",
        fallbackVal: "default_fallback",
      });

      // Verify supervisor recorded parsed outputs
      expect(supervisor.outputsOf("migrator")).toEqual({
        SERVICE_TOKEN: "token_abc123",
        EXTRA_KEY: "extra_value_456",
      });
    });

    it("binds a command reference to migrator output at spawn time, not at planning time", async () => {
      const root = native.createTempDir();
      native.writeFileSync(
        native.join(root, "dump-late.mjs"),
        `import { renameSync, writeFileSync } from "node:fs";
// Write then rename, so the test never reads a half-written file.
writeFileSync("late.json.tmp", process.argv[2] ?? "");
renameSync("late.json.tmp", "late.json");`,
      );

      const plan = native.planNativeRun([
        native.nativeService(root, "migrator", {
          appType: "migrator",
          command: 'printf "SERVICE_TOKEN=token_late_789\\n" > "$FLISK_OUTPUT"',
        }),
        native.nativeService(root, "api", {
          command: `${native.NODE} dump-late.mjs "${native.ref("TOKEN")}"`,
          dependsOn: ["migrator"],
          restart: "no", // a script that writes a file and exits: finished, not a failed start
          env: { TOKEN: "${migrator:SERVICE_TOKEN}" },
        }),
      ]);

      const supervisor = new native.NativeSupervisor(root, plan.services);
      native.supervisors.push(supervisor);
      const failures = await supervisor.start();
      expect(failures).toEqual([]);
      await native.waitFor(() => native.existsSync(native.join(root, "late.json")));
      // The shell expands ${TOKEN} at launch, after resolveServiceEnv put the migrator's real output into the env;
      // the placeholder never reaches the process.
      expect(native.readFileSync(native.join(root, "late.json"), "utf-8")).toBe("token_late_789");
    });

    it("binds an env key that names another migrator-produced key, not only the direct reference", async () => {
      const root = native.createTempDir();
      native.writeFileSync(
        native.join(root, "dump-env.mjs"),
        `import { renameSync, writeFileSync } from "node:fs";
// Write then rename, so the test never reads a half-written file.
writeFileSync("env-alias.json.tmp", JSON.stringify({ copy: process.env.COPY }));
renameSync("env-alias.json.tmp", "env-alias.json");`,
      );

      const plan = native.planNativeRun([
        native.nativeService(root, "migrator", {
          appType: "migrator",
          command: 'printf "SERVICE_TOKEN=alias_late_42\\n" > "$FLISK_OUTPUT"',
        }),
        native.nativeService(root, "api", {
          command: `${native.NODE} dump-env.mjs`,
          dependsOn: ["migrator"],
          restart: "no", // a script that writes a file and exits: finished, not a failed start
          env: { TOKEN: "${migrator:SERVICE_TOKEN}", COPY: "${TOKEN}" },
        }),
      ]);

      const supervisor = new native.NativeSupervisor(root, plan.services);
      native.supervisors.push(supervisor);
      const failures = await supervisor.start();
      expect(failures).toEqual([]);
      await native.waitFor(() => native.existsSync(native.join(root, "env-alias.json")));
      // COPY names TOKEN rather than the migrator: after the direct key is bound, the alias must hold the
      // produced value, not the planning-time placeholder that TOKEN expanded to.
      expect(
        JSON.parse(native.readFileSync(native.join(root, "env-alias.json"), "utf-8")).copy,
      ).toBe("alias_late_42");
    });

    it("binds a direct migrator reference with the run's own variables, not only the shell's", async () => {
      const root = native.createTempDir();
      native.writeFileSync(
        native.join(root, "dump-scope.mjs"),
        `import { renameSync, writeFileSync } from "node:fs";
// Write then rename, so the test never reads a half-written file.
writeFileSync("env-scope.json.tmp", JSON.stringify({ url: process.env.URL }));
renameSync("env-scope.json.tmp", "env-scope.json");`,
      );
      const runVars = { HOST: "api.internal" };

      const plan = native.planNativeRun(
        [
          native.nativeService(root, "migrator", {
            appType: "migrator",
            command: 'printf "SERVICE_TOKEN=scope_17\\n" > "$FLISK_OUTPUT"',
          }),
          native.nativeService(root, "api", {
            command: `${native.NODE} dump-scope.mjs`,
            dependsOn: ["migrator"],
            restart: "no", // a script that writes a file and exits: finished, not a failed start
            env: { URL: "${HOST}/${migrator:SERVICE_TOKEN}" },
          }),
        ],
        runVars,
        root,
      );

      const supervisor = new native.NativeSupervisor(root, plan.services, {}, { baseEnv: runVars });
      native.supervisors.push(supervisor);
      const failures = await supervisor.start();
      expect(failures).toEqual([]);
      await native.waitFor(() => native.existsSync(native.join(root, "env-scope.json")));
      // HOST is a run variable the shell never had: the late binding expands with the planning ranking
      // (service .env, the run's variables, the service's env), so the host survives the rebind.
      expect(
        JSON.parse(native.readFileSync(native.join(root, "env-scope.json"), "utf-8")).url,
      ).toBe("api.internal/scope_17");
    });

    it("rebinds the health path and probe words that reference migrator output", async () => {
      const root = native.createTempDir();
      native.writeFileSync(
        native.join(root, "health-recorder.mjs"),
        `import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
const port = Number(process.env.PORT);
createServer((req, res) => {
  appendFileSync("health-urls.jsonl", req.url + "\\n");
  res.writeHead(req.url.startsWith("/health") ? 200 : 404);
  res.end();
}).listen(port);`,
      );
      native.writeFileSync(
        native.join(root, "probe-late.mjs"),
        `import { renameSync, writeFileSync } from "node:fs";
// Write then rename, so the test never reads a half-written file.
writeFileSync("probe-late.json.tmp", process.argv[2] ?? "");
renameSync("probe-late.json.tmp", "probe-late.json");`,
      );
      const port = await native.freePort();

      const plan = native.planNativeRun([
        native.nativeService(root, "migrator", {
          appType: "migrator",
          command: 'printf "SERVICE_TOKEN=token_health_456\\n" > "$FLISK_OUTPUT"',
        }),
        native.nativeService(root, "api", {
          command: `${native.NODE} health-recorder.mjs`,
          port,
          dependsOn: ["migrator"],
          env: { TOKEN: "${migrator:SERVICE_TOKEN}" },
          healthCheckPath: `/health?token=${native.ref("TOKEN")}`,
        }),
        native.nativeService(root, "worker", {
          command: "sleep 30",
          dependsOn: ["migrator"],
          env: { TOKEN: "${migrator:SERVICE_TOKEN}" },
          healthCheck: { command: [process.execPath, "probe-late.mjs", native.ref("TOKEN")] },
        }),
      ]);

      const supervisor = new native.NativeSupervisor(root, plan.services);
      native.supervisors.push(supervisor);
      const failures = await supervisor.start();
      expect(failures).toEqual([]);

      // The health URL was probed with the bound token, not the planning-time placeholder.
      const urls = native.readFileSync(native.join(root, "health-urls.jsonl"), "utf-8");
      expect(urls).toContain("token_health_456");
      expect(urls).not.toContain("migrator:SERVICE_TOKEN");
      // The probe words were re-expanded after the migrator finished.
      await native.waitFor(() => native.existsSync(native.join(root, "probe-late.json")));
      expect(native.readFileSync(native.join(root, "probe-late.json"), "utf-8")).toBe(
        "token_health_456",
      );
    });

    it("refuses a migrator reference in a health path that is not a dependsOn migrator", () => {
      const root = native.createTempDir();
      const plan = native.planNativeRun([
        native.nativeService(root, "migrator", { appType: "migrator", command: "exit 0" }),
        native.nativeService(root, "api", {
          command: "node server.js",
          port: 4100,
          healthCheckPath: `/ready?token=${native.ref("migrator:SERVICE_TOKEN")}`,
        }),
      ]);

      expect(
        plan.errors.some((err) => err.includes('references unauthorized output from "migrator"')),
      ).toBe(true);
    });

    it("rejects unauthorized output references at plan time when not in dependsOn", () => {
      const root = native.createTempDir();
      const plan = native.planNativeRun([
        native.nativeService(root, "migrator", { appType: "migrator", command: "exit 0" }),
        native.nativeService(root, "unrelated-api", {
          command: "node server.js",
          dependsOn: [], // Missing "migrator"
          env: {
            SECRET: "${migrator:SERVICE_TOKEN}",
          },
        }),
      ]);

      expect(plan.errors.length).toBeGreaterThan(0);
      expect(
        plan.errors.some((err) => err.includes('references unauthorized output from "migrator"')),
      ).toBe(true);
    });

    it("blocks dependent when migrator fails and does not reuse stale outputs", async () => {
      const root = native.createTempDir();
      native.writeFileSync(native.join(root, "echo-server.mjs"), ECHO_SERVER);
      const port = await native.freePort();

      // First, simulate a stale output file left from a previous run
      const outputPath = native.join(root, ".flisk", "outputs", "migrator.env");
      native.mkdirSync(native.join(root, ".flisk", "outputs"), { recursive: true });
      native.writeFileSync(outputPath, "SERVICE_TOKEN=stale_old_token\n");

      const plan = native.planNativeRun([
        native.nativeService(root, "migrator", {
          appType: "migrator",
          command: "exit 1", // Failed migrator
        }),
        native.nativeService(root, "api", {
          command: `${native.NODE} echo-server.mjs`,
          port,
          dependsOn: ["migrator"],
          env: {
            PLATFORM_API_KEY: "${migrator:SERVICE_TOKEN}",
          },
        }),
      ]);

      const supervisor = new native.NativeSupervisor(root, plan.services);
      native.supervisors.push(supervisor);

      const failures = await supervisor.start();
      expect(failures).toMatchObject([
        { name: "migrator", reason: "the job did not exit 0" },
        { name: "api", reason: "not started: migrator did not start" },
      ]);

      // Stale output must be deleted on failure
      expect(native.existsSync(outputPath)).toBe(false);
      expect(supervisor.pidOf("api")).toBeUndefined();
    });

    it("fails dependent when migrator does not produce expected output and no fallback is given", async () => {
      const root = native.createTempDir();
      native.writeFileSync(native.join(root, "echo-server.mjs"), ECHO_SERVER);
      const port = await native.freePort();

      const plan = native.planNativeRun([
        native.nativeService(root, "migrator", {
          appType: "migrator",
          command: 'printf "OTHER_KEY=value\\n" > "$FLISK_OUTPUT"',
        }),
        native.nativeService(root, "api", {
          command: `${native.NODE} echo-server.mjs`,
          port,
          dependsOn: ["migrator"],
          env: {
            REQUIRED_TOKEN: "${migrator:MISSING_TOKEN}",
          },
        }),
      ]);

      const supervisor = new native.NativeSupervisor(root, plan.services);
      native.supervisors.push(supervisor);

      const failures = await supervisor.start();
      expect(failures.length).toBeGreaterThan(0);
      const apiFailure = failures.find((f) => f.name === "api");
      expect(apiFailure?.reason).toContain(
        'Migrator "migrator" did not produce expected output "MISSING_TOKEN"',
      );
    });

    it("refreshes output on repeated run and never leaks sentinel secrets to logs or state", async () => {
      const root = native.createTempDir();
      native.writeFileSync(native.join(root, "echo-server.mjs"), ECHO_SERVER);
      const port = await native.freePort();
      const SENTINEL_SECRET = "SENTINEL_SECRET_ALPHA_9999_NEVER_LEAK";

      // Write a seeder script that outputs the secret to $FLISK_OUTPUT dynamically
      native.writeFileSync(
        native.join(root, "seeder.mjs"),
        `import { writeFileSync } from "node:fs";
const token = process.env.SEEDED_TOKEN;
writeFileSync(process.env.FLISK_OUTPUT, "SERVICE_TOKEN=" + token + "\\n");
`,
      );

      // Run 1: writes sentinel secret
      const plan1 = native.planNativeRun([
        native.nativeService(root, "migrator", {
          appType: "migrator",
          command: `${native.NODE} seeder.mjs`,
          env: { SEEDED_TOKEN: SENTINEL_SECRET },
        }),
        native.nativeService(root, "api", {
          command: `${native.NODE} echo-server.mjs`,
          port,
          healthCheckPath: "/health",
          dependsOn: ["migrator"],
          env: {
            PLATFORM_API_KEY: "${migrator:SERVICE_TOKEN}",
          },
        }),
      ]);

      const notes: string[] = [];
      const supervisor1 = new native.NativeSupervisor(root, plan1.services, {
        onNote: (name, message) => notes.push(`${name}: ${message}`),
      });
      native.supervisors.push(supervisor1);

      expect(await supervisor1.start()).toEqual([]);

      // Check that secret was NOT leaked into notes
      expect(notes.some((n) => n.includes(SENTINEL_SECRET))).toBe(false);

      // Check that secret was NOT saved in state file
      const runStateContent = native.readFileSync(
        native.join(root, ".flisk", "native", "run.json"),
        "utf8",
      );
      expect(runStateContent.includes(SENTINEL_SECRET)).toBe(false);

      // Check that secret was NOT written to any persistent service log
      const logsDir = native.join(root, ".flisk", "native", "logs");
      const logFiles = native.existsSync(logsDir) ? native.readdirSync(logsDir) : [];
      for (const file of logFiles) {
        expect(native.readFileSync(native.join(logsDir, file), "utf-8")).not.toContain(
          SENTINEL_SECRET,
        );
      }

      await supervisor1.stop();

      // Run 2: refreshed with new token
      const NEW_SECRET = "NEW_REFRESHED_SECRET_8888";
      const port2 = await native.freePort();
      const plan2 = native.planNativeRun([
        native.nativeService(root, "migrator", {
          appType: "migrator",
          command: `${native.NODE} seeder.mjs`,
          env: { SEEDED_TOKEN: NEW_SECRET },
        }),
        native.nativeService(root, "api", {
          command: `${native.NODE} echo-server.mjs`,
          port: port2,
          healthCheckPath: "/health",
          dependsOn: ["migrator"],
          env: {
            PLATFORM_API_KEY: "${migrator:SERVICE_TOKEN}",
          },
        }),
      ]);

      const supervisor2 = new native.NativeSupervisor(root, plan2.services);
      native.supervisors.push(supervisor2);

      expect(await supervisor2.start()).toEqual([]);
      const res = await fetch(native.localUrl(port2, "/token"));
      const data = await res.json();
      expect(data.apiKey).toBe(NEW_SECRET);
      expect(data.apiKey).not.toBe(SENTINEL_SECRET);
    });
  });
});
