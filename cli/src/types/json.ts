// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

export type JsonValue = string | number | boolean | null | JsonArray | JsonObject;

export interface JsonArray extends Array<JsonValue> {}
export interface JsonObject extends Record<string, JsonValue> {}
