// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";
import { getEnvironmentInfo } from "./environment.mjs";

test("getEnvironmentInfo collects tool versions through the injected exec", () => {
	const commands = [];
	const fakeExec = (cmd) => {
		commands.push(cmd);
		if (cmd.startsWith("docker version")) return "29.8.2\n";
		if (cmd.startsWith("docker compose version")) return "v5.5.1\n";
		if (cmd.startsWith("node ") && cmd.includes("--version")) return "1.4.72\n";
		if (cmd.startsWith("tilt version")) return "v0.36.0\n";
		throw new Error(`unexpected command: ${cmd}`);
	};

	const info = getEnvironmentInfo(fakeExec);
	assert.equal(info.dockerEngine, "29.8.2");
	assert.equal(info.dockerCompose, "v5.5.1");
	assert.equal(info.flisk, "1.4.72");
	assert.equal(info.tilt, "v0.36.0");
	assert.equal(commands.length, 4);
});

test("getEnvironmentInfo reports unavailable when every probe fails", () => {
	const info = getEnvironmentInfo(() => {
		throw new Error("not installed");
	});
	assert.equal(info.dockerEngine, "unavailable");
	assert.equal(info.dockerCompose, "unavailable");
	assert.equal(info.flisk, "unavailable");
	assert.equal(info.tilt, "unavailable");
});

test("getEnvironmentInfo reports machine and runtime metadata", () => {
	const info = getEnvironmentInfo(() => {
		throw new Error("not installed");
	});
	assert.match(info.date, /^\d{4}-\d{2}-\d{2}$/);
	assert.ok(info.machine.includes("cores"));
	assert.ok(info.machine.includes("GB RAM"));
	assert.equal(typeof info.cpuCount, "number");
	assert.equal(typeof info.memoryGb, "number");
	assert.ok(info.os.includes(process.platform));
	assert.equal(info.arch, process.arch);
	assert.equal(info.nodeVersion, process.version);
});
