// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  captureExit,
  describe,
  expect,
  it,
  upCommand,
  vi,
  writeSync,
} from "../../test-support/up.js";

describe("next-step hints for a failed flisk up", () => {
  async function failWithInvalidPort(args: string[]) {
    const tiltPort = process.env.TILT_PORT;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const out: string[] = [];
    vi.mocked(writeSync).mockClear();
    vi.mocked(writeSync).mockImplementation(((fd: number, data: string) => {
      if (fd === 1) out.push(String(data));
      return String(data).length;
    }) as typeof writeSync);
    const { exit } = captureExit();
    try {
      process.env.TILT_PORT = "abc";
      await expect(upCommand.parseAsync(args, { from: "user" })).rejects.toThrow("process.exit");
      return {
        stderr: error.mock.calls.map((call) => String(call[0])).join("\n"),
        stdout: out.join(""),
      };
    } finally {
      if (tiltPort === undefined) delete process.env.TILT_PORT;
      else process.env.TILT_PORT = tiltPort;
      exit.mockRestore();
      error.mockRestore();
      vi.mocked(writeSync).mockReset();
    }
  }

  it("suggests unsetting an invalid TILT_PORT", async () => {
    const { stderr } = await failWithInvalidPort([]);
    expect(stderr).toContain('Invalid TILT_PORT "abc"');
    expect(stderr).toContain("unset TILT_PORT");
  });

  it("carries the hint in --json as the error's suggestions, not in the message", async () => {
    const { stdout } = await failWithInvalidPort(["--json"]);
    const envelope = JSON.parse(stdout.trim().split("\n")[0] ?? "{}");
    const entry = envelope.errors[0];
    expect(entry.code).toBe("INVALID_TILT_PORT");
    expect(entry.suggestions).toEqual(["Unset it to use the default port: unset TILT_PORT"]);
    expect(entry.message).not.toContain("unset TILT_PORT");
  });
});
