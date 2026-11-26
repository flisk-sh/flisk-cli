// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal shell and migrator references are test fixtures
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { native } from "../../test-support/native-runtime.js";

describe("service directory .env expansion (#3141)", () => {
  native.nativeTestContext();

  const envOf = (dir: string, vars: Record<string, string>) => {
    const plan = native.planNativeRun(
      [
        native.nativeService(dir, "web", {
          command: "node s.js",
          env: {
            A: native.ref("A", "from-default"),
            B: native.ref("B", "from-default"),
            C: native.ref("C", "from-default"),
            D: native.ref("D", "from-default"),
          },
        }),
      ],
      vars,
      dir,
    );
    return { env: plan.services[0]?.env, missing: plan.missingVars };
  };

  it("resolves shell > project .env > service .env > default", () => {
    const dir = native.createTempDir();
    native.writeFileSync(native.join(dir, ".env"), "A=svc-a\nB=svc-b\nC=svc-c\n");
    // `vars` is the shell merged over the project .env, as runNativeUp builds it.
    const { env, missing } = envOf(dir, { A: "shell-a", B: "project-b" });
    expect(env).toMatchObject({
      A: "shell-a",
      B: "project-b",
      C: "svc-c",
      D: "from-default",
    });
    expect(missing).toEqual([]);
  });

  it("ignores a missing service .env", () => {
    const { env, missing } = envOf(native.createTempDir(), { A: "shell-a" });
    expect(env).toMatchObject({ A: "shell-a", B: "from-default" });
    expect(missing).toEqual([]);
  });

  it("hands the child the value from the service .env", async () => {
    const root = native.createTempDir();
    native.writeFileSync(native.join(root, ".env"), "GREETING=from-service-dotenv\n");
    native.writeFileSync(
      native.join(root, "p.mjs"),
      `import { writeFileSync } from "node:fs";
writeFileSync("out.txt", process.env.GREETING + "|" + process.env.OTHER);`,
    );
    const plan = native.planNativeRun(
      [
        native.nativeService(root, "job", {
          command: `${native.NODE} p.mjs`,
          restart: "no",
          env: { GREETING: native.ref("GREETING", "default"), OTHER: native.ref("OTHER", "dflt") },
        }),
      ],
      { OTHER: "from-shell" },
      root,
    );
    const supervisor = new native.NativeSupervisor(root, plan.services);
    native.supervisors.push(supervisor);
    await supervisor.start();
    await native.waitFor(() => native.existsSync(native.join(root, "out.txt")));
    expect(native.readFileSync(native.join(root, "out.txt"), "utf-8")).toBe(
      "from-service-dotenv|from-shell",
    );
  });
});
