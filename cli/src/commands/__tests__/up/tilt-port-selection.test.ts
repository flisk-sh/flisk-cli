// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it, parseTiltPort, resolveTiltPort, vi } from "../../test-support/up.js";

describe("Tilt startup port selection", () => {
  it("accepts an unset port and valid boundary ports", () => {
    expect(parseTiltPort(undefined)).toEqual({ ok: true, port: undefined });
    expect(parseTiltPort("1")).toEqual({ ok: true, port: 1 });
    expect(parseTiltPort("65535")).toEqual({ ok: true, port: 65535 });
  });

  it.each(["0", "65536", "abc", "10350.5", "10350abc"])(
    "rejects invalid TILT_PORT value %s",
    (value) => {
      expect(parseTiltPort(value)).toEqual({
        ok: false,
        message: `Invalid TILT_PORT "${value}": expected an integer from 1 to 65535.`,
      });
    },
  );

  it("uses the configured port without probing for an alternative", async () => {
    const findAvailablePort = vi.fn(async () => 10351);

    await expect(
      resolveTiltPort({
        configuredPort: 10444,
        force: false,
        basePort: 10350,
        findAvailablePort,
      }),
    ).resolves.toEqual({ port: 10444, autoSwitched: false });
    expect(findAvailablePort).not.toHaveBeenCalled();
  });

  it("uses the next available port when no port is configured", async () => {
    const findAvailablePort = vi.fn(async () => 10351);

    await expect(
      resolveTiltPort({
        configuredPort: undefined,
        force: false,
        basePort: 10350,
        findAvailablePort,
      }),
    ).resolves.toEqual({ port: 10351, autoSwitched: true });
    expect(findAvailablePort).toHaveBeenCalledWith(10350, 10);
  });

  it("keeps the default port when force is set", async () => {
    const findAvailablePort = vi.fn(async () => 10351);

    await expect(
      resolveTiltPort({
        configuredPort: undefined,
        force: true,
        basePort: 10350,
        findAvailablePort,
      }),
    ).resolves.toEqual({ port: 10350, autoSwitched: false });
    expect(findAvailablePort).not.toHaveBeenCalled();
  });
});
