# Playbook: add a `flisk doctor` check

A doctor check is a small function that returns one `CheckResult`. This checklist shows where the function, its table row and its test go. `cli/src/utils/doctor-tools.ts` (`checkDockerVersions`) is the running example for a host check; `cli/src/commands/doctor/checks/host-ports.ts` is an example of a check defined next to its table row.

## Checklist

1. **Write the check function** in `cli/src/utils/doctor-<area>.ts` when it probes the host, or in `cli/src/commands/doctor/checks/<name>.ts` when it is specific to the doctor run. It returns a `CheckResult` from `cli/src/types/diagnostics.ts`:

   ```ts
   import type { CheckResult } from "../types/index.js";
   import { type ExecAsync, execAsync } from "./exec-async.js";

   export async function checkMyTool(
     exec: ExecAsync = execAsync, // injectable for tests
   ): Promise<CheckResult> {
     let raw: string;
     try {
       raw = String(await exec("my-tool --version", 10_000)).trim();
     } catch {
       return {
         name: "My Tool",
         didPass: false,
         message: "my-tool not found on PATH",
         fix: "Install my-tool: https://example.org/install\n  Verify: my-tool --version",
       };
     }
     return { name: "My Tool", didPass: true, message: `my-tool ${raw}` };
   }
   ```

   Required fields are `name`, `didPass` and `message`. Optional fields: `fix`, `isSkipped` (check could not run meaningfully, not a failure), `isWarning` (fails only under `--strict`), and `observed` (structured metadata for the machine report). Keep `name` stable — it appears in `flisk doctor --json`.

2. **Choose the section**: Machine checks inspect the host; Project checks inspect the current project. Add a row to the matching table:
   - Machine, Docker stack: `CONTAINER_MACHINE_CHECKS` in `cli/src/commands/doctor/checks/machine.ts`.
   - Project, Docker stack: `CONTAINER_PROJECT_CHECKS` in `cli/src/commands/doctor/checks/project.ts`.
   - A project whose services all declare `command` runs as local processes: also add the row to `nativeMachineChecks()` or `nativeProjectChecks()` in those same files. If the check needs Docker, leave it out of the native tables.

   A row is a `DoctorCheckSpec` (see `cli/src/commands/doctor/checks/spec.ts`):

   ```ts
   {
     name: "My Tool",
     requires: null, // "container-runtime" only when it needs a live daemon
     run: (ctx) => checkMyTool(ctx.cachedExec),
   }
   ```

   A row may also carry an optional `when: (ctx) => boolean` inclusion gate; a row whose `when` returns false is dropped silently, so only add one for an option `flisk doctor` really declares.

   `requires: "container-runtime"` makes the runner skip the row with a "skipped" result when no daemon is available. Reuse `ctx.cachedExec` and `ctx.hostCommandCache` instead of spawning your own command; `DoctorRunContext` is defined in `cli/src/commands/doctor/context.ts`.

3. **Wiring checks are different.** If the check cross-references services already discovered on disk (ports, routes, volumes, migrations), put the function under `cli/src/utils/doctor/checks/` and add one row to the slot table in that folder's `table.ts` using `{ wiring: "declaration" | "schema" | "wiring" | "machine" | "discovery" }`. `expandDoctorTable()` in `cli/src/commands/doctor/table.ts` expands that slot into the Docker lists; do not duplicate the row in `machine.ts`/`project.ts`. The native project table includes only the `declaration` and `schema` slots (see `nativeProjectChecks()`); the `wiring`, `discovery` and `machine` slots run for Docker projects only. If a check in one of those slots must also run for local-process projects, add a row for it to `nativeMachineChecks()` or `nativeProjectChecks()` as well.

4. **Write the `fix` text** as a short, copyable recipe: the exact command, a `Verify:` line and a docs link. `cli/src/commands/doctor.ts` holds `DOCTOR_FIXES` strings for common repairs, and `checkDockerVersions` in `cli/src/utils/doctor-tools.ts` shows the multi-line style. Do not put an automatic repair in `fix` — automated repairs are `DoctorAction`s planned by `cli/src/commands/doctor/fix.ts` and `cli/src/utils/doctor-fix.ts` under `flisk doctor --fix`. A plain check only tells the user what to run.

5. **Add tests** next to the check function (`cli/src/utils/__tests__/doctor-<area>.test.ts` or `cli/src/commands/doctor/__tests__/`). Pass a fake `ExecAsync` so no real tool is needed, and assert `didPass`, `message`, `fix` and the skipped/warning flags. Add a table test in `cli/src/commands/doctor/__tests__/check-table.test.ts` when you add a row, so the check's section and gating are covered.

6. **Verify** with `npm --prefix cli run check:dist` (it rebuilds `cli/dist`, which `cli/bin/flisk.js` runs, so the manual doctor runs below use your change; commit the regenerated `cli/dist` files), `npm --prefix cli run typecheck`, `npm --prefix cli run lint` and `bun run test -- doctor`. Then, from a scratch project and calling the CLI by its absolute path, run `node /path/to/flisk/cli/bin/flisk.js doctor --no-ping --problems-only` and `node /path/to/flisk/cli/bin/flisk.js doctor --json`: the first should show your failing case with its fix text, the second should include the stable `name` in `data.checks`.

## Common traps

- Returning a thrown error instead of `didPass: false` with a `fix`: doctor must report every check, not stop at the first failure.
- Using `requires: "container-runtime"` for a pure file check: the row will be skipped on machines without Docker even when it could run.
- Forgetting the native table: local-process projects never see the check.
- A `fix` that says "install it" without the exact command: users copy what doctor prints, so make it copyable.
