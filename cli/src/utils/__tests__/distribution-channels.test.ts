// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  CHANNEL_STATUSES,
  CHANNELS,
  DISTRIBUTION_FILE,
  OPENAI_LONG_DESCRIPTION_LIMIT,
  OPENAI_NAME_LIMIT,
  OPENAI_SHORT_DESCRIPTION_LIMIT,
  PRODUCT_HUNT_DESCRIPTION_LIMIT,
  REGISTRY_DESCRIPTION_LIMIT,
  STATUS_ICONS,
  TAGLINE_LIMIT,
} from "../distribution/channels.js";

describe("CHANNELS catalog", () => {
  it("has unique channel ids", () => {
    const ids = CHANNELS.map((channel) => channel.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every channel a name, submit text and at least one limit", () => {
    for (const channel of CHANNELS) {
      expect(channel.id.length).toBeGreaterThan(0);
      expect(channel.name.length).toBeGreaterThan(0);
      expect(channel.submit.length).toBeGreaterThan(0);
      expect(channel.limits.length).toBeGreaterThan(0);
      for (const limit of channel.limits) {
        expect(limit.length).toBeGreaterThan(0);
      }
    }
  });

  it("marks at least one channel as MCP-only and at least one as general", () => {
    expect(CHANNELS.some((channel) => channel.isMcpOnly)).toBe(true);
    expect(CHANNELS.some((channel) => !channel.isMcpOnly)).toBe(true);
  });
});

describe("channel statuses", () => {
  it("has an icon for every status and no icon without a status", () => {
    expect(Object.keys(STATUS_ICONS).sort()).toEqual([...CHANNEL_STATUSES].sort());
  });

  it("gives every status a non-empty icon", () => {
    for (const status of CHANNEL_STATUSES) {
      expect(STATUS_ICONS[status].length).toBeGreaterThan(0);
    }
  });
});

describe("field limits", () => {
  it("defines positive limits for every listing field", () => {
    const limits = [
      TAGLINE_LIMIT,
      REGISTRY_DESCRIPTION_LIMIT,
      OPENAI_NAME_LIMIT,
      OPENAI_SHORT_DESCRIPTION_LIMIT,
      OPENAI_LONG_DESCRIPTION_LIMIT,
      PRODUCT_HUNT_DESCRIPTION_LIMIT,
    ];
    for (const limit of limits) {
      expect(limit).toBeGreaterThan(0);
    }
  });

  it("matches the documented limit values", () => {
    expect(TAGLINE_LIMIT).toBe(60);
    expect(REGISTRY_DESCRIPTION_LIMIT).toBe(100);
    expect(OPENAI_NAME_LIMIT).toBe(30);
    expect(OPENAI_SHORT_DESCRIPTION_LIMIT).toBe(30);
    expect(OPENAI_LONG_DESCRIPTION_LIMIT).toBe(4000);
    expect(PRODUCT_HUNT_DESCRIPTION_LIMIT).toBe(260);
  });
});

describe("DISTRIBUTION_FILE", () => {
  it("names the file distribution.json", () => {
    expect(DISTRIBUTION_FILE).toBe("distribution.json");
  });
});
