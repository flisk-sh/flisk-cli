// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";
import { formatMarkdownReport } from "./report.mjs";

const FIXED_DATA = {
	date: "2026-11-09",
	environment: {
		machine: "Apple M4 (10 cores, 24 GB RAM)",
		os: "darwin 25.5.0 (arm64)",
		dockerEngine: "29.8.2",
		dockerCompose: "v5.5.1",
		flisk: "1.4.45",
		nodeVersion: "v24.15.0",
	},
	runs: 3,
	warmup: 1,
	results: [
		{
			stack: "demo",
			name: "Demo (Web + API)",
			fliskCold: {
				count: 3,
				median: 0.32,
				p90: 0.35,
				samples: [0.31, 0.32, 0.35],
			},
			fliskWarm: {
				count: 3,
				median: 0.18,
				p90: 0.21,
				samples: [0.17, 0.18, 0.21],
			},
			composeCold: {
				count: 3,
				median: 2.45,
				p90: 2.6,
				samples: [2.4, 2.45, 2.6],
			},
			composeWarm: {
				count: 3,
				median: 1.85,
				p90: 1.95,
				samples: [1.8, 1.85, 1.95],
			},
		},
		{
			stack: "agent-stack",
			name: "Agent Stack",
			fliskCold: {
				count: 3,
				median: 0.512,
				p90: 0.611,
				samples: [0.5, 0.512, 0.611],
			},
			fliskWarm: {
				count: 3,
				median: 0.201,
				p90: 0.24,
				samples: [0.19, 0.201, 0.24],
			},
			composeCold: {
				count: 3,
				median: 3.102,
				p90: 3.44,
				samples: [3.0, 3.102, 3.44],
			},
			composeWarm: {
				count: 3,
				median: 2.201,
				p90: 2.3,
				samples: [2.1, 2.201, 2.3],
			},
		},
	],
};

const GOLDEN = [
	"# Benchmark: Flisk vs Docker Compose",
	"",
	"Measured for [#3297](https://github.com/flisk-sh/flisk/issues/3297). This report provides honest, reproducible startup latency figures for **Flisk** versus plain **Docker Compose** across three representative application stacks.",
	"",
	"## Test Methodology",
	"",
	"- **Readiness criteria**: Time is measured from command launch ($T_0$) to the exact millisecond when **every application URL returns HTTP 200 OK** ($T_1$). It is not merely process exit time.",
	"- **Cold start**: First execution in an isolated project workspace with no active containers or persistent volumes.",
	"- **Warm start**: Second/subsequent start in the prepared project workspace with images, layers, and packages already available.",
	"- **Statistical metrics**: Sample count ($N$), Median ($p_{50}$), and 90th percentile ($p_{90}$).",
	"",
	"## Environment",
	"",
	"- **Date**: 2026-11-09",
	"- **Machine**: Apple M4 (10 cores, 24 GB RAM)",
	"- **Operating System**: darwin 25.5.0 (arm64)",
	"- **Docker Engine**: 29.8.2",
	"- **Docker Compose**: v5.5.1",
	"- **Flisk**: 1.4.45",
	"- **Node.js**: v24.15.0",
	"",
	"## Results Summary",
	"",
	"| Stack | Mode | Cold Median | Cold p90 | Warm Median | Warm p90 | Samples (N) |",
	"| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
	"| **Demo (Web + API)** | **Flisk (Native)** | **0.320 s** | 0.350 s | **0.180 s** | 0.210 s | N=3 |",
	"| Demo (Web + API) | Docker Compose | 2.450 s | 2.600 s | 1.850 s | 1.950 s | N=3 |",
	"| **Agent Stack** | **Flisk (Native)** | **0.512 s** | 0.611 s | **0.201 s** | 0.240 s | N=3 |",
	"| Agent Stack | Docker Compose | 3.102 s | 3.440 s | 2.201 s | 2.300 s | N=3 |",
	"",
	"## Honest Analysis: Wins and Losses",
	"",
	"### Flisk Wins: Process-First Developer Velocity",
	"",
	"1. **Sub-second Local Startup**: In local process mode, `flisk up` launches native runtimes (Node, Bun, Python) directly with zero containerization overhead, consistently answering healthy in sub-second times.",
	"2. **Zero Virtualization Tax**: On macOS (Apple Silicon), Docker requires a LinuxKit VM (`com.docker.virtualization`). Container network bridge creation, volume mounts through VirtioFS, and daemon RPC overhead impose startup latency floors on Docker Compose.",
	"3. **Rapid Inner Loop**: Flisk connects local processes directly to supporting databases without waiting for container network bridge initialization.",
	"",
	"### Flisk Losses & Trade-offs: Container & Ingress Orchestration (Unmeasured Context)",
	"",
	"1. **Full Platform Overhead in Container Mode**: When Flisk runs in full container mode (`tilt up` + Traefik reverse proxy + golden layer engine), cold starts are heavier than plain Docker Compose due to Starlark specification evaluation and Traefik ingress initialization (note: full container mode is not measured by this native-process harness).",
	"2. **Docker Compose Simplicity**: For developers who already have pre-built Docker images and require strictly containerized isolation without reverse proxy routing or live-update monitors, plain Docker Compose starts bare containers with lower orchestration overhead.",
	"3. **Resource Footprint**: Docker Compose runs only the declared services, whereas a full Flisk container stack provisions supporting platform infrastructure (ingress proxy, database supervisor).",
	"",
	"## Reproducibility",
	"",
	"To reproduce these benchmarks on your machine:",
	"",
	"```bash",
	"node scripts/benchmark/compose-comparison.mjs --runs 3 --warmup 1",
	"```",
	"",
	"To run a specific stack:",
	"",
	"```bash",
	"node scripts/benchmark/compose-comparison.mjs --stacks demo --runs 3",
	"```",
].join("\n");

test("formatMarkdownReport renders the byte-identical golden report", () => {
	assert.equal(formatMarkdownReport(FIXED_DATA), GOLDEN);
});

test("formatMarkdownReport emits one table row per tool and stack", () => {
	const md = formatMarkdownReport(FIXED_DATA);
	const rows = md
		.split("\n")
		.filter(
			(l) =>
				l.startsWith("| ") && !l.startsWith("| Stack") && !l.startsWith("| :"),
		);
	assert.equal(rows.length, FIXED_DATA.results.length * 2);
	assert.ok(rows[0].includes("**Demo (Web + API)**"));
	assert.ok(rows[0].includes("**Flisk (Native)**"));
	assert.ok(rows[1].includes("Docker Compose"));
});

test("formatMarkdownReport handles an empty results list", () => {
	const md = formatMarkdownReport({ ...FIXED_DATA, results: [] });
	assert.ok(md.includes("# Benchmark: Flisk vs Docker Compose"));
	assert.ok(md.includes("## Results Summary"));
	assert.ok(!md.includes("Flisk (Native)"));
});
