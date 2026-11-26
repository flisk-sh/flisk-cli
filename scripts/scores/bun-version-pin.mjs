// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// CI must test the Bun version the release builds ship. The version lives in .bun-version; .github/actions/setup-bun
// reads it, workflows that call oven-sh/setup-bun directly read the same file, and only the nightly adopters canary is
// allowed to run `latest` (so a new Bun is noticed without flipping every pull request red). A duplicated literal makes
// that promise easy to break on the next Bun bump, so gate at zero.
import YAML from "yaml";
import { has, read, walk } from "./lib.mjs";

export const meta = {
	id: "bun-version-pin",
	title: "Every CI job uses the Bun version pinned in .bun-version",
	source: "files",
	mode: "gate",
	target: 0,
	better: "lower",
	unit: "problems",
};

const PIN_FILE = ".bun-version";
const COMPOSITE = ".github/actions/setup-bun/action.yml";
const COMPOSITE_USES = "./.github/actions/setup-bun";
const CANARY_WORKFLOW = ".github/workflows/nightly-adopters.yml";
const VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const isSetupBun = (uses) => typeof uses === "string" && uses.startsWith("oven-sh/setup-bun@");
const isBunStep = (uses) => isSetupBun(uses) || uses === COMPOSITE_USES;
// A sparse-checkout job can read the same file from a subdirectory (byo-template-e2e.yml checks out into `flisk/`).
const isPinFile = (value) => typeof value === "string" && (value === PIN_FILE || value.endsWith(`/${PIN_FILE}`));
const sparseHasPin = (value) => {
	const paths = typeof value === "string" ? value.split("\n") : Array.isArray(value) ? value : [];
	return paths.some((p) => String(p).trim() === PIN_FILE);
};

// YAML errors are findings too: a workflow that does not parse cannot be checked for its Bun version.
const parse = (file, text, out) => {
	try {
		return YAML.parse(text);
	} catch (error) {
		out.push(`${file}: does not parse as YAML (${String(error.message ?? error).split("\n")[0]})`);
		return null;
	}
};

export function pinProblems(root) {
	const out = [];
	const pin = read(root, PIN_FILE).trim();
	if (!has(root, PIN_FILE)) out.push(`${PIN_FILE}: missing shared Bun version file`);
	else if (!VERSION.test(pin)) out.push(`${PIN_FILE}: expected one Bun version, got ${JSON.stringify(pin)}`);

	const action = parse(COMPOSITE, read(root, COMPOSITE), out);
	if (action) {
		const step = action.runs?.steps?.find((s) => isSetupBun(s?.uses));
		if (!step) out.push(`${COMPOSITE}: no oven-sh/setup-bun step`);
		else {
			if (step.with?.["bun-version-file"] !== PIN_FILE)
				out.push(`${COMPOSITE}: setup-bun must read ${PIN_FILE}`);
			if (step.with?.["bun-version"] !== undefined)
				out.push(`${COMPOSITE}: setup-bun must not override ${PIN_FILE}`);
		}
		if (Object.keys(action.inputs ?? {}).includes("bun-version"))
			out.push(`${COMPOSITE}: bun-version input duplicates ${PIN_FILE}`);
	}

	const workflows = walk(root, ".github/workflows", (rel) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(rel));
	for (const file of workflows) {
		const workflow = parse(file, read(root, file), out);
		if (!workflow) continue;
		for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
			const steps = definition?.steps ?? [];
			for (const [index, step] of steps.entries()) {
				const where = `${file}: job ${job} step ${index + 1}`;
				const stepWith = step?.with ?? {};
				if (!isBunStep(step?.uses)) continue;
				const version = stepWith["bun-version"];
				const versionFile = stepWith["bun-version-file"];
				if (file === CANARY_WORKFLOW && (version === "latest" || version === "canary")) continue;
				if (version !== undefined) out.push(`${where}: bun-version duplicates ${PIN_FILE}`);
				// The composite reads the file itself; a direct setup-bun step must name it.
				if (isSetupBun(step.uses)) {
					if (!isPinFile(versionFile)) {
						out.push(`${where}: direct setup-bun must read ${PIN_FILE}`);
					} else if (versionFile !== PIN_FILE) {
						const subdir = versionFile.slice(0, -PIN_FILE.length - 1);
						const checkedOut = steps.some(
							(s) =>
								String(s?.uses ?? "").startsWith("actions/checkout@") &&
								s?.with?.path === subdir &&
								sparseHasPin(s.with?.["sparse-checkout"]),
						);
						if (!checkedOut) out.push(`${where}: ${versionFile} is not included in a sparse checkout`);
					}
				}
			}
		}
	}
	return out;
}

export function measure({ root }) {
	const findings = pinProblems(root);
	return {
		value: findings.length,
		summary: `${findings.length} Bun version pin problems`,
		findings,
	};
}
