// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";
import { STACKS } from "./stacks.mjs";
import { runTrial, startTool } from "./trial-runner.mjs";

/** Minimal child-process stand-in with on/exit/error handlers. */
function fakeChild() {
	const handlers = {};
	return {
		handlers,
		killed: false,
		killSignal: null,
		on(event, fn) {
			handlers[event] = fn;
		},
		kill(signal) {
			this.killed = true;
			this.killSignal = signal;
		},
		emit(event, arg) {
			handlers[event]?.(arg);
		},
	};
}

/** Builds a probes object of recording fakes; override fields per test. */
function fakeProbes(overrides = {}) {
	const calls = { startTool: [], pollUrls: [], stopStack: [], portsFree: [] };
	const child = fakeChild();
	const probes = {
		startTool: (tool, stackKey, dir) => {
			calls.startTool.push([tool, stackKey, dir]);
			return child;
		},
		pollUrls: async (urls, timeoutMs, intervalMs, isAborted) => {
			calls.pollUrls.push([urls, timeoutMs, intervalMs, isAborted]);
			return true;
		},
		stopStack: async (tool, stackKey, dir) => {
			calls.stopStack.push([tool, stackKey, dir]);
		},
		waitForPortsFree: async (ports) => {
			calls.portsFree.push(ports);
		},
		now: () => 0,
		...overrides,
	};
	return { probes, calls, child };
}

test("startTool rejects an unsupported tool", () => {
	assert.throws(() => startTool("podman", "demo", "/tmp"), {
		message: "Unsupported tool: podman",
	});
});

test("runTrial rejects an unknown stack without starting a tool", async () => {
	const { probes, calls } = fakeProbes();
	await assert.rejects(
		runTrial("flisk", "no-such-stack", "/tmp", 5000, probes),
		{
			message: "Unknown stack: no-such-stack",
		},
	);
	assert.equal(calls.startTool.length, 0);
});

test("runTrial returns elapsed seconds from the injected clock", async () => {
	const times = [1000, 1600];
	const { probes, calls, child } = fakeProbes({ now: () => times.shift() });

	const elapsed = await runTrial("flisk", "demo", "/tmp/work", 5000, probes);
	assert.equal(elapsed, 0.6);

	const [urls, timeoutMs, intervalMs, isAborted] = calls.pollUrls[0];
	assert.deepEqual(urls, STACKS.demo.urls);
	assert.equal(timeoutMs, 5000);
	assert.equal(intervalMs, 50);
	assert.equal(typeof isAborted, "function");

	assert.deepEqual(calls.stopStack, [["flisk", "demo", "/tmp/work"]]);
	assert.deepEqual(calls.portsFree, [STACKS.demo.ports]);
	assert.equal(child.killed, true);
	assert.equal(child.killSignal, "SIGTERM");
});

test("runTrial still cleans up when the stack never becomes healthy", async () => {
	const { probes, calls } = fakeProbes({ pollUrls: async () => false });
	await assert.rejects(
		runTrial("compose", "agent-stack", "/tmp/work", 7000, probes),
		{
			message:
				"compose stack 'agent-stack' failed to become healthy within 7000ms",
		},
	);
	assert.deepEqual(calls.stopStack, [["compose", "agent-stack", "/tmp/work"]]);
	assert.deepEqual(calls.portsFree, [STACKS["agent-stack"].ports]);
});

test("runTrial reports a spawn error surfaced through isAborted", async () => {
	const { probes, child } = fakeProbes({
		pollUrls: async (_urls, _t, _i, isAborted) => {
			child.emit("error", new Error("ENOENT docker"));
			return isAborted();
		},
	});
	await assert.rejects(runTrial("compose", "demo", "/tmp/work", 5000, probes), {
		message: "compose failed to spawn: ENOENT docker",
	});
});

test("runTrial aborts polling when a flisk child exits but not a compose child", async () => {
	for (const [tool, expectedAbort] of [
		["flisk", true],
		["compose", false],
	]) {
		let aborted = null;
		const { probes, child } = fakeProbes({
			pollUrls: async (_urls, _t, _i, isAborted) => {
				child.emit("exit");
				aborted = isAborted();
				return false;
			},
		});
		await assert.rejects(
			runTrial(tool, "demo", "/tmp/work", 5000, probes),
			/failed to become healthy/,
		);
		assert.equal(aborted, expectedAbort, `${tool} abort flag`);
	}
});
