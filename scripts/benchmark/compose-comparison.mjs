#!/usr/bin/env node
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * Benchmark harness: Flisk up vs plain Docker Compose up on 3 sample stacks (#3297).
 *
 * Stacks evaluated:
 * 1. demo: Web frontend + API backend
 * 2. backend-postgres: Node API backend + PostgreSQL database
 * 3. agent-stack: AI Agent service + Mock LLM Model / Tools server
 *
 * Measurements:
 * - Timed from command launch (T0) to "every URL answers HTTP 200" (T1).
 * - Cold runs: clean state, no cached local containers/volumes.
 * - Warm runs: second/subsequent start with cached layers/volumes.
 * - Records sample count (N), minimum, maximum, median (p50), and p90.
 *
 * This entrypoint only parses options and orchestrates. Stack fixtures live in
 * compose-comparison/stacks.mjs, the measured trial and its probes in
 * compose-comparison/trial-runner.mjs, statistics in
 * compose-comparison/statistics.mjs, environment discovery in
 * compose-comparison/environment.mjs, and the Markdown report in
 * compose-comparison/report.mjs.
 */

import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getEnvironmentInfo } from "./compose-comparison/environment.mjs";
import { CLI_PATH } from "./compose-comparison/paths.mjs";
import { formatMarkdownReport } from "./compose-comparison/report.mjs";
import { STACKS } from "./compose-comparison/stacks.mjs";
import { calculateStats } from "./compose-comparison/statistics.mjs";
import { runTrial } from "./compose-comparison/trial-runner.mjs";

// Re-exported so existing importers of this entrypoint keep working.
export { getEnvironmentInfo } from "./compose-comparison/environment.mjs";
export { formatMarkdownReport } from "./compose-comparison/report.mjs";
export { STACKS } from "./compose-comparison/stacks.mjs";
export { calculateStats } from "./compose-comparison/statistics.mjs";
export {
	pollUrls,
	runTrial,
	stopStack,
	waitForPortsFree,
} from "./compose-comparison/trial-runner.mjs";

// CLI Execution entrypoint
async function main() {
	const { values } = parseArgs({
		options: {
			help: { type: "boolean", short: "h" },
			runs: { type: "string", default: "3" },
			warmup: { type: "string", default: "1" },
			stacks: { type: "string", default: "demo,backend-postgres,agent-stack" },
			"timeout-ms": { type: "string", default: "60000" },
			output: { type: "string" },
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	if (values.help) {
		console.log(`Usage: node scripts/benchmark/compose-comparison.mjs [options]

Options:
  --runs <count>       Measured runs per stack and tool (default: 3)
  --warmup <count>     Warmup runs before measurement (default: 1)
  --stacks <list>      Comma-separated stacks: demo,backend-postgres,agent-stack
  --timeout-ms <ms>    Per-run readiness timeout (default: 60000)
  --output <path>      JSON file output path
  --json               Output JSON result only
  -h, --help           Show this help message`);
		process.exit(0);
	}

	if (!existsSync(CLI_PATH)) {
		console.error(
			`Error: Flisk CLI binary not found at ${CLI_PATH}.\nPlease build the CLI first with:\n  npm --prefix cli run build\n`,
		);
		process.exit(1);
	}

	const runs = Number(values.runs);
	const warmup = Number(values.warmup);
	const timeoutMs = Number(values["timeout-ms"]);
	const stackKeys = values.stacks.split(",").map((s) => s.trim());
	const envInfo = getEnvironmentInfo();

	if (!values.json) {
		console.log("=== Flisk vs Docker Compose Benchmark ===");
		console.log(`Machine:  ${envInfo.machine}`);
		console.log(`OS:       ${envInfo.os}`);
		console.log(
			`Docker:   Engine ${envInfo.dockerEngine}, Compose ${envInfo.dockerCompose}`,
		);
		console.log(`Flisk:    v${envInfo.flisk}`);
		console.log(`Runs:     ${runs} measured (${warmup} warmup)\n`);
	}

	const results = [];

	for (const stackKey of stackKeys) {
		const stackDef = STACKS[stackKey];
		if (!stackDef) {
			console.warn(`Warning: unknown stack '${stackKey}', skipping.`);
			continue;
		}

		if (!values.json) {
			console.log(`\n▶ Benchmarking Stack: ${stackDef.name}`);
		}

		// Prepare isolated temporary project directory
		const baseDir = mkdtempSync(join(tmpdir(), `flisk-bench-${stackKey}-`));
		stackDef.setup(baseDir);

		// Warmup runs
		if (!values.json) process.stdout.write("  Warming up... ");
		for (let i = 0; i < warmup; i++) {
			await runTrial("flisk", stackKey, baseDir, timeoutMs);
			await runTrial("compose", stackKey, baseDir, timeoutMs);
		}
		if (!values.json) console.log("Done.");

		// Alternating trial execution to prevent ordering bias / thermal drift
		const fliskColdSamples = [];
		const fliskWarmSamples = [];
		const composeColdSamples = [];
		const composeWarmSamples = [];
		const trialOrderHistory = [];

		for (let i = 0; i < runs; i++) {
			const order = i % 2 === 0 ? ["flisk", "compose"] : ["compose", "flisk"];
			trialOrderHistory.push(order.join(" -> "));

			if (!values.json) {
				console.log(`  Trial ${i + 1}/${runs} (order: ${order.join(" -> ")})`);
			}

			for (const tool of order) {
				// Cold run: fresh isolated directory with pre-cached engine images
				const coldDir = mkdtempSync(
					join(tmpdir(), `bench-${stackKey}-${tool}-cold-${i}-`),
				);
				stackDef.setup(coldDir);
				const coldDuration = await runTrial(tool, stackKey, coldDir, timeoutMs);
				if (tool === "flisk") fliskColdSamples.push(coldDuration);
				else composeColdSamples.push(coldDuration);
				rmSync(coldDir, { recursive: true, force: true });

				// Warm run: repeated in prepared baseDir
				const warmDuration = await runTrial(tool, stackKey, baseDir, timeoutMs);
				if (tool === "flisk") fliskWarmSamples.push(warmDuration);
				else composeWarmSamples.push(warmDuration);

				if (!values.json) {
					console.log(
						`    [${tool}] cold: ${coldDuration.toFixed(3)}s, warm: ${warmDuration.toFixed(3)}s`,
					);
				}
			}
		}

		// Clean up baseDir
		rmSync(baseDir, { recursive: true, force: true });

		results.push({
			stack: stackKey,
			name: stackDef.name,
			description: stackDef.description,
			urls: stackDef.urls,
			trialOrder: trialOrderHistory,
			fliskCold: calculateStats(fliskColdSamples),
			fliskWarm: calculateStats(fliskWarmSamples),
			composeCold: calculateStats(composeColdSamples),
			composeWarm: calculateStats(composeWarmSamples),
		});
	}

	const benchmarkData = {
		date: envInfo.date,
		environment: envInfo,
		runs,
		warmup,
		results,
	};

	if (values.json) {
		console.log(JSON.stringify(benchmarkData, null, 2));
	} else {
		console.log(`\n${formatMarkdownReport(benchmarkData)}`);
	}

	if (values.output) {
		// Contain --output to the working directory: resolve against it, then require the prefix.
		const base = realpathSync(process.cwd());
		const outputPath = resolve(base, values.output);
		if (values.output.includes("\0") || !outputPath.startsWith(base + sep)) {
			throw new Error(`--output ${values.output} must stay inside the working directory`);
		}
		writeFileSync(outputPath, JSON.stringify(benchmarkData, null, 2));
		if (!values.json) console.log(`\nResults written to: ${outputPath}`);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error("Benchmark error:", err);
		process.exit(1);
	});
}
