// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it } from "vitest";

import { forgetShownError, lastShownError, rememberShownError } from "../last-error.js";

describe("lastShownError", () => {
  beforeEach(() => {
    forgetShownError();
  });

  it("is undefined before anything is remembered", () => {
    expect(lastShownError()).toBeUndefined();
  });

  it("returns the error rememberShownError stored", () => {
    const error = { message: "Stack not found", suggestions: ["Run flisk stacks"] };
    rememberShownError(error);
    expect(lastShownError()).toBe(error);
  });

  it("is replaced by a second rememberShownError", () => {
    rememberShownError({ message: "first", suggestions: [] });
    const second = { message: "second", suggestions: ["try again"] };
    rememberShownError(second);
    expect(lastShownError()).toBe(second);
  });

  it("is cleared by forgetShownError", () => {
    rememberShownError({ message: "boom", suggestions: [] });
    forgetShownError();
    expect(lastShownError()).toBeUndefined();
  });
});
