// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { JsonArray, JsonObject, JsonValue } from "../json.js";

describe("JSON value types", () => {
  it("covers the JSON scalars and nested containers", () => {
    const values: JsonValue[] = [
      "text",
      42,
      true,
      null,
      ["a", 1],
      { nested: { deep: [1, { ok: true }] } },
    ];
    expect(values).toHaveLength(6);
  });

  it("types objects and arrays recursively", () => {
    const array: JsonArray = [1, "two", { three: 3 }];
    const object: JsonObject = { list: array, flag: false };
    const roundTrip: JsonValue = object;
    expect((roundTrip as JsonObject).list).toEqual(array);
  });
});
