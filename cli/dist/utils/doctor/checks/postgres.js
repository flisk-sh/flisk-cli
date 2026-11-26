// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDatabaseCapabilityEnabled } from "../../capabilities.js";
import { toComposeProjectName } from "../../compose-project-name.js";
import { parseEnv } from "../../env-validator.js";
import { execAsync } from "../../exec-async.js";
import { formatCount } from "../../formatting.js";
import { findProjectRoot } from "../../paths.js";
import { describeSharedPostgresUsers, evaluateSharedPlatformPostgres, } from "../../shared-platform-postgres.js";
import { EXEC_TIMEOUT_MS, projectName } from "./shared.js";
/**
 * Shared platform Postgres will-start reporting.
 *
 * Uses the same evaluateSharedPlatformPostgres predicate as `flisk config verify`,
 * which reads project.json **and** the generated Tiltfile/spec.master when present.
 * Resource set is the project discovery set those commands already inspect —
 * not a `flisk up` filter. A resource that depends on Postgres while you bring up
 * a different one still makes this report will-start; the engine start path is
 * selection-bounded and may not start Postgres for that run. Unknown dependsOn
 * names (typos like `postgress`) stay errors. Does NOT report
 * postgres/database-management as missing services and does NOT claim Prisma
 * will start.
 *
 * Preflight loop: edit service.json → `flisk config regenerate` → `flisk doctor`.
 * Doctor is the gate; one real `flisk up` after doctor is green confirms the run.
 */
export function checkSharedPlatformPostgres(projectRoot = findProjectRoot() ?? process.cwd(), options) {
    if (!isDatabaseCapabilityEnabled(projectRoot, options)) {
        return {
            name: "Shared platform Postgres",
            didPass: true,
            isSkipped: true,
            message: "Database capability is disabled; shared platform Postgres check skipped",
        };
    }
    const evaluation = evaluateSharedPlatformPostgres(projectRoot, undefined, options);
    const projectScopeNote = " (project resource set; flisk up may select a subset and not start Postgres)";
    const focusWarning = evaluation.focusWouldEnableDatabaseManagement
        ? " Warning: generated Tiltfile default focus expands CORE_INFRA to database-management while project.json has it off; default flisk up takes the feature path."
        : "";
    if (evaluation.unknownDependsOnNames.length > 0) {
        const list = evaluation.unknownDependsOnNames
            .map(({ resource, name }) => `"${name}" (from ${resource})`)
            .join(", ");
        const willStartSuffix = evaluation.willStart
            ? ` Postgres will start because ${evaluation.reason === "feature"
                ? "database-management is enabled"
                : describeSharedPostgresUsers(evaluation)}${projectScopeNote}`
            : " Postgres will not start for this project.json/generated Tiltfile state.";
        return {
            name: "Shared platform Postgres",
            didPass: false,
            message: `${formatCount(evaluation.unknownDependsOnNames.length, "unknown dependsOn name")}: ${list}. These are not known services or stacks, and are not the shared platform database names (postgres, database-management).${willStartSuffix}${focusWarning}`,
            fix: 'Use "postgres", "database-management" or a database resource\'s name in dependsOn for the shared platform database, or fix the name to match an existing service',
        };
    }
    if (!evaluation.willStart) {
        return {
            name: "Shared platform Postgres",
            didPass: true,
            isWarning: Boolean(focusWarning),
            isSkipped: !focusWarning,
            message: focusWarning
                ? focusWarning.trim()
                : "Shared platform Postgres will not start: database-management is off and no resource depends on postgres or database-management.",
        };
    }
    if (evaluation.reason === "feature" && evaluation.dependsOnUsers.length === 0) {
        const source = evaluation.featureOnFromTiltfile || evaluation.featureOnFromSpecMaster
            ? " (generated Tiltfile/spec.master)"
            : "";
        return {
            name: "Shared platform Postgres",
            didPass: true,
            isWarning: Boolean(focusWarning),
            message: `Shared platform Postgres will start because the database-management feature is enabled${source} (project-wide; not a flisk up selection).${focusWarning}`,
        };
    }
    const reason = evaluation.reason === "feature"
        ? `the database-management feature is enabled and ${describeSharedPostgresUsers(evaluation)}`
        : describeSharedPostgresUsers(evaluation);
    return {
        name: "Shared platform Postgres",
        didPass: true,
        isWarning: Boolean(focusWarning),
        message: `Shared platform Postgres will start because ${reason}${projectScopeNote}${focusWarning}`,
    };
}
const POSTGRES_CREDENTIALS_CHECK = "Postgres credentials";
const POSTGRES_AUTH_FAILED = /password authentication failed/i;
const SAFE_NAME = /^[A-Za-z0-9_]+$/;
function postgresCredentialsSkipped(message) {
    return { name: POSTGRES_CREDENTIALS_CHECK, didPass: true, isSkipped: true, message };
}
/**
 * Whether the shared Postgres still accepts the DB_PASSWORD in the project .env.
 *
 * Postgres applies POSTGRES_PASSWORD only when it first initialises a data volume, and the volume lives in Docker, outside the
 * project folder. A recreated folder (or a changed .env) gets a new random DB_PASSWORD while the old volume keeps its own, and
 * every service that connects, such as a migrator, then fails with "password authentication failed" minutes into `flisk up`.
 *
 * The login is tried from the container's own network address: the official image trusts 127.0.0.1 without a password, so a
 * loopback test would pass whatever the password. PGPASSWORD is handed to docker through this process's environment, so the
 * password never appears in a command line.
 */
export async function checkPostgresCredentials(projectRoot = findProjectRoot() ?? process.cwd(), exec = execAsync, options) {
    if (!isDatabaseCapabilityEnabled(projectRoot, options)) {
        return postgresCredentialsSkipped("Database capability is disabled - skipped the Postgres password check");
    }
    const proj = projectName(projectRoot);
    const name = proj ? toComposeProjectName(proj) : undefined;
    if (!name || !SAFE_NAME.test(name)) {
        return postgresCredentialsSkipped("No project name - skipped the Postgres password check");
    }
    let password;
    try {
        password = parseEnv(readFileSync(join(projectRoot, ".env"), "utf-8"))
            .get("DB_PASSWORD")
            ?.trim();
    }
    catch {
        password = undefined;
    }
    if (!password) {
        return postgresCredentialsSkipped("No DB_PASSWORD in .env - skipped the Postgres password check");
    }
    const container = `${name}_postgres`;
    const inspect = async (format) => String(await exec(`docker inspect -f "${format}" ${container}`, EXEC_TIMEOUT_MS)).trim();
    let running = "";
    let address = "";
    try {
        running = await inspect("{{.State.Running}}");
        address =
            (await inspect("{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}")).split(/\s+/)[0] ?? "";
    }
    catch {
        running = "";
    }
    if (running !== "true" || !/^[0-9a-f.:]+$/i.test(address)) {
        return postgresCredentialsSkipped(`${container} is not running - skipped the Postgres password check`);
    }
    const previous = process.env.PGPASSWORD;
    process.env.PGPASSWORD = password;
    try {
        await exec(`docker exec -e PGPASSWORD ${container} psql -h ${address} -U ${name} -d postgres -tAc "select 1"`, EXEC_TIMEOUT_MS);
        return {
            name: POSTGRES_CREDENTIALS_CHECK,
            didPass: true,
            message: `${container} accepts the DB_PASSWORD in .env`,
        };
    }
    catch (err) {
        const failure = err;
        if (!POSTGRES_AUTH_FAILED.test(`${String(failure.stderr ?? "")} ${String(failure.message ?? "")}`)) {
            return postgresCredentialsSkipped(`Could not test the login to ${container} - skipped the Postgres password check`);
        }
        let volume = "";
        try {
            volume = (await inspect("{{range .Mounts}}{{.Name}} {{end}}")).split(/\s+/)[0] ?? "";
        }
        catch {
            volume = "";
        }
        const removal = /^[\w.-]+$/.test(volume)
            ? `docker volume rm ${volume}`
            : `docker volume rm <the ${name}_postgres_data volume>`;
        return {
            name: POSTGRES_CREDENTIALS_CHECK,
            didPass: false,
            message: `${container} refuses the DB_PASSWORD in .env. Its data volume was created with a different password, and Postgres keeps the password it was created with, so a recreated project folder or a changed .env leaves the database and the project disagreeing. Services that connect, such as migrators, fail with "password authentication failed".`,
            fix: `Restore the .env that created the volume, or start the database fresh (this deletes its data):\n  flisk down\n  ${removal}\n  flisk up`,
        };
    }
    finally {
        if (previous === undefined)
            delete process.env.PGPASSWORD;
        else
            process.env.PGPASSWORD = previous;
    }
}
