// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkDockerBuildCache,
  DOCKER_BUILD_CACHE_CHECK,
  DOCKER_BUILD_CACHE_WARN_GIB,
  DOCTOR_BUILD_CACHE_TTL_MS,
  parseDockerBuildCache,
  parseDockerUsage,
  parseReclaimedFromPrune,
  parseSizeToBytes,
  pruneDockerBuildCache,
  validateCacheUntil,
} from "../docker-build-cache.js";

const MOCK_DF_ABOVE_THRESHOLD = `
Images\t12\t4.5GB\t1.2GB (26%)
Containers\t4\t0B\t0B
Local Volumes\t2\t150MB\t0B
Build Cache\t780\t11.82GB\t11.82GB (100%)
`.trim();

const MOCK_DF_BELOW_THRESHOLD = `
Images\t12\t4.5GB\t1.2GB (26%)
Containers\t4\t0B\t0B
Local Volumes\t2\t150MB\t0B
Build Cache\t471\t9.19GB\t5.2GB (56%)
`.trim();

const MOCK_DF_EMPTY = `
Images\t0\t0B\t0B
Build Cache\t0\t0B\t0B
`.trim();

describe("parseSizeToBytes", () => {
  it("parses zero bytes", () => {
    expect(parseSizeToBytes("0B")).toBe(0);
    expect(parseSizeToBytes("0 B")).toBe(0);
    expect(parseSizeToBytes("0")).toBe(0);
  });

  it("parses SI and IEC size suffixes", () => {
    expect(parseSizeToBytes("1024B")).toBe(1024);
    expect(parseSizeToBytes("4.096kB")).toBe(4096);
    expect(parseSizeToBytes("1KB")).toBe(1000);
    expect(parseSizeToBytes("10MB")).toBe(10 * 1000 ** 2);
    expect(parseSizeToBytes("2.5GB")).toBe(2.5 * 1000 ** 3);
    expect(parseSizeToBytes("11.82GB")).toBe(11.82 * 1000 ** 3);
    expect(parseSizeToBytes("1TB")).toBe(1000 ** 4);
    expect(parseSizeToBytes("1KiB")).toBe(1024);
    expect(parseSizeToBytes("1MiB")).toBe(1024 ** 2);
    expect(parseSizeToBytes("1GiB")).toBe(1024 ** 3);
    expect(parseSizeToBytes("1TiB")).toBe(1024 ** 4);
    expect(parseSizeToBytes("1K")).toBe(1024);
  });

  it("handles malformed strings safely", () => {
    expect(parseSizeToBytes("")).toBe(0);
    expect(parseSizeToBytes("invalid")).toBe(0);
  });
});

describe("parseDockerBuildCache", () => {
  it("parses build cache entry count, total size, and reclaimable size", () => {
    const info = parseDockerBuildCache(MOCK_DF_ABOVE_THRESHOLD);
    expect(info).not.toBeNull();
    expect(info?.entries).toBe(780);
    expect(info?.size).toBe("11.82GB");
    expect(info?.reclaimable).toBe("11.82GB");
    expect(info?.sizeGib).toBeCloseTo((11.82 * 1000 ** 3) / 1024 ** 3, 2);
  });

  it("parses empty build cache", () => {
    const info = parseDockerBuildCache(MOCK_DF_EMPTY);
    expect(info).not.toBeNull();
    expect(info?.entries).toBe(0);
    expect(info?.size).toBe("0B");
    expect(info?.reclaimable).toBe("0B");
    expect(info?.sizeBytes).toBe(0);
  });

  it("returns null if Build Cache line is missing", () => {
    const info = parseDockerBuildCache("Images\t12\t4.5GB\t1.2GB");
    expect(info).toBeNull();
  });
});

describe("parseDockerUsage", () => {
  it("reports image bytes, total bytes and summed reclaimable bytes", () => {
    const usage = parseDockerUsage(MOCK_DF_ABOVE_THRESHOLD);
    expect(usage.imageBytes).toBe(4.5 * 1000 ** 3);
    expect(usage.reclaimableBytes).toBeCloseTo((1.2 + 11.82) * 1000 ** 3, 0);
    expect(usage.totalBytes).toBeCloseTo((4.5 + 11.82) * 1000 ** 3 + 150 * 1000 ** 2, 0);
  });

  it("ignores the percent suffix on the Reclaimable column", () => {
    const usage = parseDockerUsage("Images\t2\t1GB\t500MB (50%)");
    expect(usage.imageBytes).toBe(1000 ** 3);
    expect(usage.reclaimableBytes).toBe(500 * 1000 ** 2);
  });

  it("returns zeroes for empty or malformed output", () => {
    expect(parseDockerUsage("")).toEqual({
      imageBytes: 0,
      reclaimableBytes: 0,
      totalBytes: 0,
    });
    expect(parseDockerUsage("no tabs here\n")).toEqual({
      imageBytes: 0,
      reclaimableBytes: 0,
      totalBytes: 0,
    });
  });
});

describe("checkDockerBuildCache", () => {
  it("reports failure when Docker CLI is not installed", async () => {
    const result = await checkDockerBuildCache(async () => "", false, { live: true });
    expect(result.name).toBe(DOCKER_BUILD_CACHE_CHECK);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("Docker CLI not found");
    expect(result.fix).toContain("https://docs.docker.com/get-docker/");
  });

  it("gracefully skips when docker system df command fails", async () => {
    const runner = async () => {
      throw new Error("daemon is not running");
    };
    const result = await checkDockerBuildCache(runner, true, { live: true });
    expect(result.name).toBe(DOCKER_BUILD_CACHE_CHECK);
    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
    expect(result.message).toContain("Could not read Docker build cache");
  });

  it("passes when build cache is 0 B in 0 entries", async () => {
    const runner = async () => MOCK_DF_EMPTY;
    const result = await checkDockerBuildCache(runner, true, { live: true });
    expect(result.name).toBe(DOCKER_BUILD_CACHE_CHECK);
    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBeUndefined();
    expect(result.message).toContain("0 B in 0 entries (Docker build cache is empty)");
    expect(result.buildCache).toEqual({
      size: "0B",
      entries: 0,
      reclaimable: "0B",
    });
  });

  it("passes when build cache is below 10 GiB threshold", async () => {
    const runner = async () => MOCK_DF_BELOW_THRESHOLD;
    const result = await checkDockerBuildCache(runner, true, { live: true });
    expect(result.name).toBe(DOCKER_BUILD_CACHE_CHECK);
    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBeUndefined();
    expect(result.message).toContain("9.19GB across 471 entries");
    expect(result.message).toContain("shared across all projects on this machine");
    expect(result.buildCache).toEqual({
      size: "9.19GB",
      entries: 471,
      reclaimable: "5.2GB",
    });
  });

  it("attaches dockerUsage with image and reclaimable bytes for doctor --json", async () => {
    const result = await checkDockerBuildCache(async () => MOCK_DF_ABOVE_THRESHOLD, true, {
      live: true,
    });
    expect(result.dockerUsage).toEqual({
      imageBytes: 4.5 * 1000 ** 3,
      reclaimableBytes: (1.2 + 11.82) * 1000 ** 3,
      totalBytes: 4.5 * 1000 ** 3 + 150 * 1000 ** 2 + 11.82 * 1000 ** 3,
    });
  });

  it("warns when build cache reaches 10 GiB threshold and suggests flisk down --prune-cache", async () => {
    const runner = async () => MOCK_DF_ABOVE_THRESHOLD;
    const result = await checkDockerBuildCache(runner, true, { live: true });
    expect(result.name).toBe(DOCKER_BUILD_CACHE_CHECK);
    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("11.82GB across 780 entries");
    expect(result.message).toContain(`exceeds ${DOCKER_BUILD_CACHE_WARN_GIB} GiB threshold`);
    expect(result.fix).toContain("flisk down --prune-cache");
    expect(result.fix).toContain("docker builder prune --filter until=24h");
    expect(result.buildCache).toEqual({
      size: "11.82GB",
      entries: 780,
      reclaimable: "11.82GB",
    });
  });

  it("keeps the warning threshold at 10 GiB", async () => {
    expect(DOCKER_BUILD_CACHE_WARN_GIB).toBe(10);

    const below = await checkDockerBuildCache(
      async () => "Build Cache\t100\t10.7GB\t10.7GB\n",
      true,
      { live: true },
    );
    expect(below.didPass).toBe(true);
    expect(below.isWarning).toBeUndefined();

    const exactlyTenGib = await checkDockerBuildCache(
      async () => "Build Cache\t100\t10.73741824GB\t10.73741824GB\n",
      true,
      { live: true },
    );
    expect(exactlyTenGib.didPass).toBe(false);
    expect(exactlyTenGib.isWarning).toBe(true);
    expect(exactlyTenGib.message).toContain("10 GiB threshold");
  });
});

describe("checkDockerBuildCache short-lived cache (#3844)", () => {
  const homes: string[] = [];
  let home = "";
  let nowMs = 1_700_000_000_000;
  const now = (): number => nowMs;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "flisk-doctor-cache-"));
    homes.push(home);
    nowMs = 1_700_000_000_000;
  });

  afterEach(() => {
    for (const tempHome of homes.splice(0)) rmSync(tempHome, { recursive: true, force: true });
  });

  it("reuses a recent answer, including the above-threshold warning and its fix", async () => {
    const calls: string[][] = [];
    const runner = async (args: string[]) => {
      calls.push(args);
      return MOCK_DF_ABOVE_THRESHOLD;
    };

    const first = await checkDockerBuildCache(runner, true, { home, now, daemon: "a" });
    expect(first.isWarning).toBe(true);
    expect(calls).toEqual([
      ["system", "df", "--format", "{{.Type}}\t{{.TotalCount}}\t{{.Size}}\t{{.Reclaimable}}"],
    ]);

    nowMs += 3 * 60_000;
    const second = await checkDockerBuildCache(runner, true, { home, now, daemon: "a" });
    expect(calls).toHaveLength(1);
    expect(second.isWarning).toBe(true);
    expect(second.didPass).toBe(false);
    expect(second.message).toContain("11.82GB across 780 entries");
    expect(second.message).toContain(`exceeds ${DOCKER_BUILD_CACHE_WARN_GIB} GiB threshold`);
    expect(second.message).toContain("(checked 3 min ago)");
    expect(second.fix).toContain("flisk down --prune-cache");
    expect(second.buildCache).toEqual({
      size: "11.82GB",
      entries: 780,
      reclaimable: "11.82GB",
    });
    // The image and reclaimable bytes `flisk doctor --json` reports survive a cached answer.
    expect(second.dockerUsage).toEqual(first.dockerUsage);
    expect(second.dockerUsage?.imageBytes).toBe(4.5 * 1000 ** 3);
  });

  it("asks Docker again once the cached answer is too old", async () => {
    const calls: string[][] = [];
    const runner = async (args: string[]) => {
      calls.push(args);
      return calls.length === 1 ? MOCK_DF_BELOW_THRESHOLD : MOCK_DF_EMPTY;
    };

    await checkDockerBuildCache(runner, true, { home, now, daemon: "a" });
    const immediate = await checkDockerBuildCache(runner, true, { home, now, daemon: "a" });
    expect(calls).toHaveLength(1);
    expect(immediate.message).toContain("(checked just now)");

    nowMs += DOCTOR_BUILD_CACHE_TTL_MS;
    const refreshed = await checkDockerBuildCache(runner, true, { home, now, daemon: "a" });
    expect(calls).toHaveLength(2);
    expect(refreshed.message).toContain("0 B in 0 entries (Docker build cache is empty)");
    expect(refreshed.message).not.toContain("checked");
  });

  it("ignores a corrupt cache stamp", async () => {
    const cacheDir = join(home, ".flisk", "cache");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "docker-build-cache.json"), "{nope");
    let calls = 0;
    const runner = async () => {
      calls += 1;
      return MOCK_DF_BELOW_THRESHOLD;
    };

    const result = await checkDockerBuildCache(runner, true, { home, now, daemon: "a" });
    expect(calls).toBe(1);
    expect(result.message).toContain("9.19GB across 471 entries");
    expect(result.message).not.toContain("checked");
  });

  it("always reads the live value when the check acts on it", async () => {
    let calls = 0;
    const runner = async () => {
      calls += 1;
      return calls === 1 ? MOCK_DF_BELOW_THRESHOLD : MOCK_DF_EMPTY;
    };

    await checkDockerBuildCache(runner, true, { home, now, daemon: "a" });
    const live = await checkDockerBuildCache(runner, true, {
      home,
      now,
      daemon: "a",
      live: true,
    });
    expect(calls).toBe(2);
    expect(live.message).toContain("0 B in 0 entries (Docker build cache is empty)");
    expect(live.message).not.toContain("checked");
  });

  it("does not reuse a value measured on a different Docker daemon", async () => {
    let calls = 0;
    const runner = async () => {
      calls += 1;
      return MOCK_DF_BELOW_THRESHOLD;
    };

    await checkDockerBuildCache(runner, true, { home, now, daemon: "a" });
    await checkDockerBuildCache(runner, true, { home, now, daemon: "b" });
    expect(calls).toBe(2);
  });

  it("discards the cached value after an explicit build-cache prune", async () => {
    let checkCalls = 0;
    const checkRunner = async () => {
      checkCalls += 1;
      return MOCK_DF_BELOW_THRESHOLD;
    };
    await checkDockerBuildCache(checkRunner, true, { home, now, daemon: "a" });

    await pruneDockerBuildCache({
      runner: async () => "Total reclaimed space: 5.2GB",
      home,
    });

    const afterPrune = await checkDockerBuildCache(checkRunner, true, {
      home,
      now,
      daemon: "a",
    });
    expect(checkCalls).toBe(2);
    expect(afterPrune.message).not.toContain("checked");
  });
});

describe("validateCacheUntil", () => {
  it("accepts valid duration strings", () => {
    expect(validateCacheUntil("24h")).toBe(true);
    expect(validateCacheUntil("7d")).toBe(true);
    expect(validateCacheUntil("168h")).toBe(true);
    expect(validateCacheUntil("30m")).toBe(true);
    expect(validateCacheUntil("2h30m")).toBe(true);
    expect(validateCacheUntil("1h30m10s")).toBe(true);
  });

  it("accepts valid ISO dates", () => {
    expect(validateCacheUntil("2026-10-01")).toBe(true);
    expect(validateCacheUntil("2026-10-01T00:00:00Z")).toBe(true);
  });

  it("rejects malicious or invalid inputs", () => {
    expect(validateCacheUntil("")).toBe(false);
    expect(validateCacheUntil("   ")).toBe(false);
    expect(validateCacheUntil("24h; rm -rf /")).toBe(false);
    expect(validateCacheUntil("24h && echo pwned")).toBe(false);
    expect(validateCacheUntil("-24h")).toBe(false);
    expect(validateCacheUntil("invalid")).toBe(false);
  });
});

describe("parseReclaimedFromPrune", () => {
  it("extracts reclaimed space from docker builder prune output", () => {
    const output = `
ID                                              RECLAIMED       ACCESS  LAST ACCESSED
abc123def456                                    1.2GB           2       2 days ago
Total reclaimed space: 2.6GB
`;
    expect(parseReclaimedFromPrune(output)).toBe("2.6GB");
  });

  it("handles Total: 0B format", () => {
    expect(parseReclaimedFromPrune("Total: 0B")).toBe("0B");
  });

  it("defaults to 0 B when output has no total line", () => {
    expect(parseReclaimedFromPrune("No cached records found")).toBe("0 B");
  });
});

describe("pruneDockerBuildCache", () => {
  it("rejects invalid age filter with FliskError", async () => {
    await expect(pruneDockerBuildCache({ until: "invalid-age" })).rejects.toThrow(
      'Invalid --cache-until format: "invalid-age"',
    );
  });

  it("executes docker builder prune with structured filter arguments", async () => {
    const executed: string[][] = [];
    const runner = async (args: string[]) => {
      executed.push(args);
      return "Total reclaimed space: 2.6GB";
    };

    const result = await pruneDockerBuildCache({ until: "48h", runner });
    expect(executed).toEqual([["builder", "prune", "-f", "--filter", "until=48h"]]);
    expect(result).toEqual({ reclaimed: "2.6GB", until: "48h" });
  });

  it("uses 24h as default until filter", async () => {
    const executed: string[][] = [];
    const runner = async (args: string[]) => {
      executed.push(args);
      return "Total reclaimed space: 0B";
    };

    const result = await pruneDockerBuildCache({ runner });
    expect(executed).toEqual([["builder", "prune", "-f", "--filter", "until=24h"]]);
    expect(result).toEqual({ reclaimed: "0B", until: "24h" });
  });

  it.each([
    ["7d", "168h"],
    ["24H", "24h"],
    ["1d12h", "36h"],
    ["0d", "0h"],
    [" 2D30M ", "48h30m"],
  ])(
    "normalizes %s to the Docker duration %s before invoking the runner",
    async (input, expected) => {
      const executed: string[][] = [];
      const runner = async (args: string[]) => {
        executed.push(args);
        return "Total reclaimed space: 0B";
      };

      const result = await pruneDockerBuildCache({ until: input, runner });
      expect(executed).toEqual([["builder", "prune", "-f", "--filter", `until=${expected}`]]);
      expect(result.until).toBe(expected);
    },
  );

  it("passes ISO dates through unchanged, keeping T and Z case", async () => {
    const executed: string[][] = [];
    const runner = async (args: string[]) => {
      executed.push(args);
      return "Total reclaimed space: 0B";
    };

    const result = await pruneDockerBuildCache({ until: "2026-10-01T00:00:00Z", runner });
    expect(executed).toEqual([
      ["builder", "prune", "-f", "--filter", "until=2026-10-01T00:00:00Z"],
    ]);
    expect(result.until).toBe("2026-10-01T00:00:00Z");
  });
});
