// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Every actions/upload-artifact step bounds how long its artifact lives with `retention-days:`; without one the
// repository default applies (#3909: thousands of same-run results and reports piled up into gigabytes of live
// artifacts nobody reads). An artifact only read inside its own run gets a one-day budget like cli-tarball; named
// entries in BUDGETS carry their own ceiling (benchmark histories keep months); anything unlisted gets
// DEFAULT_BUDGET. A step whose retention is an expression cannot be checked and is not a finding. Steps are read
// from .github/workflows and the composite actions in .github/actions. A gate at zero.
import YAML from "yaml";
import { read, walk } from "./lib.mjs";
import { usesSteps, workflowFiles } from "./workflow-permissions.mjs";

export const meta = {
	id: "artifact-retention",
	title: "actions/upload-artifact steps declare a bounded retention-days",
	source: "files",
	mode: "gate",
	target: 0,
	better: "lower",
	unit: "uploads",
};

// Days an artifact may outlive the run that wrote it, keyed by the name up to the first "${{". Same-run artifacts
// (downloaded by a later job in the same run, or never downloaded at all) get days at most; the benchmark histories a
// trend chart reads back keep their long budgets.
export const BUDGETS = {
	"cli-tarball": 1,
	"flisk-import-tarball": 1,
	"unit-test-results": 1,
	"benchmark-report": 1,
	"oracle-failures": 1,
	"cli-coverage-html": 3,
	"time-to-healthy-stack": 7,
	"agent-recovery-benchmark": 7,
	"bug-hunt-ledger": 7,
	"ts-compiler-benchmark": 90,
	"shop-bench": 400,
};

// Ceiling for an artifact not listed in BUDGETS; a longer-lived one names its budget there.
export const DEFAULT_BUDGET = 30;

// The artifact name without its expression parts: "e2e-x-${{ github.run_id }}" and "e2e-x" share one budget.
export const artifactKey = (name) => {
  const base = name.split("${{")[0].trimEnd();
  let end = base.length;
  while (end > 0 && (base[end - 1] === "-" || base[end - 1] === "_")) end--;
  return base.slice(0, end);
};

export const budgetOf = (name) => BUDGETS[artifactKey(name)] ?? DEFAULT_BUDGET;

// Every upload-artifact step of one workflow or action.yml: { line, where, name, retention } (retention is the raw
// scalar, null when unset).
export function uploadSteps(text) {
	const { error, steps } = usesSteps(text, /^actions\/upload-artifact@/);
	if (error) return { error, steps: [] };
	return {
		steps: steps.map(({ line, where, inputs }) => {
			const name = YAML.isMap(inputs) ? inputs.get("name") : undefined;
			const retention = YAML.isMap(inputs) ? inputs.get("retention-days") : undefined;
			return {
				line,
				where,
				name: name === undefined || name === null ? null : String(name),
				retention: retention === undefined || retention === null ? null : String(retention),
			};
		}),
	};
}

export function measure({ root }) {
	const files = [...workflowFiles(root), ...walk(root, ".github/actions", (rel) => /\/action\.ya?ml$/.test(rel))];
	const findings = [];
	let total = 0;
	for (const file of files) {
		const { error, steps } = uploadSteps(read(root, file));
		if (error) {
			findings.push(`${file}:1 does not parse as YAML (${error})`);
			continue;
		}
		for (const step of steps) {
			total++;
			const label = step.name ?? "(unnamed)";
			if (step.retention === null) {
				findings.push(
					`${file}:${step.line} ${step.where}: upload-artifact ${label} has no retention-days (the repository default applies)`,
				);
				continue;
			}
			const days = Number(step.retention);
			if (!Number.isFinite(days)) continue;
			const budget = budgetOf(label);
			if (days > budget)
				findings.push(
					`${file}:${step.line} ${step.where}: upload-artifact ${label} keeps ${days} days over its ${budget}-day budget`,
				);
		}
	}
	return {
		value: findings.length,
		summary: `${total} upload-artifact steps, ${findings.length} over budget or unbounded`,
		findings,
	};
}
