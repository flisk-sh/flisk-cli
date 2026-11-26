// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// The ORACLE invariants: pure functions over the collected surfaces. Each returns null (the surfaces agree) or a failure in the
// shared bug-memory shape { engine, seed, project, scenario, invariant, expected, actual, surfaces }.
// doctor owns environment/service checks and config verify owns generated-project consistency; ORACLE only compares the
// doctor checks that describe the project (named below), never the Docker/Tilt/host ones.

import { INFRA_KINDS } from "../../e2e/scale/enigma36/plan.mjs";

// A compare function on purpose: Array.prototype.sort() with none orders by UTF-16 code unit after String(x), which hides mistakes on non-strings.
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dbService = (s) => s.status?.json?.data?.platformServices?.find((p) => p.capability === "database");
const gwService = (s) => s.status?.json?.data?.platformServices?.find((p) => p.capability === "gateway");
const doctorCheck = (s, name) => s.doctor?.json?.data?.checks?.find((c) => c.name === name);
// knownGap names the open issue that explains a failure. checkScenario drops such failures (the nightly stays quiet about a known
// bug) unless it runs strict, which the regression vault does, so the vault notices the day the issue is fixed. Any invariant can
// tag a failure this way; there is no per-gap switch.
const fail = (invariant, expected, actual, surfaces, knownGap) => ({ invariant, expected, actual, surfaces, ...(knownGap ? { knownGap } : {}) });

// Capabilities that are on without a platform service behind them, so platformServices cannot list them (watch gates Tilt
// live update). A capability that is not a platform service belongs here, or the capabilities invariant reports it as a
// contradiction.
const NON_SERVICE_CAPABILITIES = new Set(["watch"]);

// The generated files audited on 2026-11-24 that `config verify` does not look at (#5493, #5396). Only files `config explain` calls
// generated are probed, so the user-owned scaffolds (CI workflow, guard hook, AGENTS.md) are not here: nobody promised to verify them.
const KNOWN_UNVERIFIED = [
	/^services\/platform\/database-management\/docker-compose\.yml$/,
	/^shared-platform-engineering\/docker-templates\/bun-hoisted-symlink-fix\.sh$/,
	/^shared-platform-engineering\/docker-templates\/infisical-entrypoint\.sh$/,
	/^shared-platform-engineering\/docker-templates\/install-deps\.sh$/,
	/^shared-platform-engineering\/docker-templates\/prisma-bun-client-link-fix\.sh$/,
	/^shared-platform-engineering\/docker-templates\/prisma-normalize-client\.sh$/,
];

export const INVARIANTS = [
	{
		id: "surfaces-ran",
		surfaces: ["status", "doctor", "config verify", "resources"],
		check: (s) => {
			const bad = ["status", "doctor", "verify", "resources"].filter((k) => !s[k]?.json);
			return bad.length ? fail("surfaces-ran", "status, doctor, config verify and resources each print a JSON envelope", `no envelope from: ${bad.join(", ")}${s[bad[0]]?.error ? ` (${s[bad[0]].error})` : ""}`, bad) : null;
		},
	},
	{
		id: "database-need-matches-scenario",
		surfaces: ["status --json platformServices"],
		check: (s, sc) => {
			const db = dbService(s);
			return db && db.isEnabled !== sc.expect.database
				? fail("database-need-matches-scenario", `database ${sc.expect.database ? "enabled" : "disabled"}`, `database ${db.isEnabled ? "enabled" : "disabled"} (${db.reason})`, ["status"])
				: null;
		},
	},
	{
		id: "gateway-need-matches-scenario",
		surfaces: ["status --json platformServices"],
		check: (s, sc) => {
			const gw = gwService(s);
			return gw && gw.isEnabled !== sc.expect.gateway
				? fail("gateway-need-matches-scenario", `gateway ${sc.expect.gateway ? "enabled" : "disabled"}`, `gateway ${gw.isEnabled ? "enabled" : "disabled"} (${gw.reason})`, ["status"])
				: null;
		},
	},
	{
		id: "status-capabilities-match-platform-services",
		surfaces: ["status --json capabilities", "status --json platformServices"],
		check: (s) => {
			const data = s.status?.json?.data;
			if (!data?.platformServices || !data.capabilities) return null;
			const want = data.platformServices.filter((p) => p.isEnabled).map((p) => p.capability).sort(byText);
			const got = [...data.capabilities].sort(byText);
			// capabilities names every capability that is on; platformServices only the ones that run a service, so a
			// capability like watch is expected exactly when capabilities lists it.
			const expected = [...want, ...got.filter((c) => NON_SERVICE_CAPABILITIES.has(c))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
			return expected.join() === got.join() ? null : fail("status-capabilities-match-platform-services", `capabilities ${JSON.stringify(expected)}`, `capabilities ${JSON.stringify(got)}`, ["status"]);
		},
	},
	{
		id: "verify-postgres-matches-status",
		surfaces: ["config verify --json sharedPlatformPostgres", "status --json platformServices"],
		check: (s) => {
			const db = dbService(s);
			const pg = s.verify?.json?.data?.sharedPlatformPostgres;
			return db && pg && db.isEnabled !== pg.willStart
				? fail("verify-postgres-matches-status", `config verify willStart=${db.isEnabled} like status`, `config verify willStart=${pg.willStart} (reason ${pg.reason}), status database ${db.isEnabled ? "on" : "off"}`, ["verify", "status"])
				: null;
		},
	},
	{
		id: "doctor-postgres-check-matches-status",
		surfaces: ["doctor --json 'Shared platform Postgres'", "status --json platformServices"],
		check: (s) => {
			const db = dbService(s);
			const c = doctorCheck(s, "Shared platform Postgres");
			if (!db || !c) return null;
			return Boolean(c.isSkipped) === db.isEnabled
				? fail("doctor-postgres-check-matches-status", `doctor ${db.isEnabled ? "checks" : "skips"} shared Postgres like status`, `doctor ${c.isSkipped ? "skipped" : "ran"} it: ${c.message}`, ["doctor", "status"])
				: null;
		},
	},
	{
		id: "env-has-database-keys-when-database-on",
		surfaces: [".env", "status --json platformServices"],
		check: (s) => {
			const db = dbService(s);
			if (!db?.isEnabled) return null;
			const { DB_PASSWORD: pw, DATABASE_URL: url } = s.env;
			if (!pw) return fail("env-has-database-keys-when-database-on", "DB_PASSWORD in .env", "status enables PostgreSQL but .env has no DB_PASSWORD", ["env", "status"]);
			if (!url?.includes(pw)) return fail("env-has-database-keys-when-database-on", "DATABASE_URL built from DB_PASSWORD", "DATABASE_URL does not contain DB_PASSWORD", ["env"]);
			return null;
		},
	},
	{
		id: "env-has-jwt-secret",
		surfaces: [".env"],
		check: (s) => (s.env.JWT_SECRET ? null : fail("env-has-jwt-secret", "JWT_SECRET in .env (local-jwt is the default auth mode)", "JWT_SECRET missing", ["env"])),
	},
	{
		id: "doctor-env-agrees-with-dotenv",
		surfaces: ["doctor --json 'Environment Variables'", ".env"],
		check: (s) => {
			const c = doctorCheck(s, "Environment Variables");
			if (!c || c.didPass) return null;
			const present = Object.keys(s.env).filter((k) => s.env[k] !== "" && new RegExp(`\\b${k}\\b`).test(c.message ?? ""));
			return present.length ? fail("doctor-env-agrees-with-dotenv", "doctor reports only keys missing from .env", `doctor reports ${present.join(", ")} missing, but .env sets them`, ["doctor", "env"]) : null;
		},
	},
	{
		id: "generated-files-consistent",
		surfaces: ["config verify --json valid", "doctor --json 'Master Configs'"],
		check: (s, sc) => {
			// doctor's Master Configs only checks that the files exist; config verify checks they match project.json. A project that
			// verifies clean after regenerate must have them, and a doctor that finds them missing cannot sit beside a clean verify.
			const c = doctorCheck(s, "Master Configs");
			const v = s.verify?.json?.data;
			if (!v) return null;
			const graphProblem = sc.expect.cycle || sc.expect.dangling; // verify refuses those on purpose; invariants below check them
			if (!v.valid && graphProblem) return null;
			if (!v.valid) return fail("generated-files-consistent", "config verify valid after config regenerate", `config verify errors: ${(v.errors ?? []).join("; ")}`, ["verify"]);
			return c && !c.didPass ? fail("generated-files-consistent", "doctor finds the master files config verify accepted", `doctor Master Configs failed: ${c.message}`, ["doctor", "verify"]) : null;
		},
	},
	{
		id: "status-lists-scaffolded-resources",
		surfaces: ["status --json resources", "scaffold output"],
		check: (s, sc) => {
			const listed = s.status?.json?.data?.resources;
			if (!listed) return null;
			const want = sc.resources.map((r) => `${r.name}=${r.type ?? r.kind}`).sort(byText);
			const got = listed.map((r) => `${r.name}=${r.type}`).sort(byText);
			return want.join() === got.join() ? null : fail("status-lists-scaffolded-resources", `resources ${want.join(" ")}`, `resources ${got.join(" ")}`, ["status"]);
		},
	},
	{
		id: "stacks-command-matches-status",
		surfaces: ["stacks --json", "status --json stacks"],
		check: (s) => {
			const a = s.stacks?.json?.data?.stacks;
			const b = s.status?.json?.data?.stacks;
			if (!a || !b) return null;
			const show = (list) => list.map((x) => `${x.name}=${x.resourceCount}`).sort(byText).join(" ");
			return show(a) === show(b) ? null : fail("stacks-command-matches-status", `flisk stacks lists ${show(b)} like status`, `flisk stacks lists ${show(a)}`, ["stacks", "status"]);
		},
	},
	{
		id: "status-stacks-match-scenario",
		surfaces: ["status --json stacks", "scaffold output"],
		check: (s, sc) => {
			const listed = s.status?.json?.data?.stacks;
			if (!listed) return null;
			const group = (pairs) => pairs.sort(byText).join(" ");
			const want = group(sc.resources.map((r) => `${r.stack}:${r.name}`));
			const got = group(listed.flatMap((st) => st.resources.map((n) => `${st.name}:${n}`)));
			return want === got ? null : fail("status-stacks-match-scenario", `stacks ${want}`, `stacks ${got}`, ["status"]);
		},
	},
	{
		id: "infra-flags-agree",
		surfaces: [".flisk/project.json optional_infra", "spec.master", "scenario infra"],
		check: (s, sc) => {
			if (!sc.infra || !s.specMaster) return null;
			const flags = s.projectJson.optional_infra ?? {};
			for (const [name, on] of Object.entries(sc.infra)) {
				if (flags[name] !== on) return fail("infra-flags-agree", `project.json optional_infra.${name}=${on}`, `project.json has ${flags[name]}`, ["projectJson"]);
				const m = new RegExp(`^"${name}": (True|False)`, "m").exec(s.specMaster);
				if (m && (m[1] === "True") !== on) return fail("infra-flags-agree", `spec.master ${name} ${on ? "True" : "False"} after config regenerate`, `spec.master has ${m[1]}`, ["specMaster", "projectJson"]);
			}
			return null;
		},
	},
	{
		id: "verify-notices-unapplied-infra",
		surfaces: ["config verify --json before config regenerate", "scenario infra"],
		check: (s, sc) => {
			if (!sc.infra || !s.staleVerify?.json) return null;
			// Only a flag that differs from the default (monitoring/elk/debezium off, golden_image on) changes the generated files.
			const defaults = { monitoring: false, elk: false, debezium: false, golden_image: true };
			const changed = Object.entries(sc.infra).filter(([k, on]) => on !== defaults[k]);
			if (changed.length === 0) return null;
			return s.staleVerify.json.data?.valid === false ? null : fail("verify-notices-unapplied-infra", `config verify out of sync after enabling ${changed.map(([k]) => k).join(", ")} without regenerate`, "config verify said valid", ["verify"]);
		},
	},
	{
		id: "dependson-graph-agrees",
		surfaces: ["config verify --json", "doctor --json 'Circular dependencies'", "up --dry-run --json"],
		check: (s, sc) => {
			const v = s.verify?.json?.data;
			const c = doctorCheck(s, "Circular dependencies");
			if (!v || !c) return null;
			const verifyCycle = (v.errors ?? []).some((e) => /circular dependency/.test(e));
			const ghosts = (v.sharedPlatformPostgres?.unknownDependsOnNames ?? []).map((u) => u.name);
			const upOk = s.up?.json?.data?.ok;
			const upGhosts = (s.up?.json?.data?.unknownDependsOn ?? []).map((u) => u.name);
			const got = { verifyCycle, doctorCycle: !c.didPass, upRefuses: s.up?.code !== 0 && upOk !== true, ghosts: ghosts.sort(byText).join(), upGhosts: upGhosts.sort(byText).join() };
			const want = { verifyCycle: sc.expect.cycle, doctorCycle: sc.expect.cycle, upRefuses: sc.expect.cycle, ghosts: sc.expect.dangling ? "ghost" : "", upGhosts: sc.expect.dangling ? "ghost" : "" };
			return JSON.stringify(got) === JSON.stringify(want) ? null : fail("dependson-graph-agrees", JSON.stringify(want), JSON.stringify(got), ["verify", "doctor", "up"]);
		},
	},
	{
		id: "resources-command-matches-status",
		surfaces: ["resources --json", "status --json resources"],
		check: (s) => {
			const a = s.resources?.json?.data?.resources;
			const b = s.status?.json?.data?.resources;
			if (!a || !b) return null;
			const names = (list) => list.map((r) => r.name).sort(byText).join(" ");
			return names(a) === names(b) ? null : fail("resources-command-matches-status", `flisk resources lists ${names(b)} like status`, `flisk resources lists ${names(a)}`, ["resources", "status"]);
		},
	},
	{
		id: "up-dry-run-lists-every-resource",
		surfaces: ["up --dry-run --json services", "status --json resources"],
		check: (s, sc) => {
			if (sc.expect.cycle) return null; // up refuses a cycle on purpose; dependson-graph-agrees checks that
			const want = sc.resources.map((r) => r.name).sort(byText).join(" ");
			const services = s.up?.json?.data?.services;
			if (!Array.isArray(services)) return fail("up-dry-run-lists-every-resource", `up would start ${want}`, `up --dry-run gave no services list (exit ${s.up?.code}${s.up?.error ? `, ${s.up.error}` : ""})`, ["up"]);
			const got = [...services].sort(byText).join(" ");
			return want === got ? null : fail("up-dry-run-lists-every-resource", `up would start ${want}`, `up would start ${got}`, ["up"]);
		},
	},
	{
		id: "up-stack-focus-matches-stacks",
		surfaces: ["up --dry-run <stack> --json services", "status --json stacks"],
		check: (s) => {
			const stacks = s.status?.json?.data?.stacks;
			if (!stacks) return null;
			for (const [stack, r] of Object.entries(s.upByStack ?? {})) {
				const want = (stacks.find((x) => x.name === stack)?.resources ?? []).sort(byText).join(" ");
				const got = [...(r.json?.data?.services ?? [])].sort(byText).join(" ");
				if (want !== got) return fail("up-stack-focus-matches-stacks", `up ${stack} starts ${want || "(none)"}`, `up ${stack} would start ${got || (r.error ?? "(none)")}`, ["up", "status"]);
			}
			return null;
		},
	},
	{
		id: "render-exports-http-resources",
		surfaces: ["export render --dry-run", "scaffold output"],
		check: (s, sc) => {
			if (!s.render) return null;
			const http = ["backend", "mcp", "agent", "frontend", "bring-your-own"]; // `export render` exports every resource that serves HTTP
			const want = sc.resources.filter((r) => http.includes(r.kind)).map((r) => r.name).sort(byText).join(" ");
			// Known gap #3243: a python, go or rust backend has no Dockerfile until `flisk up`, and export render refuses it. The
			// exemption belongs to the resource the error names, so another backend's refusal is never excused by it.
			const refused = /Resource "([^"]+)" has neither a Dockerfile nor a package\.json/.exec(s.render.stderr ?? "")?.[1];
			const culprit = sc.resources.find((r) => r.name === refused);
			let gap = culprit?.kind === "backend" && culprit.args.some((a) => ["python", "go", "rust"].includes(a)) ? "#3243" : undefined;
			// Known gap #3862: an infrastructure framework (rabbitmq, nats, mysql, minio, mailpit...) is an image-only bring-your-own
			// container with no Dockerfile, and export render refuses it. It serves no HTTP, so it is not in the expected list either.
			if (culprit && INFRA_KINDS.includes(culprit.kind) && culprit.type === "bring-your-own") gap = "#3862";
			if (s.render.code !== 0) return want ? fail("render-exports-http-resources", `render.yaml lists ${want}`, `export render exited ${s.render.code}`, ["render"], gap) : null;
			const got = [...s.render.stdout.matchAll(/^ {2}- type: \w+\n {4}name: "([^"]+)"/gm)].map((m) => m[1]).sort(byText).join(" ");
			return want === got ? null : fail("render-exports-http-resources", `render.yaml lists ${want}`, `render.yaml lists ${got}`, ["render"]);
		},
	},
	{
		id: "compose-matches-database-need",
		surfaces: ["export compose --dry-run", "status --json platformServices"],
		check: (s, sc) => {
			if (s.compose?.code !== 0 || !s.compose.text.includes("services:")) return null; // no bring-your-own resource: nothing to compare
			const db = dbService(s);
			const services = [...s.compose.text.matchAll(/^ {2}([A-Za-z0-9_.-]+):\s*$/gm)].map((m) => m[1]);
			const byo = sc.resources.filter((r) => r.kind === "bring-your-own").map((r) => r.name).sort(byText);
			const missing = byo.filter((n) => !services.includes(n));
			if (missing.length) return fail("compose-matches-database-need", `compose lists ${byo.join(", ")}`, `compose is missing ${missing.join(", ")}`, ["compose"]);
			if (db && !db.isEnabled && (services.includes("postgres") || /DB_PASSWORD/.test(s.compose.text))) {
				return fail("compose-matches-database-need", "no PostgreSQL service or DB_PASSWORD in compose while the database is off", "compose still references the database", ["compose", "status"]);
			}
			return null;
		},
	},
	{
		id: "verify-notices-deleted-owned-files",
		surfaces: ["config verify --json valid (after deleting one generated file)", "config explain --json ownership"],
		check: (s) => {
			// A clone that lost a file that `config explain` calls generated (.tiltignore, the shared-platform-engineering scripts)
			// must hear about it from config verify. A probe that could not run (null) is a failure too: nothing else reads ownedFiles.
			const broken = (s.ownedFiles ?? []).filter((f) => f.verifyValid == null);
			if (broken.length) return fail("verify-notices-deleted-owned-files", "every generated file is probed", `no verify result for ${broken.map((f) => `${f.path} (${f.error ?? "no envelope"})`).join(", ")}`, ["verify"]);
			const silent = (s.ownedFiles ?? []).filter((f) => f.verifyValid === true).map((f) => f.path);
			// Known gap #5493: verify compares only .flisk/.flisk-out and the platform compose file. Every file named there is the
			// audited set, so a new silent file still fails strictly in the nightly.
			const gap = silent.length > 0 && silent.every((p) => KNOWN_UNVERIFIED.some((re) => re.test(p))) ? "#5493" : undefined;
			return silent.length ? fail("verify-notices-deleted-owned-files", "config verify reports a missing file for each generated file deleted", `config verify stayed valid with ${silent.join(", ")} deleted`, ["verify"], gap) : null;
		},
	},
	{
		id: "package-scope-is-the-project",
		surfaces: ["services/*/*/package.json name", "package.json name"],
		check: (s) => {
			// A scaffolded service is named after the project, or not scoped at all. A scope every project shares (a literal
			// placeholder) makes two Flisk projects collide as soon as they sit in one workspace, and the root already uses the folder name.
			const root = s.packages?.root;
			const bad = (s.packages?.services ?? []).filter((p) => p.name.startsWith("@") && root && p.name.split("/")[0] !== `@${root}`);
			return bad.length ? fail("package-scope-is-the-project", `service package names scoped @${root} (or not scoped)`, `package names ${bad.map((p) => p.name).join(", ")} while the root package is ${root}`, ["package.json"]) : null;
		},
	},
	{
		id: "no-secret-or-generated-file-is-committable",
		surfaces: ["git ls-files after git add -A"],
		check: (s) => {
			// What a contributor pushes after `flisk project`, `flisk resource` and `config regenerate`: no .env, no .autogenerated
			// folder, no .flisk-out, no generated env file. (Two example repos track exactly these today: #5489, #5490.)
			const leaked = (s.committable ?? []).filter((f) => /(^|\/)\.env($|\.(?!example$))|\.autogenerated($|\/|\.)|^\.flisk\/\.flisk-out\//.test(f));
			return leaked.length ? fail("no-secret-or-generated-file-is-committable", "no .env, .autogenerated or .flisk-out file is tracked", `git would commit ${leaked.slice(0, 5).join(", ")}${leaked.length > 5 ? ` and ${leaked.length - 5} more` : ""}`, ["git"]) : null;
		},
	},
];

// Run every invariant. Returns failures in the bug-memory shape, with the engine/seed/scenario fields filled in. A failure tagged
// with a knownGap is left out unless `strict` is set, so a replay can tell an open known gap from a fixed one.
export function checkScenario(surfaces, scenario, { project = "generated-project", strict = false } = {}) {
	const failures = [];
	for (const inv of INVARIANTS) {
		const f = inv.check(surfaces, scenario);
		if (f?.knownGap && !strict) continue;
		if (f) failures.push({ engine: "ORACLE", seed: scenario.seed, project, scenario: scenario.shape, ...f, reproduction: `node tests/oracle/run.mjs --seed ${scenario.seed} --shape ${scenario.shape}`, regression_test: "pending" });
	}
	return failures;
}
