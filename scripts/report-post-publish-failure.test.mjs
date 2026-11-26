// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileIssue, issueBody, issueTitle } from "./report-post-publish-failure.mjs";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const RUN = "https://github.com/flisk-sh/flisk-cli/actions/runs/42";

test("issueTitle names the package and version", () => {
	assert.equal(issueTitle("1.4.99"), "Post-publish npm smoke failed: @flisk-sh/flisk@1.4.99");
});

test("issueBody names the commit, the run and what the job checks", () => {
	const body = issueBody({ version: "1.4.99", commit: COMMIT, runUrl: RUN });
	assert.match(body, /@flisk-sh\/flisk@1\.4\.99/);
	assert.match(body, new RegExp(COMMIT));
	assert.match(body, new RegExp(RUN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.match(body, /cli\/dist-bundle/);
});

// A fake issue store: list() shows open issues, create/comment/close mutate it.
function store(open = []) {
	return {
		open: [...open],
		comments: [],
		list() {
			return this.open.map((n) => ({ number: n, title: issueTitle("1.4.99") }));
		},
		comment(n, body) {
			this.comments.push([n, body]);
		},
		create(title, body) {
			const n = Math.max(0, ...this.open) + 1;
			this.open.push(n);
			return n;
		},
		close(n, canonical) {
			this.open = this.open.filter((x) => x !== n);
			this.closedTo = [n, canonical];
		},
	};
}

test("no open issue: files one", () => {
	const api = store();
	const n = fileIssue({ version: "1.4.99", commit: COMMIT, runUrl: RUN }, api);
	assert.equal(n, 1);
	assert.deepEqual(api.open, [1]);
	assert.deepEqual(api.comments, []);
});

test("an open issue for this version gets the new run as a comment, not a second issue", () => {
	const api = store([7]);
	const n = fileIssue({ version: "1.4.99", commit: COMMIT, runUrl: RUN }, api);
	assert.equal(n, 7);
	assert.deepEqual(api.open, [7]);
	assert.deepEqual(api.comments, [[7, `Failed again: ${RUN}`]]);
});

test("a create that raced a sibling closes itself in favour of the older issue", () => {
	// The first list() is empty; between it and the second list() a sibling files issue 2
	// and we file issue 5. canonicalIssue then points at 2, so we close our own 5.
	const calls = [];
	const api = {
		list: () => {
			calls.push("list");
			if (calls.filter((c) => c === "list").length === 2) {
				return [2, 5].map((n) => ({ number: n, title: issueTitle("1.4.99") }));
			}
			return [];
		},
		comment: (n, body) => calls.push(`comment ${n}: ${body}`),
		create: () => 5,
		close: (n, canonical) => calls.push(`close ${n} -> ${canonical}`),
	};
	const n = fileIssue({ version: "1.4.99", commit: COMMIT, runUrl: RUN }, api);
	assert.equal(n, 2);
	assert.deepEqual(calls.slice(2), [`comment 2: Failed again: ${RUN}`, "close 5 -> 2"]);
});
