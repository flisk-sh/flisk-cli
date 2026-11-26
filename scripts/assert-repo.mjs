// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** Require an owner/name repo string before it reaches gh or a file. */
export const assertRepo = (r) => {
	if (typeof r !== "string" || !REPO_RE.test(r)) throw new Error(`expected owner/name, got ${JSON.stringify(r)}`);
	return r;
};
