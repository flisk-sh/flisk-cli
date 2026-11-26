// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { tiltAnswerIsForeign, tiltVisibleResourceNames } from "../tilt-answer-owner.js";

describe("tiltAnswerIsForeign", () => {
  const projectResourceNames = new Set(["api"]);

  it.each([null, "not an answer", {}, { items: "nope" }])(
    "treats an unparseable answer as inconclusive: %j",
    (resources) => {
      expect(tiltAnswerIsForeign(resources, projectResourceNames)).toBe(false);
    },
  );

  it("treats an empty resource list as inconclusive", () => {
    expect(tiltAnswerIsForeign({ items: [] }, projectResourceNames)).toBe(false);
  });

  it("recognizes a project resource", () => {
    expect(
      tiltAnswerIsForeign({ items: [{ metadata: { name: "api" } }] }, projectResourceNames),
    ).toBe(false);
  });

  it("lets a project resource win over a foreign resource", () => {
    expect(
      tiltAnswerIsForeign(
        { items: [{ metadata: { name: "other" } }, { metadata: { name: "api" } }] },
        projectResourceNames,
      ),
    ).toBe(false);
  });

  it("treats platform-only resources as inconclusive", () => {
    expect(
      tiltAnswerIsForeign(
        {
          items: [
            { metadata: { name: "traefik" } },
            { metadata: { name: "service-discovery-daemon" } },
            { metadata: { name: "(Tiltfile)" } },
          ],
        },
        projectResourceNames,
      ),
    ).toBe(false);
  });

  it("treats malformed items as inconclusive", () => {
    expect(
      tiltAnswerIsForeign({ items: [null, {}, { metadata: { name: 42 } }] }, projectResourceNames),
    ).toBe(false);
  });

  it("detects a foreign resource", () => {
    expect(
      tiltAnswerIsForeign({ items: [{ metadata: { name: "other" } }] }, projectResourceNames),
    ).toBe(true);
  });

  it("detects a foreign resource alongside a platform resource", () => {
    expect(
      tiltAnswerIsForeign(
        { items: [{ metadata: { name: "traefik" } }, { metadata: { name: "other" } }] },
        projectResourceNames,
      ),
    ).toBe(true);
  });
});

describe("tiltVisibleResourceNames", () => {
  it("keeps every appType that produces a Tilt resource", () => {
    const names = tiltVisibleResourceNames([
      { name: "web", config: { appName: "web", appType: "frontend" } },
      { name: "api", config: { appName: "api", appType: "backend" } },
      { name: "jobs", config: { appName: "jobs", appType: "worker" } },
      { name: "bot", config: { appName: "bot", appType: "agent" } },
      { name: "tools", config: { appName: "tools", appType: "mcp" } },
      { name: "migrate", config: { appName: "migrate", appType: "migrator" } },
      { name: "legacy", config: { appName: "legacy", appType: "bring-your-own" } },
    ]);
    expect(names).toEqual(new Set(["web", "api", "jobs", "bot", "tools", "migrate", "legacy"]));
  });

  it("drops declaration-only resources a Tilt answer never names", () => {
    const names = tiltVisibleResourceNames([
      { name: "pg", config: { appName: "pg", appType: "database" } },
      { name: "ui-lib", config: { appName: "ui-lib", appType: "library" } },
      { name: "contracts", config: { appName: "contracts", appType: "sdk" } },
    ]);
    expect(names).toEqual(new Set());
  });

  it("leaves a database-only project with no name to compare (#5346)", () => {
    // `flisk resource pg --type database`: the project's own Tilt runs the shared Postgres as
    // "postgres", never a resource named "pg", so comparing every resource name would read this
    // project's running Tilt as another project's.
    const names = tiltVisibleResourceNames([
      { name: "pg", config: { appName: "pg", appType: "database" } },
    ]);
    expect(names.size).toBe(0);
  });

  it("keeps a resource whose manifest did not parse", () => {
    // No config means "cannot classify", and matching more names errs toward not-foreign.
    expect(tiltVisibleResourceNames([{ name: "mystery" }])).toEqual(new Set(["mystery"]));
  });
});
