// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	ADOPTERS_REL,
	PACKAGES,
	checkAdopters,
	publishedVersions,
	tableSection,
	validateRows,
	validateVersions,
} from "./check-adopters.mjs";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");

const doc = (rows) => `# Adopters\n\n## List\n\n| Organization | Link | Flisk version |\n| --- | --- | --- |\n${rows}\n`;
const row = (org, link, version) => `| ${org} | ${link} | ${version} |`;
const okRow = row("Acme", "https://example.com/acme", "1.4.0");

const check = (markdown, extra = {}) => checkAdopters({ markdown, checkLinks: false, ...extra });

describe("check-adopters", () => {
	it("accepts a table of well-formed rows", async () => {
		const { errors, warnings } = await check(doc(`${okRow}\n${row("Beta", "https://beta.example.com", "1.3.9")}`));
		assert.deepEqual(errors, []);
		assert.deepEqual(warnings, []);
	});

	it("accepts an empty table", async () => {
		assert.deepEqual((await check(doc(""))).errors, []);
	});

	it("rejects a row with the wrong number of columns", async () => {
		for (const bad of [
			"| Acme | https://example.com |",
			"| Acme | https://example.com | 1.4.0 | extra |",
			"| Acme |",
		]) {
			const { errors } = await check(doc(bad));
			assert.equal(errors.length, 1, bad);
			assert.match(errors[0], /columns/);
		}
	});

	it("rejects a row with an empty cell", async () => {
		for (const bad of [
			"| | https://example.com | 1.4.0 |",
			"| Acme | | 1.4.0 |",
			"| Acme | https://example.com | |",
		]) {
			const { errors } = await check(doc(bad));
			assert.equal(errors.length, 1, bad);
			assert.match(errors[0], /empty cell/);
		}
	});

	it("does not end the table on text that only starts with a hash", async () => {
		const { errors } = await check(doc(`${okRow}\n#not-a-heading\n| Beta | http://beta.example.com | 1.3.9 |`));
		assert.ok(errors.some((e) => /not a table row/.test(e)));
		assert.ok(errors.some((e) => /not an https/.test(e)));
	});

	it("ends the table at a real heading", async () => {
		const { errors } = await check(doc(`${okRow}\n\n## Next\n| Beta | http://x | nope |`));
		assert.deepEqual(errors, []);
	});

	it("rejects a link that is not an https URL", async () => {
		for (const link of ["https://", "http://example.com", "example.com", "www.example.com", "ftp://example.com"]) {
			const { errors } = await check(doc(row("Acme", link, "1.4.0")));
			assert.equal(errors.length, 1, link);
			assert.match(errors[0], /https/);
		}
	});

	it("rejects a version that is not x.y.z", async () => {
		for (const version of ["latest", "1.4", "v1.4.0", "unreleased"]) {
			const { errors } = await check(doc(row("Acme", "https://example.com", version)));
			assert.equal(errors.length, 1, version);
		}
	});

	it("rejects an unpublished npm version", async () => {
		const published = new Set(["1.4.0", "1.3.9"]);
		const { errors } = await check(doc(okRow), { published });
		assert.deepEqual(errors, []);
		const bad = await check(doc(row("Acme", "https://example.com", "9.9.9")), { published });
		assert.equal(bad.errors.length, 1);
		assert.match(bad.errors[0], /not a published/);
	});

	it("requests each scoped package as one encoded registry path segment", async () => {
		const requested = [];
		const published = await publishedVersions("https://registry.example", async (url) => {
			const segment = new URL(url).pathname.slice(1);
			assert.doesNotMatch(segment, /[@/]/);
			requested.push(decodeURIComponent(segment));
			return { ok: true, json: async () => ({ versions: { "1.4.0": {} } }) };
		});
		assert.deepEqual(requested, PACKAGES);
		assert.deepEqual(published, new Set(["1.4.0"]));
	});

	it("rejects the benchmark fixture organization", async () => {
		const { errors } = await check(doc(row("flisk-erp-system", "https://example.com", "1.4.0")));
		assert.equal(errors.length, 1);
		assert.match(errors[0], /benchmark fixture/);
	});

	it("rejects a link into the benchmark results", async () => {
		const { errors } = await check(doc(row("Acme", "https://github.com/flisk-sh/flisk-cli/tree/main/docs/benchmarks/results", "1.4.0")));
		assert.equal(errors.length, 1);
		assert.match(errors[0], /benchmarks\/results/);
	});

	it("rejects a duplicated organization, ignoring case and spacing", async () => {
		const { errors } = await check(doc(`${okRow}\n${row("  acme ", "https://other.example.com", "1.3.9")}`));
		assert.equal(errors.length, 1);
		assert.match(errors[0], /duplicates line/);
	});

	it("rejects text in the List section that is not a table row", async () => {
		const { errors } = await check(doc(`${okRow}\nNot a row at all\n`));
		assert.equal(errors.length, 1);
		assert.match(errors[0], /not a table row/);
	});

	it("reports an error when the List section is missing", async () => {
		const { errors } = await check("# Adopters\n\nNo table here.\n");
		assert.equal(errors.length, 1);
		assert.match(errors[0], /no adopter table/);
	});

	it("warns on an unreachable link instead of failing", async () => {
		const failFetch = () => Promise.reject(new Error("getaddrinfo ENOTFOUND"));
		const { errors, warnings } = await check(doc(okRow), { fetchImpl: failFetch, checkLinks: true });
		assert.deepEqual(errors, []);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /unreachable/);
	});

	it("warns on a non-2xx link answer instead of failing", async () => {
		const { errors, warnings } = await check(doc(okRow), {
			fetchImpl: () => Promise.resolve({ ok: false, status: 403 }),
			checkLinks: true,
		});
		assert.deepEqual(errors, []);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /403/);
	});

	it("keeps row checks working when the npm fetch is skipped", async () => {
		// published=null stands in for a failed registry call: structure still validates.
		const { errors } = await check(doc(row("Acme", "https://example.com", "9.9.9")), { published: null });
		assert.deepEqual(errors, []);
	});

	it("the committed ADOPTERS.md parses with no structural errors", async () => {
		const markdown = readFileSync(path.join(ROOT, ADOPTERS_REL), "utf8");
		assert.deepEqual(validateRows(tableSection(markdown)), []);
	});

	it("the committed ADOPTERS.md versions are published", async () => {
		const markdown = readFileSync(path.join(ROOT, ADOPTERS_REL), "utf8");
		const rows = tableSection(markdown).filter((r) => r.cells && r.cells.length === 3);
		const published = await publishedVersions(process.env.NPM_REGISTRY ?? "https://registry.npmjs.org").catch(() => null);
		if (published === null) return; // no network: the shape checks above still ran
		assert.deepEqual(validateVersions(rows, published), []);
	});
});
