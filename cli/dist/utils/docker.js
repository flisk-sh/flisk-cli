// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { findOnPath } from "./which.js";
// A wedged daemon makes `docker ps` block forever instead of failing.
const RUNTIME_CHECK_TIMEOUT_MS = 10_000;
/** Whether Docker, Colima, or Podman is reachable, hung, or absent. */
export function getContainerRuntimeStatus() {
    let sawTimeout = false;
    if (process.platform === "win32") {
        try {
            execFileSync(findOnPath("docker") ?? "docker", ["ps"], {
                stdio: "ignore",
                timeout: RUNTIME_CHECK_TIMEOUT_MS,
                windowsHide: true,
            });
            return "running";
        }
        catch (err) {
            return err.code === "ETIMEDOUT" ? "unresponsive" : "missing";
        }
    }
    for (const command of ["docker ps", "colima status", "podman ps"]) {
        try {
            execSync(command, { stdio: "ignore", timeout: RUNTIME_CHECK_TIMEOUT_MS });
            return "running";
        }
        catch (err) {
            if (err.code === "ETIMEDOUT")
                sawTimeout = true;
        }
    }
    return sawTimeout ? "unresponsive" : "missing";
}
/** What `docker ps` says when a daemon is there but this user cannot use it, or the CLI context is wrong. */
const DOCKER_ACCESS_ERROR = /permission denied|access is denied|unauthorized|authentication required|login required|context .*(not found|does not exist)|no such context/i;
/**
 * Whether `docker ps` failed for a reason other than "no daemon": a socket permission error, a failed
 * authentication, or a bad Docker context. `getContainerRuntimeStatus()` reports all of those as "missing",
 * but containers may well be running, so callers must not read that as "the runtime is stopped" (#5029).
 */
export function dockerProbeFailedWithAccessError() {
    try {
        const result = spawnSync(findOnPath("docker") ?? "docker", ["ps"], {
            encoding: "utf8",
            timeout: RUNTIME_CHECK_TIMEOUT_MS,
            windowsHide: true,
        });
        if (result.status === 0)
            return false;
        return DOCKER_ACCESS_ERROR.test(`${result.stderr ?? ""}`);
    }
    catch {
        return false;
    }
}
