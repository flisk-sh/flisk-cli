// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  afterEach,
  beforeEach,
  describe,
  discoverResourcesStrict,
  expect,
  getHostPortPlan,
  it,
  makeResource,
  stripVTControlCharacters,
  upCommand,
  vi,
} from "../../test-support/up.js";

describe("flisk up startup URL list with bring-your-own services only (#3203)", () => {
  beforeEach(() => {
    vi.stubEnv("FLISK_ALLOW_NATIVE_WINDOWS", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists proxied bring-your-own services under Backend API URLs with trailing slash and web UI at its own host", async () => {
    vi.mocked(getHostPortPlan).mockResolvedValueOnce({
      ingressHttp: 8080,
      ingressHttps: 8443,
      postgres: 5432,
      requested: { ingressHttp: 8080, ingressHttps: 8443, postgres: 5432 },
      explicit: { ingressHttp: false, ingressHttps: false, postgres: false },
      reason: { ingressHttp: "default", ingressHttps: "default", postgres: "default" },
    } as unknown as Awaited<ReturnType<typeof getHostPortPlan>>);
    vi.mocked(discoverResourcesStrict).mockReturnValueOnce([
      makeResource("vote", "bring-your-own", { schemaVersion: 1, port: 80 }),
      makeResource("results", "bring-your-own", {
        schemaVersion: 1,
        port: 5001,
        apiPath: "/results",
      }),
      makeResource("web", "bring-your-own", { schemaVersion: 1, port: 3000, webUi: true }),
      makeResource("redis", "bring-your-own", {
        schemaVersion: 1,
        port: 6379,
        exposeViaProxy: false,
      }),
    ]);

    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    try {
      await upCommand.parseAsync(["--dry-run", "--ignore-drift"], { from: "user" });
    } finally {
      log.mockRestore();
    }

    const output = stripVTControlCharacters(lines.join("\n"));

    // Frontend list includes web UI BYO at its own host
    expect(output).toContain("Frontend URLs:");
    expect(output).toContain("web: http://web.flisk-project.localhost:8080");

    // Backend list includes proxied BYO services with trailing slash
    expect(output).toContain("Backend API URLs:");
    expect(output).toContain("vote: http://api.flisk-project.localhost:8080/api/vote/");
    expect(output).toContain("results: http://api.flisk-project.localhost:8080/results/");

    // No /health suffix for bring-your-own services
    expect(output).not.toContain("/api/vote/health");

    // Unproxied bring-your-own service is omitted from URL lists
    expect(output).not.toContain("redis:");
  });
});
