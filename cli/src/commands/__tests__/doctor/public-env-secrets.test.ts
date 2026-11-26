// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  afterEach,
  beforeEach,
  checkPublicEnvSecrets,
  describe,
  expect,
  it,
  join,
  mkdirSync,
  mkdtempSync,
  rmSync,
  tmpdir,
  writeFileSync,
} from "./test-support.js";

describe("doctor public env secrets check", () => {
  let testDir: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "doctor-public-env-"));
    mkdirSync(join(testDir, ".flisk"), { recursive: true });
    writeFileSync(join(testDir, ".flisk", "project.json"), JSON.stringify({ name: "test-proj" }));
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  it("passes when public variables do not contain secret-looking values", () => {
    writeFileSync(
      join(testDir, ".env"),
      [
        "NEXT_PUBLIC_API_URL=https://api.example.com",
        "NEXT_PUBLIC_STRIPE_KEY=pk_live_51M00000000000000000000000000000000000000000000000000000000",
        "VITE_FEATURE_FLAG=ThisIsAVeryLongFeatureFlagValue2026",
      ].join("\n"),
    );

    const result = checkPublicEnvSecrets(testDir);
    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBeUndefined();
    expect(result.message).toContain("No secret-looking values detected");
  });

  it("warns without failing when public variables contain secret-looking values", () => {
    const mockSecret = [
      "sk",
      "live",
      "51M00000000000000000000000000000000000000000000000000000000",
    ].join("_");
    writeFileSync(join(testDir, ".env"), `NEXT_PUBLIC_STRIPE_SECRET=${mockSecret}\n`);

    const result = checkPublicEnvSecrets(testDir);
    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("NEXT_PUBLIC_STRIPE_SECRET (.env)");
    expect(result.message).not.toContain(mockSecret);
    expect(result.fix).toContain("Move secrets to server-side variables or API routes");
  });

  it("fails in strict mode when secret-looking values are detected", () => {
    const mockSecret = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    writeFileSync(join(testDir, ".env"), `VITE_AWS_KEY=${mockSecret}\n`);

    const result = checkPublicEnvSecrets(testDir, true);
    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(false);
    expect(result.message).toContain("VITE_AWS_KEY (.env)");
    expect(result.message).not.toContain(mockSecret);
  });
});
