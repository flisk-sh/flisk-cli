// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * Trial runner for the compose-comparison benchmark.
 * Starts the tool under test, probes stack URLs until ready, stops the stack,
 * and reports wall time. Probes are injectable so tests run without Docker.
 */

import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { connect } from "node:net";
import { delimiter, join } from "node:path";
import { CLI_PATH } from "./paths.mjs";
import { STACKS } from "./stacks.mjs";

/** Resolves a bare command name to an absolute path through PATH, or null. */
function findOnPath(name) {
	const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE").split(";") : [""];
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		for (const ext of extensions) {
			const candidate = join(dir, name + ext);
			try {
				accessSync(candidate, constants.X_OK);
				return candidate;
			} catch {}
		}
	}
	return null;
}

const DOCKER_BIN = findOnPath("docker") ?? "docker";

/** Polls an array of URLs concurrently until every URL answers HTTP 200 or timeout is exceeded. */
export async function pollUrls(
	urls,
	timeoutMs = 60000,
	pollIntervalMs = 50,
	isAborted = () => false,
) {
	const start = Date.now();
	const remaining = new Set(urls);

	while (Date.now() - start < timeoutMs) {
		if (isAborted()) {
			return false;
		}
		await Promise.all(
			Array.from(remaining).map(async (url) => {
				try {
					const controller = new AbortController();
					const timeout = setTimeout(() => controller.abort(), 200);
					const res = await fetch(url, { signal: controller.signal });
					clearTimeout(timeout);
					if (res.status === 200) {
						remaining.delete(url);
					}
				} catch {
					// Pending connection or refused; retry on next tick
				}
			}),
		);

		if (remaining.size === 0) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}

	return false;
}

/** Waits until given TCP ports are free (not listening). */
export async function waitForPortsFree(ports, timeoutMs = 10000) {
	const start = Date.now();
	for (const port of ports) {
		while (Date.now() - start < timeoutMs) {
			const inUse = await new Promise((resolve) => {
				const client = connect({ port, host: "127.0.0.1" }, () => {
					client.end();
					resolve(true);
				});
				client.on("error", () => resolve(false));
				client.setTimeout(200, () => {
					client.destroy();
					resolve(false);
				});
			});
			if (!inUse) break;
			await new Promise((r) => setTimeout(r, 100));
		}
	}
}

/** Launches the tool under test for one trial and returns its child process. */
export function startTool(tool, stackKey, testDir) {
	if (tool === "flisk") {
		// Spawn flisk up (local native orchestrator)
		return spawn(process.execPath, [CLI_PATH, "up", "--quiet"], {
			cwd: testDir,
			stdio: "ignore",
			env: {
				...process.env,
				NO_COLOR: "1",
				FLISK_HTTP_PORT: "18080",
			},
		});
	}
	if (tool === "compose") {
		// Plain docker compose up -d
		return spawn(
			DOCKER_BIN,
			["compose", "-p", `flisk-bench-${stackKey}`, "up", "-d"],
			{
				cwd: testDir,
				stdio: "ignore",
			},
		);
	}
	throw new Error(`Unsupported tool: ${tool}`);
}

/** Stops running stack cleanly. */
export async function stopStack(tool, stackKey, testDir) {
	try {
		if (tool === "flisk") {
			spawnSync(process.execPath, [CLI_PATH, "down"], {
				cwd: testDir,
				stdio: "ignore",
				timeout: 15000,
			});
		} else if (tool === "compose") {
			spawnSync(
				DOCKER_BIN,
				["compose", "-p", `flisk-bench-${stackKey}`, "down", "-v"],
				{
					cwd: testDir,
					stdio: "ignore",
					timeout: 15000,
				},
			);
		}
	} catch {}
}

/** Real probe implementations injected into runTrial by default. */
export const defaultProbes = {
	startTool,
	pollUrls,
	waitForPortsFree,
	stopStack,
	now: () => performance.now(),
};

/**
 * Runs a single measured start trial.
 * Spawns the tool, polls target URLs until ready, and calculates wall time.
 * Pass a `probes` object to substitute fakes for start, poll, stop, port wait
 * and the clock (used by tests; production uses defaultProbes).
 */
export async function runTrial(
	tool,
	stackKey,
	testDir,
	timeoutMs = 60000,
	probes = defaultProbes,
) {
	const stack = STACKS[stackKey];
	if (!stack) throw new Error(`Unknown stack: ${stackKey}`);

	// Record start timestamp
	const startTime = probes.now();
	let child = null;
	let spawnError = null;
	let childExited = false;

	try {
		child = probes.startTool(tool, stackKey, testDir);

		child.on("error", (err) => {
			spawnError = err;
		});
		child.on("exit", () => {
			childExited = true;
		});

		// Poll all target URLs until HTTP 200, checking if process failed prematurely
		const ready = await probes.pollUrls(
			stack.urls,
			timeoutMs,
			50,
			() => spawnError !== null || (childExited && tool === "flisk"),
		);
		const endTime = probes.now();

		if (spawnError) {
			throw new Error(`${tool} failed to spawn: ${spawnError.message}`);
		}

		if (!ready) {
			throw new Error(
				`${tool} stack '${stackKey}' failed to become healthy within ${timeoutMs}ms`,
			);
		}

		const elapsedSeconds = (endTime - startTime) / 1000;
		return elapsedSeconds;
	} finally {
		if (child && !child.killed) {
			try {
				child.kill("SIGTERM");
			} catch {}
		}
		// Clean up after the run
		await probes.stopStack(tool, stackKey, testDir);
		await probes.waitForPortsFree(stack.ports);
	}
}
