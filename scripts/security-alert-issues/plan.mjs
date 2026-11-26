// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Sync planning for scripts/security-alert-issues.mjs: which managed issues to
// create, update, reopen or close, and which labels to create first.
//   node --test scripts/security-alert-issues/plan.test.mjs
import { groupFindings, groupKey, parseMarker } from "./alerts.mjs";
import { bodyFor, colorForLabel, isManagedLabel, LABEL_DEFS, labelsFor } from "./issues.mjs";

/**
 * What to do for every managed issue and every open finding.
 * `managed` are the issues carrying MANAGED_LABEL, `findings` the open alerts.
 */
export function planSync(findings, managed) {
	// One finding per group: the same advisory in two sources is one thing to fix.
	const open = new Map();
	for (const group of groupFindings(findings)) {
		open.set(groupKey(group), group[0]);
	}
	const byMarker = new Map();
	for (const issue of managed) {
		const parsed = parseMarker(issue.body ?? "");
		if (parsed) byMarker.set(parsed.key, issue);
	}
	const actions = [];
	for (const group of groupFindings(findings)) {
		// The first finding of the group leads it; the others are the same fix.
		const finding = group[0];
		const key = groupKey(group);
		const existing = byMarker.get(key);
		if (!existing) {
			actions.push({ action: "create", finding, issue: null });
			continue;
		}
		const body = bodyFor(finding, findings);
		const labels = labelsFor(finding);
		if (existing.state === "closed") {
			actions.push({ action: "reopen", finding, issue: existing, body, labels });
		} else if ((existing.body ?? "") !== body || !sameLabels(existing.labels ?? [], labels)) {
			actions.push({ action: "update", finding, issue: existing, body, labels });
		} else {
			actions.push({ action: "unchanged", finding, issue: existing, body, labels });
		}
	}
	for (const [key, issue] of byMarker) {
		if (open.has(key)) continue;
		actions.push({ action: "close", finding: null, issue });
	}
	return actions;
}

/** Label comparison that ignores order. */
export function sameLabels(a, b) {
	const left = [...new Set(a)].sort((x, y) => x.localeCompare(y));
	const right = [...new Set(b)].sort((x, y) => x.localeCompare(y));
	return left.length === right.length && left.every((label, i) => label === right[i]);
}

/** Create the labels this script applies, so a label is never silently dropped. */
export function planLabels(findings) {
	const wanted = new Map();
	for (const [name, def] of Object.entries(LABEL_DEFS)) {
		wanted.set(name, { color: def.color, description: def.description });
	}
	for (const finding of findings) {
		for (const label of labelsFor(finding)) {
			if (wanted.has(label)) continue;
			wanted.set(label, {
				color: colorForLabel(label),
				description: "Applied by the security-alert-issues workflow",
			});
		}
	}
	return wanted;
}

/**
 * The label set an issue ends up with: the labels this script manages, replaced, and
 * every other label the issue already carries.
 *
 * The API takes names, and an issue's own labels come back as objects, so they are
 * read by name first. Sending an object where a name belongs is a 422.
 */
export function finalLabelSet(currentLabels, wanted, managed) {
	const current = (currentLabels ?? [])
		.map((label) => (typeof label === "string" ? label : label?.name))
		.filter(Boolean);
	return [...new Set([...current.filter((label) => !isManagedLabel(label, managed)), ...wanted])];
}
