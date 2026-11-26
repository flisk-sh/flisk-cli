// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parseServiceNames } from "../service-names.js";

describe("parseServiceNames", () => {
  it("keeps an absent option absent", () => {
    expect(parseServiceNames(undefined)).toBeUndefined();
  });

  it("splits comma-separated names and trims whitespace", () => {
    expect(parseServiceNames(["api, web,", " worker "])).toEqual(["api", "web", "worker"]);
  });

  it("drops empty entries and repeated names", () => {
    expect(parseServiceNames(["", " , ", "api,,api"])).toEqual(["api"]);
  });
});
