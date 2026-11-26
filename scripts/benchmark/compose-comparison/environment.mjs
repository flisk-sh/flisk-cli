// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * Environment discovery for the compose-comparison benchmark.
 * Collects machine details and installed tool versions for the report header.
 */

import { execSync } from "node:child_process";
import { arch, cpus, release, totalmem } from "node:os";
import { CLI_PATH } from "./paths.mjs";

/** Discovers machine and runtime environment metadata. */
export function getEnvironmentInfo(exec = execSync) {
	let dockerEngine = "unavailable";
	let dockerCompose = "unavailable";
	let fliskVersion = "unavailable";
	let tiltVersion = "unavailable";

	try {
		dockerEngine = exec(
			"docker version --format '{{.Server.Version}}' 2>/dev/null",
			{ encoding: "utf8" },
		).trim();
	} catch {}
	try {
		dockerCompose = exec(
			"docker compose version --short 2>/dev/null || docker compose version 2>/dev/null",
			{ encoding: "utf8" },
		).trim();
	} catch {}
	try {
		fliskVersion = exec(`node "${CLI_PATH}" --version 2>/dev/null`, {
			encoding: "utf8",
		}).trim();
	} catch {}
	try {
		tiltVersion = exec("tilt version 2>/dev/null | head -1", {
			encoding: "utf8",
		}).trim();
	} catch {}

	const cpuList = cpus();
	const cpuModel = cpuList[0]?.model || "Apple Silicon";
	const memoryGb = Math.round(totalmem() / 1024 ** 3);

	return {
		date: new Date().toISOString().split("T")[0],
		machine: `${cpuModel} (${cpuList.length} cores, ${memoryGb} GB RAM)`,
		os: `${process.platform} ${release()} (${arch()})`,
		arch: arch(),
		cpuCount: cpuList.length,
		memoryGb,
		dockerEngine,
		dockerCompose,
		flisk: fliskVersion,
		tilt: tiltVersion,
		nodeVersion: process.version,
	};
}
