// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  afterEach,
  beforeEach,
  checkStarlarkLoadExports,
  describe,
  existsSync,
  expect,
  it,
  join,
  mkdirSync,
  rmSync,
  tmpdir,
  writeFileSync,
} from "./test-support.js";

describe("doctor generated Starlark load checks", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = join(
      tmpdir(),
      `flisk-doctor-frontend-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("fails when generated Starlark loads a private exported symbol", () => {
    const outDir = join(testDir, ".flisk", ".flisk-out");
    const extDir = join(outDir, "flisk-cli-ext", "engine");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(outDir, "Tiltfile"), 'load("./flisk-cli-ext/engine/bad.star", "Bad")\n');
    writeFileSync(
      join(extDir, "sablier_container_cycle.star"),
      "_sablier_middleware_suffix = 'x'\n",
    );
    writeFileSync(join(extDir, "public.star"), "Docker = struct()\n");
    writeFileSync(
      join(extDir, "bad.star"),
      [
        "Bad = struct()",
        'load("./sablier_container_cycle.star", "_sablier_middleware_suffix")',
        'load("./public.star", _Docker = "Docker")',
        "",
      ].join("\n"),
    );

    const result = checkStarlarkLoadExports();

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("_sablier_middleware_suffix");
    expect(result.message).not.toContain("_Docker");
  });

  it("fails when generated Starlark loads a missing relative file", () => {
    const outDir = join(testDir, ".flisk", ".flisk-out");
    const extDir = join(outDir, "flisk-cli-ext", "discovery");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(
      join(outDir, "Tiltfile"),
      'load("./flisk-cli-ext/discovery/daemon.star", "Daemon")\n',
    );
    writeFileSync(join(extDir, "daemon.star"), 'load("./resource_registry.star", "CacheOps")\n');

    const result = checkStarlarkLoadExports();

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("Missing relative load targets");
    expect(result.message).toContain("resource_registry.star");
  });

  it("passes when generated Starlark only uses private local aliases", () => {
    const extDir = join(testDir, ".flisk", ".flisk-out", "flisk-cli-ext", "engine");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "public.star"), "Docker = struct()\n");
    writeFileSync(join(extDir, "good.star"), 'load("./public.star", _Docker = "Docker")\n');

    const result = checkStarlarkLoadExports();

    expect(result.didPass).toBe(true);
  });
});
