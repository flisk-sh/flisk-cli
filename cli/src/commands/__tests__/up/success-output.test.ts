// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, formatUpSuccess, it } from "../../test-support/up.js";

describe("flisk up success output", () => {
  it("prints the first-win block with exact UI and networks copy", () => {
    expect(formatUpSuccess(10350, {})).toEqual([
      "Flisk is up.",
      "Tilt UI: http://localhost:10350",
      "App URLs:",
      "  run: flisk networks",
      "Stop: flisk down",
      "Next: flisk help  # or visit https://flisk.sh/docs",
    ]);
  });

  it("includes at most five discovered app URLs when no service health provided", () => {
    const lines = formatUpSuccess(10351, { appUrls: ["a", "b", "c", "d", "e", "f"] });
    // Filter for lines with exactly two leading spaces (the URL lines), not the "… and X more" line which has three
    expect(lines.filter((line) => /^ {2}[^ ]/.test(line))).toEqual([
      "  a",
      "  b",
      "  c",
      "  d",
      "  e",
    ]);
  });

  it("shows service health with status icons and URLs", () => {
    const lines = formatUpSuccess(10350, {
      serviceHealth: [
        { name: "api", status: "ready", url: "http://localhost:10350/api/orders" },
        { name: "web", status: "starting" },
        { name: "worker", status: "failed" },
      ],
    });
    expect(lines).toContain("Services:");
    expect(
      lines.some((l) => l.includes("✓ api") && l.includes("http://localhost:10350/api/orders")),
    ).toBe(true);
    expect(lines.some((l) => l.includes("⟳ web"))).toBe(true);
    expect(lines.some((l) => l.includes("✗ worker"))).toBe(true);
    expect(lines).toContain("Stop: flisk down");
    expect(lines).toContain("Logs: flisk logs --service <name>");
    // `flisk logs <service>` is rejected ("too many arguments"); service names are an option.
    expect(lines).not.toContain("Logs: flisk logs <service>");
  });

  it("lists services before Tilt's internal resources, so none falls into 'and N more'", () => {
    // Shaped like a real run: Tilt reports its own resources first, and one more enabled resource (the discovery daemon) used to
    // push a running frontend past the tenth line, which the quickstart journey then reported as "never printed the vue-app URL".
    const internals = [
      "(Tiltfile)",
      "golden-layers-build",
      "provision-db-shop",
      "postgres",
      "init-networks",
      "storefront-config-gen",
      "vue-app-config-gen",
      "orders-api-config-gen",
      "service-discovery-daemon",
      "traefik",
    ].map((name) => ({ name, status: "ready" as const }));
    const services = ["orders-api", "storefront", "vue-app"].map((name) => ({
      name,
      status: "ready" as const,
      url: `http://app.shop.localhost:8080/${name}`,
    }));
    const lines = formatUpSuccess(10350, { serviceHealth: [...internals, ...services] });

    for (const name of ["orders-api", "storefront", "vue-app"]) {
      expect(lines).toContain(`  ✓ ${name}: http://app.shop.localhost:8080/${name}/health`);
      expect(lines.some((l) => l.startsWith(`  ✓ ${name} → `))).toBe(true);
    }
    // Internals have no URL, so they are not in the health list and the first ten service lines still start with the services.
    const health = lines.slice(lines.indexOf("Health checks:") + 1);
    expect(health.some((l) => l.includes("golden-layers-build"))).toBe(false);
    const listed = lines.slice(lines.indexOf("Services:") + 1, lines.indexOf("Health checks:"));
    expect(listed.slice(0, 3).map((l) => l.trim().split(" ")[1])).toEqual([
      "orders-api",
      "storefront",
      "vue-app",
    ]);
  });

  it("caps the health list at ten services and says how many more", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `svc-${i}`,
      status: "ready" as const,
      url: `http://x/svc-${i}`,
    }));
    const lines = formatUpSuccess(10350, {
      serviceHealth: [{ name: "(Tiltfile)", status: "ready" }, ...many],
    });
    const health = lines.slice(lines.indexOf("Health checks:") + 1);
    expect(health.filter((l) => l.includes("/health"))).toHaveLength(10);
    expect(health).toContain("  … and 2 more");
  });
});
