# Machine-readable CLI

The supported agent polling loop uses `flisk status --json`; add `--tilt` to include Tilt's live resource list in `tilt.resources`. Use `flisk resources --json` for the discovered manifest view, `flisk stacks --json` for stack names and counts and `flisk networks --json` for routed URLs and reachability. `flisk doctor --json` reports environment readiness and actionable checks.

Every response uses this envelope:

```json
{
  "schemaVersion": 1,
  "data": {},
  "errors": []
}
```

`data` is `null` when a command cannot produce its report. Errors have stable `code` and `message` fields; the emitter of `up` and `down` also sets `suggestions` on every entry (an empty array when the command has no hint), so a script reads it without checking for the key first. Diagnostics are written to stderr; stdout contains one JSON document. Exit code 0 means the report succeeded (doctor readiness permits warnings), 1 means a blocking finding or command failure, and 2 means invalid arguments or an unexpected internal error (`flisk up` also exits 2 when hand-edited generated files drift from `service.json`, while native Windows startup refusal exits 1). Consumers should check the exit code and still parse the envelope when one is emitted.

A call the argument parser rejects (an unknown command or option, a missing required argument or option value, extra arguments) also returns the envelope when `--json` appears anywhere before `--`: `data` is `null` and `errors` has one `USAGE` entry with the parser's message. A "Did you mean" hint becomes a `suggestions` entry. Nothing is written to stderr, and the exit code is `2`, the same one the commands use for a rejected value (`flisk logs --tail abc`): the code says "your arguments are wrong", whatever rejected them. An unknown command is the exception: its envelope exits `1`, like any other command failure (#4533). Outside JSON the same parser error goes to stderr with exit code `2` as well:

```json
{
  "schemaVersion": 1,
  "data": null,
  "errors": [
    {
      "code": "USAGE",
      "message": "error: unknown command 'nope'",
      "suggestions": ["Did you mean open?"]
    }
  ]
}
```

Command data:

- `status`: `checkout` (`id`, `name`), `runtime` (`"native"` when the project runs as local processes, plus `inferred: true` when inferred from `package.json`; absent for a Docker/Tilt project), `tilt.available` (a local-process project has no `tilt` block: it reports `readiness` at the top level and a `url` per resource instead; a service that is not running is `stopped`, and `unknown` only means the run state could not be read), `tilt.project` (the project root when this project's own Tilt or local run answered, `null` when nothing of it did), `tilt.resourcesQueried`, `tilt.readiness`, `tilt.tiltfileError`, `tilt.staleDisabled` (resource names the Tiltfile enables that Tilt still reports as `Disabled` until `flisk down && flisk up`), optional live `tilt.resources`, total `resourceCount`, discovered manifest `resources` (in a local-process run `port` comes from `run.json`, so a checkout-local remapped port is reported), optional top-level `urls` (the real service URLs from `run.json`, local-process runs only), `ports`, `stacks` (`name`, `resourceCount`, `resources` containing resource names, `healthyCount`, `healthTotal`: what `healthyCount` is out of, which leaves out a database with no process of its own), `unhealthy` (names of failing or pending services), `unassignedResources` (resource names), `platformServices`, `sharedInfra`, and `capabilities`. Each `resources` entry has `name`, `stack`, `type`, `port`, `path` (the resource folder relative to the project root), `url` (the ingress address a routed service answers on: a frontend, an API or a bring-your-own web UI; `null` for everything else, when the gateway is off, and for every local-process service), `containerPort` (the port the service listens on), `hostPort` (a direct host port mapping, `null` today because Flisk publishes services only through the ingress), `directUrl` (`http://localhost:<port>` for a service with no route but a known port: every local-process service, and a container service that is neither routed nor bring-your-own), `extraPorts` (the host ports a bring-your-own resource declares in `service.json`, each `containerPort`, `hostPort`, `protocol`, `bind` and `address`, plus `publish` or `problem` when a `publish` template resolved or could not; empty for every other resource), `status` (`ready`, `pending`, `error` or `unknown` when no run state can be read), `statusReason` (why the service is not ready, its own error or a dependency that failed or is still starting; present only when a reason is known), `blockedBy` (the failed services it depends on, directly or through others; present only when it is blocked) and, with `--usage`, `usage` (a CPU, RSS and process-count sample, `null` when no sample could be read). `ports` lists the stack ports a client should forward or open, each `name`, `hostPort` and `purpose`: `ingress-http` and `ingress-https` (when a port plan exists and the gateway is on), `tilt-ui` (always present for a container project) and `postgres` (when a port plan exists). It is `[]` for a local-process project, which publishes no ingress, Tilt UI or Postgres container. `platformServices` has one entry per platform service, each `capability` (`gateway` or `database`), `name` (`router (Traefik)` or `PostgreSQL`), `isEnabled`, `users` (the sorted resources that use it) and `reason` (why it runs or does not); it is `[]` for a local-process project, which runs neither. `sharedInfra` is the shared Postgres instance, `name` (`postgres`) and `databases` (each `name` (`<project>_<stack>`), `stack` and `services`); it is `null` when the database capability is off or no stack uses it. `capabilities` names the project capabilities that are on, such as `database`; a project with `capabilities.database: false` in `.flisk/project.json` has no `database` here and `sharedInfra` is `null`, and a project of local processes reports none. `--tilt` controls the live `tilt.resources` list: without it, `tilt.resourcesQueried` is `false` and `tilt.resources` is `null`. The manifest `resources` array is always available, even when no run state can be read; `status` is `unknown` for every entry then. `tilt.readiness` retains its existing behavior and may be populated whenever Tilt is available. If Tilt is unavailable, `tilt.available` is `false` and no live resource-list query is made. A Tilt on the port whose Tiltfile belongs to another project counts as unavailable for this project: `tilt.available` is `false`, no `tilt.readiness` failures from that project are reported, and `tilt.foreignProject` names the other root when it could be identified.
- `wait`: `ok`, `state` (`ready`, `failed`, `timeout` or `unknown-service`), `ready`, `timeoutSeconds`, `runtime` (`native` for local-process projects, `docker` for Docker/Tilt projects), `services` (one entry per waited-on service with `name`, `status`, optional `reason` and `blockedBy`, and optional `logs` with its last lines on failure), `unhealthy` (failing or still-starting names) and `unknown` (only for `unknown-service`). It is read-only: it waits on the same readiness rule as `up --wait` and `status`, changes no files and starts nothing. A ready wait exits 0. A failure exits 1 with `errors[].code` `WAIT_RESOURCE_FAILED`; a timeout exits 1 with `WAIT_TIMEOUT`; an unknown service name exits 2 with `UNKNOWN_SERVICE` and `suggestions`. Human output names the failing service and prints its last log lines on stderr. The MCP `wait` tool takes `services` and `timeoutSeconds` and returns this same envelope.
- `resources`: `resources` with stable service name, stack, type, port, `path` (the resource folder relative to the project root, with `/` separators) and `manifest` (its `service.json`, also relative to the project root). Both paths are portable: the same project in a different parent folder produces identical JSON. The absolute manifest path remains available in the `--verbose` text view.
- `resources`, `stacks` and `status`: when discovery skipped a `service.json` (invalid JSON or invalid fields), `skipped` lists each one with `file` (relative to the project root, as `config verify --json` names it) and `reason`, so a short `resources` list is not mistaken for a complete one. The field is absent when nothing was skipped, the exit code stays 0, and the human warning still goes to stderr.
- `stacks`: `stacks` with `name` and `resourceCount`. `--services` adds `services` (service names; its length equals `resourceCount`), and `--verbose` adds `description`; `--services` alone does not include `description`. A project with no stacks returns `stacks: []`. Outside a project it emits the same envelope as `resources --json` (`data: null`, one `errors` entry, exit 2).
- `networks`: `services` with stable service name, stack, resource folder `path` (relative to the project root), base path, URL, optional Windows loopback URL, service port, and reachability state (`running`, `stopped`, or `unknown`). An empty list means no discovered resource currently has a routable base path. In a local-process project (services that declare `command`, no Docker or Tilt) there is no router: each service with a port is listed at its `http://localhost:<port>` address, and the state comes from the run on record (`ready` reports `running`, `pending` `unknown`, the rest `stopped`). An optional `warnings` array carries the same messages text mode prints to stderr, so a consumer reading only stdout still learns when a status check could not run (for example, when Docker is not running).
- `projects`: `projectRoot` (the absolute path of the project), `configured` (`true` when all master configuration files exist), `missingFiles` (the master files that are missing from `.flisk/.flisk-out`; empty when `configured` is `true`), `resources` (the number of discovered resources, not their names), `stacks` (the stack names) and `unassignedResources` (the number of resources that do not belong to a stack). Use `flisk resources --json` or `flisk stacks --json` when you need the names and details. `flisk info --json` is an alias. See the example below.
- `doctor`: `ready`, `inProject`, ordered `checks`, `capabilities` (names of the capabilities that are on), and, when a host port plan is computed (container projects), a `ports` plan with `http`, `https`, and `postgres` entries (no `postgres` entry when the database capability is off, from `capabilities.database: false` in `.flisk/project.json` or `--no-database`). In a local-process project (`nativeResources`, services started with a `command` rather than Docker) no host port plan exists, so `ports` is absent. Each port entry contains canonical `requested`, selected `chosen`, `explicit`, and `reason` fields. `commit` and `commitSha` carry the same value: the commit the CLI was built from, `unknown` when the build has no build info. `host` names where doctor runs: `kind` (`local`, `wsl2`, `codespaces`, `devcontainer`, `native-windows`, or `webcontainer`), `canUp` (`false` when `flisk up` cannot run on this host, including when the container runtime is unreachable), and `containerRuntimeReachable` (`null` when the Container Runtime check did not run, as in a local-process project); see [agent-hosts.md](../agent-hosts.md). `fixFirst` is present only when a failing check has a fix command that runs on this platform: `{rank, checkId, check, command}` entries ordered most blocking first, so `rank: 1` unblocks the most other checks. `buildCache` reports the Docker build cache the check of the same name measured (`size`, `entries`, and `reclaimable` when Docker reports one), and `colimaDisk` the running Colima VM's disk file size on the Mac against what Docker reports (`diskFileBytes`, `dockerBytes`, `ratio`); each is present only when its check ran. `observed` copies the `observed` detail of the first check that reported one and is present only then. With `--fix`, `actions` lists every repair as `{id, check, scope, command, status, reason}`, `repairableCount` counts the repairs planned or applied, and `needsActionCount` the failed checks that still need manual action; `repairable` and `needsAction` repeat the same two numbers. When `--problems-only` is passed, `checks` drops checks that pass (`didPass: true`) or are skipped (`isSkipped: true`, even when `didPass` is `false`) and includes `summary: { passed, skipped, failed }`. Doctor is read-only and does not persist the plan, unless `--fix` is given (see [doctor-contract.md](doctor-contract.md)). Structured `errors` cover usage/internal failures. Check entries preserve `name`, `didPass`, `message`, `durationMs` (how long the check took), optional `fix`, `isWarning`, `isSkipped`, and optional `observed` (structured detail such as the owner of a busy port). `isSkipped` indicates that a check could not run meaningfully; skipped checks are non-blocking, even when `didPass` is `false`. An optional `warnings` array repeats the messages of the `isWarning` checks, so a consumer can read warnings without filtering `checks`. When discovery skipped a `service.json`, `data.skipped` lists each one as `{file, reason}`, like `status --json`, and the `Valid service.json files` check fails, so `ready` is `false`.
- `up`: `ok` (`true` when all expected resources are built and running), `stack` (the stack name argument, or `null`), `services` (the started service names), optional `requested` and `dependencies` (when `--only` is used), optional `warnings` (non-blocking project findings such as required secrets left to a missing Infisical bridge), optional `diskWarning`, `tiltUrl` (`http://localhost:<port>`), and `urls` (one entry per URL `flisk up` prints for a started service: `service`, `url`, `didAnswer`, `status`, and for a URL that does not answer `cause`, `message`, `nextCommand` and, for a missing variable, `envName`; absent with `--no-gateway`), and `timings` (one entry per started service: `service`, `startedAt` and `readyAt` as RFC3339 timestamps from Tilt's resource history, and `startToReadyMs`, the milliseconds from the service's update start to the moment the stack counted it ready; `readyAt` extends to the service's `-healthy` or `-done` gate when one exists, and a service with no deploy record keeps only its `service` name; absent when Tilt cannot be read). In a local-process project (services that declare `command` and run without Docker or Tilt), `data` has `runtime` (`"native"`, plus `inferred: true` when inferred from `package.json`), no `tiltUrl`, and `urls` in the same `{service, url, didAnswer, status}` array shape for each started service with a URL. A checkout running under its own name (#4047) also reports `remappedPorts` (`{service, port}` entries) when a declared port was busy; on startup failure `data.failures` entries have `name`, `reason`, `exitCode` (the service's last exit code, or `null` when it never exited), `code` and `suggestions`, plus optional `logs`, `program` (for a missing command) and the existing `message`/`fix`. `flisk up --json` emits one JSON object once startup reaches its ready state while Tilt continues running in the background. On timeout or resource failure, `data.ok` is `false` with `data.tiltUrl` and `data.failures` (a list of affected resources, each with `name`, `reason`, `exitCode`, `code` and `suggestions`, plus optional `logs`, `message` and `fix` when the message names a known machine problem such as Docker running out of network ranges), and `errors[].code` is `UP_TIMEOUT` or `UP_RESOURCE_FAILED`. The local-process and container/Tilt runtimes use the same classifier, so the same cause gets the same `failures[].code`. When every resource is running but a printed URL does not answer, `data.ok` is `false` with `data.tiltUrl` and `data.urls`, `errors[].code` is `UP_URL_UNREACHABLE`, and Tilt keeps running. On smoke-check failure, `data.ok` is `false`, `errors[].code` is `UP_SMOKE_FAILED`, and Tilt is stopped. Hand-edited generated file drift (`DRIFT_DETECTED`, `DRIFT_EXIT_CODE = 2`) and arguments the user typed wrong (unknown `--only` service names (`UNKNOWN_SERVICE`), an unknown `--profile` (`UNKNOWN_PROFILE`), an invalid `--wait-timeout` (`INVALID_WAIT_TIMEOUT`), a rejected `--env-file` (`ENV_FILE_INVALID`)) exit with code `2`, while `flisk config verify` exits `1` for drift; other startup, preflight, and host/platform refusals (including native Windows startup refusal) exit with code `1`. A project with no resources refuses with `NO_RESOURCES` (exit `1`) before any `--only` names are checked, so an unknown `--only` name in an empty project reports `NO_RESOURCES`, not `UNKNOWN_SERVICE`. Every `errors[]` entry carries a `suggestions` array (empty when there is no hint). Parsers should read the failure category from `errors[].code` and the affected resources from `data.failures`. `flisk up --wait --json` relays that same one result from a detached run; when the run is not healthy `data` also carries `services`, one entry per service the run knew about (`name`, `status` of `healthy`, `unhealthy` or `exited`, a short `reason` when it is not healthy, and `blockedBy` naming the failed dependencies it waits on), and `unhealthy`, the names that are not `healthy`. A wait that times out or loses its `flisk up` child emits the same `services`/`unhealthy` report with `errors[].code` `UP_WAIT_TIMEOUT` or `UP_WAIT_FAILED`. See the examples below.
- `up` on an unchanged, healthy stack that is already running: `ok` (`true`), `alreadyRunning` (`true`), `stack`, `services`, `tiltUrl` and `advertisedUrls` (the ingress URLs of the running stack, as plain strings) and `urls` (the per-URL check objects a normal start reports, absent with `--no-gateway`). This is the fast no-op path (#4193): it writes no generated files, starts no build and prints the same "Stack is healthy." answer under `--wait`. A change to the config, an unhealthy or missing resource, a flag such as `--force`, or a Tilt that does not answer all take the normal startup path. `advertisedUrls` is only the fast-path list of plain strings.
- `up --dry-run`: `ok`, `dryRun` (`true`), `stack` (the stack name argument, or `null`), `services` (the services the run would start, in discovery order) and `command` (the `tilt up` command line that would run). With `--only`, it also has `requested` (the names you passed) and `declaredDependencies` (services pulled in because a requested service lists them in `dependsOn`). A `dependsOn` name that matches no service or stack of the project adds an `unknownDependsOn` entry `{resource, name}`, and a frontend whose `backendName` names no service adds an `unknownBackendNames` entry. In a local-process project (services that declare `command` and run without Docker or Tilt), `data` has `runtime` (`"native"`), `startOrder` (the services in start waves, each wave started together) and `containers` (the services that would start with `docker run`; absent when the plan has none) instead of `command`, plus `inferred` (the detected `{command, script}`) when the run was inferred from `package.json`. See the example below.
- `up --env-file`: the path selects the project env file of the run (see [environment.md](../environment.md)). A path that is missing, unreadable, not a file, outside the project, or that misses a key the platform needs is refused before anything starts: `errors[].code` is `ENV_FILE_INVALID` and the exit code is `2`. A project whose vendored engine predates the option is refused with `errors[].code` `ENV_FILE_ENGINE_TOO_OLD` and exit code `1`. A stack that is already running keeps the env file it started with, so the option is refused with `errors[].code` `ENV_FILE_ALREADY_RUNNING` and exit code `1`. The path is named in the message and in the human output; no value from the file is ever printed.
- `down`: `ok` (`true`) and `stoppedTilt` (the process IDs of any `tilt up` run that `flisk down` ended first; an empty list when none was running). Unless `--no-prune-networks` is given, it also has `removedNetworks` (the project's Docker networks that were removed) and `keptNetworks` (networks left in place, each with `name` and `reason`, for example because a container is still attached). When `tilt down` fails (for example because the generated Tiltfile no longer evaluates), `flisk down` stops the project's containers with `docker compose down` instead and adds `composeFallback`: `tiltDownExitCode` and `stopped` (the Compose projects it stopped). `flisk down --dry-run --json` returns `ok` and `dryRun` (`true`) and stops nothing. With `--dry-run` and the default network prune (no `--no-prune-networks`, no `--purge`, which covers the networks), the dry run adds `wouldPruneNetworks`: `remove` (the project's networks that no container would keep after `down` stops this project's stacks; their own containers do not count) and `keep` (each with `name` and `reason`, for example `1 container is attached` for a running container outside those stacks); nothing is removed. It is absent when the networks cannot be checked. When Docker is not running, no `tilt up` of this project is alive, and the user did not ask for `--purge`, `--prune-cache`, or `--prune-networks`, `data` is `ok` (`true`) and `stopped` (`[]`) and the command exits 0 without asking for Docker (#5029); `--dry-run` adds `dryRun` (`true`). In a local-process project (services that declare `command`, no Docker or Tilt) `data` has `runtime` (`"native"`) and `stopped` (the service names it stopped), no `stoppedTilt` and no network fields; `stale` (`true`) marks a run that had already exited and `unverified` lists services whose process could not be confirmed stopped. `--dry-run` returns `ok`, `dryRun`, `runtime`, `wouldStop` (the service names of the run on record, the ones a real `down` would stop; empty when no run is on record) and, when the build cache would be pruned, `wouldPruneCache`. Stopping a folder with no Flisk project that was inferred from `package.json` reports the same `runtime`, `stopped`, `stale` and `unverified` fields plus `inferred` (`true`); its `--dry-run` returns `ok`, `dryRun`, `runtime` and `inferred`. When `--purge` or `--prune-networks` is passed to a local-process project (they remove Docker objects it does not have), `data` also has `warnings`: one string naming the flag or flags that only apply to Docker/Tilt projects, and nothing is removed from Docker. See the examples below.
- `tool add`: with a tool, `id`, `title`, `group`, `status` (`resource`, `built-in` or `manual`) and, by status, `command` and `resource` (the `flisk resource --json` data), `note`, or `reason` and `steps`. A rejected tool (`aws`, `google-cloud`, `azure`, `kubernetes`) is `data: null` with one `COMMAND_FAILED` error and exit 1, while an unknown one is `data: null` with one `UNKNOWN_TOOL` error and exit 1. Without a tool, `tools` lists the catalog. See [Add a tool by name](../add-a-tool.md).
- `tool list`: `tools`, the same catalog `tool add --json` prints without a tool, each with `id`, `title`, `group` and `status` (`resource`, `built-in`, `manual` or `rejected`). It reads no project and starts nothing.
- `logs`: `services` (selected service names), `tail` (defaults to `200`, accepts `1`–`10000`), `since` (duration such as `30s`, `5m`, or `1h`, or `null` when omitted), and `lines` (normalized log entries). Each line contains `time`, `resource`, `level`, `source`, and `text`; the first four fields may be `null`, while `text` is a string. With `since`, Flisk filters on the real timestamps Tilt recorded with each log segment (read from `tilt dump webview`) rather than on the time of the query, and each returned `time` is that event time. If Tilt cannot supply those timestamps, `errors[].code` is `TILT_LOG_TIMES_UNAVAILABLE` (exit 1) instead of returning unfiltered lines. Local-process projects filter their own timestamped files and are unaffected.

Example output for `flisk logs --json --service orders-api --tail 50 --since 5m`:

```json
{
  "schemaVersion": 1,
  "data": {
    "services": ["orders-api"],
    "tail": 50,
    "since": "5m",
    "lines": [
      {
        "time": "2026-10-15T12:30:00Z",
        "resource": "orders-api",
        "level": "info",
        "source": "stdout",
        "text": "Request completed"
      }
    ]
  },
  "errors": []
}
```

This is an illustrative example. `--tail` limits the number of recent lines, and `--since` filters logs to the specified duration using each event's recorded time. JSON mode returns a snapshot and exits rather than following a live stream. On failure, `data` is `null` and `errors` contains entries with `code` and `message`, optionally with `suggestions`. Usage errors exit with code `2`; other failures use the applicable command exit code. Error diagnostics are also written to stderr. For a project that runs under Tilt, a `--service` name that is not a resource of the project is `UNKNOWN_RESOURCE` with `suggestions` listing the project's resources, checked before Tilt is probed, as `restart` and `run` do. That manifest check cannot reject a name when discovery skipped a `service.json` — the parsed list may be missing the service — nor for a project orchestrated by its own imported Tiltfile, whose resources are not in `service.json` discovery; the running Tilt's own resource list decides those names, reporting `UNKNOWN_RESOURCE` for a Tiltfile project and `UNKNOWN_SERVICE` with exit code `2` otherwise. A name the project declares but the running Tilt does not list is `UNKNOWN_SERVICE` with exit code `2`, and a local-process (`command`) project reports an unknown `--service` name the same way, without involving Tilt.

Example output for a successful `flisk wait orders-api --timeout 60 --json`:

```json
{
  "schemaVersion": 1,
  "data": {
    "ok": true,
    "state": "ready",
    "ready": true,
    "timeoutSeconds": 60,
    "runtime": "docker",
    "services": [{ "name": "orders-api", "status": "ready" }],
    "unhealthy": []
  },
  "errors": []
}
```
- `config verify`: `valid`, `checkout` (`id`, `name`), `errors`, `warnings`, `diffs` and `state` (`generated`, `not_generated` or `not_needed`). A container project that has never been generated (no master file and no service output yet) has `state` `not_generated` and exactly one error, "Not generated yet: run 'flisk up' or 'flisk config regenerate'", with no `diffs` and a payload of well under 2 KB; it exits 1 like any unverified project. A deleted or edited file in a generated project is still reported per file. A local-process project generates no container files and reports `not_needed`. Drift or missing tracked master outputs exits 1 and includes one `data.diffs` entry per affected file with its path, `state` (`missing` or `different`), `linesAdded` and `linesRemoved`; file bodies are not sent by default. Pass `--diff <file>` (repeatable; a path from `data.diffs` or its file name) to include a capped unified diff for that file only — `data.diffLineLimit` states the cap (200 lines), and a truncated diff carries a note and `truncated: true`. A valid project exits 0. A missing project exits 1 with a structured command error; a `project.json` whose field has the wrong type exits 1 with a `COMMAND_FAILED` error that names the field (`.flisk/project.json.discovery.paths: expected an array, got "services"`), while unparseable JSON or an unexpected failure exits 2 with a structured internal error. JSON verification does not regenerate files.
- `config regenerate`: `dryRun`, `hasChanges`, `staleServiceOutputs` (the service.json files whose generated compose and Dockerfile are older than the file; `flisk up` writes those, not regenerate) and `changes`, one entry per master file with `file`, `status` (`new`, `modified` or `unchanged`) and `lineDiff` (new minus current lines, `0` for a new file). With `--dry-run` nothing is written; without it the files are rewritten (hand edits in them are discarded) and `changes` says how each one differed before the run.
- `config migrate`: `schemaVersion` (the version the files now declare), `migrated` (the `service.json` paths that were rewritten, relative to the project root) and `warnings`. When any file cannot be migrated, nothing is written: `data` is `null`, `errors` has one `MIGRATE_FAILED` entry per problem, and the exit code is `1`.
- `config enable-infra` and `config disable-infra`: `service`, `enabled` (the new value) and `wasEnabled` (the value before the run). An unknown service, or `verdaccio` without a license that grants it, is a `COMMAND_FAILED` error with `suggestions` and exit code `1`.
- `project`: `--json` implies `--yes` and `--quiet`, so it never prompts and takes the defaults (with `--force` it overwrites `.flisk/project.json` without asking, like `--force --yes`). `action` says what it did. `created` (a new project) has `projectRoot`, `projectName`, `autoEnabledStacks`, `generatedFiles`, `env` (`created`, and `added` for the keys added to an existing `.env`), `missingEnv`, `gitignoreAdded`, `agentSkills` (the files written) and `runtime` (`hasDockerCli`, `hasTiltCli`). `regenerated` (run inside an existing project) has `projectRoot`, `autoEnabledStacks`, `generatedFiles`, `env`, `gitignoreAdded` and `runtime`. `cloned` (with a template) has `template`, `path` (the absolute directory it landed in) and `runtime`. `check` (with `--check`) has `projectRoot`, `valid`, `hasProjectJson` and `missingFiles`; an incomplete project also gets a `PROJECT_INCOMPLETE` error and exit code `1`.
- `project --list`: returns the standard envelope with the starter templates under `data.templates`. Each template has `key`, `repo`, `description` and an optional 40-character `ref`. `schemaVersion` and `errors` are present, so consumers can detect later changes. `project --list --json` previously returned a bare array; it now returns the versioned envelope. During migration, read `data.templates`; the bare-array shape is no longer emitted.
- `resource`: `--json` implies `--yes`, so the name is required and, when several stacks exist, `--stack` too. `action` (`created`, or `registered` for a directory that already had a `service.json`), `name`, `type`, `stack`, `port` (`null` for an SDK), `path` (relative to the project root), `framework` and `language` (`null` when they do not apply) and `discovered` (whether `discovery.paths` covers `path`, so `flisk up` starts it). With `--frameworks`, `data` is the inventory instead: `type` (`frontend` or `backend`), `frameworks` (the rows the text listing prints, as objects) and, for a backend, `language`.
- `resource --dry-run`: `dryRun` (`true`), `resource` (the ordinary resource report above, describing what would be created or registered), `files` (each `{path, action}`, where `action` is `create` or `update`) and `directories` (explicitly planned new directories, including empty scaffold folders). File and directory paths are relative to the project root and use `/`. The preview includes additional Prisma migrator files and existing-manifest updates. It uses the same validation, framework/language choices and port selection as creation, but writes nothing, reserves no port and does not refresh generated configuration. A later creation resolves the plan again, so the port or paths can change if the project or host changes. `--ddd --dry-run` requires a fresh cached license result; it never creates a license project ID, contacts the license server or writes its cache.
- `stack`: `--json` never prompts, so it needs `--list`, or a stack name with `--resources`. `stacks` (`name`, `resourceCount`) and `unassigned` (`name`, `configPath`) describe the project after the run, `stack` is the stack assigned to (`null` with `--list`) and `assigned` lists the resources this run assigned (`name`, `configPath`).
- `import` and `import compose` (the same importer): `--json` implies `--yes`. flisk-import runs with its output captured (and copied to stderr), and `data` has `dir`, `dryRun`, `force`, `written` (the `service.json` paths the importer reports writing) and `output` (what it printed). The plan is also parsed into fields, so a caller does not parse `output`: `services` (one entry per service in the plan: `name`, `kind`, optional `dir`, `image` or `build` (`{context, dockerfile}`), `port`, `proxy` (`"traefik"` or `"none"`), `healthCheckPath` with `healthCheckAssumed` when the importer guessed it, `dependsOn`, `notes`, `write` (`{path, action}` where `action` is `"create"`, `"exists-kept"` or `"overwrite"`), and `notWrittenReason` when the plan rejects the service), `skipped` (the "Skipped / not fully imported" lines as `{source, detector, reason}`, plus, for a sibling `Procfile` next to the root Compose file that the importer does not read, `{source, detector: "procfile", reason, processes}`; without `--json` that skip is printed on stderr) and `planned` (every path the plan writes: `.flisk/project.json` plus each created or overwritten `service.json`, so a dry run still lists what would be written while `written` stays empty). A failed import (nothing to import, an unreadable `docker-compose.yml`, a core older than the importer needs, or no `npx`) has `data: null`, one `IMPORT_FAILED` error with the importer's message and hints, and the importer's exit code (`127` when `npx` cannot run).
- `import tiltfile`: needs flisk-import 0.4.1 or later. It runs `flisk-import tiltfile` the same way, so `--json` implies `--yes` and `data` has `path` (the path argument as given, `Tiltfile` when omitted), `dryRun`, `force`, `written` (`[".flisk/project.json"]` when the importer reports writing it, empty in a dry run), `services` (empty: a Tiltfile registers orchestration instead of mapping services), `skipped`, `planned` (`[".flisk/project.json"]` when the plan registers the Tiltfile) and `output` (what it printed). A refusal (a missing Tiltfile, a path inside `.flisk/`, a path with a quote or control character, or a `.flisk/project.json` that already names an orchestration source without `--force`) has `data: null`, one `IMPORT_FAILED` error with the importer's message and hints, and the importer's exit code.
- `eject`: `--json` implies `--yes`. `dryRun`, `created` (whether this run wrote `EJECTED.md`, or would in a dry run; `false` when it already existed), `ejectedFile`, `generatedFiles` (the files under `.flisk/.flisk-out`, which stay where they are), `userFiles` (a root `Tiltfile`, when there is one) and `tiltUpCommand`. A project without generated Tilt files is a `COMMAND_FAILED` error with exit code `1`.
- `mcp check`: `url` (the endpoint checked), `resource` (the resource it was resolved from, or `null` for a URL), `iconUrl` (or `null` with `--no-icon`), `serverName`, `didPass`, `failures` and `checks` (each `{check, didPass, detail}`, with `isSkipped: true` on a check that did not run, such as `tools/call` without `--call`). Any failing check adds one `MCP_CHECK_FAILED` error whose `suggestions` name the failing checks, and the exit code is `1`; the report is still in `data`. A target that is neither an https URL (plain http only for loopback hosts) nor a resource of this project is an error with `data: null`.
- `os`: starts FliskOS, the local desktop app (see the [cheat sheet](../cheat-sheet.md)). `via` (`command` for the `fliskos` command, `app` for `FliskOS.app`), `path` (the executable or the app bundle), `args` (what it was started with), `project` (the project passed with `--project`, or `null`), `url` (where FliskOS listens, read from the command's own output and left exactly as printed, so it carries FliskOS's access token in its query string: keep it out of logs and chats; `null` for the app, which opens its own window) and `ignored` (the options the app cannot take, such as `--port`; empty for the command). The envelope goes out once FliskOS is listening and `flisk os` keeps running until it stops, so read the first line and leave the process alone; the command's own output goes to stderr, and the exit code is that of `fliskos` once it ends. Neither `fliskos` nor the app on the machine is a `FLISKOS_NOT_INSTALLED` error with the install steps in `suggestions` and exit code `1`; `fliskos` exiting or staying silent before it listens (30 seconds) is `FLISKOS_FAILED`; a `--port` that is not an integer from 0 to 65535, or a `--project` that is not a Flisk project, is `COMMAND_FAILED`. Nothing is ever installed. With only the app installed, `--no-open` or `--json` is a `FLISKOS_COMMAND_REQUIRED` error and no window is opened. With `--no-open`, FliskOS stops when its stdin closes, so start it with stdin open.
- `run`: runs the command without input. `service`, `runtime` (`container` for `docker exec` in the running container, `native` for a local process), `command` (the argv given after `--`), `exitCode` (the command's, also flisk's exit code), and `stdout` and `stderr` (the last 64 KB of each). A name that is not a resource of the project is `UNKNOWN_RESOURCE` with `suggestions` listing the project's resources; a missing command or a container service that is not running is `RUN_FAILED`, both with exit code `1`.
- `restart`: `resource` (the name) and `restarted` (`true`) once the restart succeeded. A container resource is stopped and started again through `docker restart` of its Compose-labelled container, with no image rebuild; a local-process resource (top-level `command` in service.json) and `--rebuild` keep the `tilt trigger` path, which rebuilds the image and recreates the container. An invalid `--port` or `TILT_PORT` is a `USAGE` error with exit code `2`; a name that is not a resource of the project is `UNKNOWN_RESOURCE` with `suggestions` listing the project's resources, checked before Tilt is probed; no running Tilt is `TILT_NOT_RUNNING` and a failed trigger or container restart is `TILT_TRIGGER_FAILED` with the underlying message, both with exit code `1`. In a local-process project with a supervising `flisk up`, the same call restarts the process and returns `resource`, `runtime` (`"native"`), `restarted` (`true`), `state`, `ready` (whether `state` is `ready`) and, for a running process, `pid`; no Tilt is involved. With no name, `restart` restarts every local process of the run in `dependsOn` order and returns `runtime`, `restarted` and a `resources` list of one entry per service (`resource`, `state`, `ready`, `pid`); `image` containers of a mixed run are not restarted and are listed under `skipped`. A no-name restart outside a local-process project keeps the `USAGE` `missing required argument` error with exit code `2`. With no supervising run, `restart` exits `1` with `data: null` and a `NATIVE_NOT_RUNNING` error pointing at `flisk up`. A service that exits during a supervised restart is `RESTART_FAILED` and one that does not reach `ready` within `--wait` is `RESTART_NOT_READY`; both exit `1` with `ok` `false`, `restarted` `false`, `state` and `logs`, and a no-name restart reports one such error per failed service.
- `agent list`: `resources` (each with `name`, `stack`, `type` (`"agent"`), `port` and `path`), matching `flisk resources --type agent --json` and the `agent_list` MCP tool; `skipped` (each `{file, reason}`) is included when any `service.json` was unreadable. Filters: `--stack <stack>` and `--no-stack`. An empty project or a project with no agents returns `resources: []` and exits `0`.
- `agent sessions`: `agent` (the resource name), `port`, `sessions` (each with `sessionId`, `lastActivity`, `status` and `checkpointBytes`; the last two may be `null`) and `total`. With `--session-id <id>` it is `agent`, `port` and `session` (the checkpoint the agent returned, with an optional `toolCalls` array of per-turn `{ name, args, resultSummary, ok, ms }` records). Failures carry their own code: `USAGE`, `UNKNOWN_RESOURCE`, `NOT_AN_AGENT`, `NO_PORT`, `NO_ROUTE`, `AGENT_NOT_RUNNING`, `AGENT_REQUEST_FAILED`, or `SESSION_LIST_UNSUPPORTED` for an agent scaffolded before `GET /sessions` existed.
- `config explain`: `file` (project-relative), `ownership`, `reason`, `source` (the input it is generated from, or `null`), `driftOnUp` (what `flisk up` does when the file was edited), `isEditedNow` (whether it differs from its snapshot now) and `next` (suggested steps, in order).
- `runtime`: `--check-assets` now uses the standard envelope: `data` carries `ok`, `assetRoot` (the directory the bundled engine and templates were found in, or `null`), `missing` (required assets that are absent), `layoutErrors` and `templateErrors`. `ok` is `true` only when all three lists are empty and an asset root was found. On failure `errors` carries a `RUNTIME_CHECK_FAILED` entry and the exit code is `1`.
- `upgrade --dry-run` and `upgrade --dry-run --json`: `dryRun` (`true`), `currentVersion` (the running CLI's `MAJOR.MINOR.PATCH`), `latestVersion` (or `null` when `--all` could not reach the remote check), `upgradeAvailable`, `method` (`npm`, `bun`, `git`, `binary`, `homebrew`, `scoop` or `unknown`), `path` (where that installation lives, or `null`) and `installations` (the detected installation, or every detected installation on `PATH` when `--all` is passed, each `{method, path}`; `[]` when no installation path could be resolved). `--json` is only accepted together with `--dry-run`, so `flisk upgrade --dry-run --json` is the one JSON form of `upgrade`: calling `flisk upgrade --json` without `--dry-run` is refused with `data: null`, a `COMMAND_FAILED` error naming `--dry-run`, and exit code `1` so an upgrade never runs silently. `latestVersion` is a version for `npm`, `bun`, `binary`, `homebrew` and `scoop`, but for `method: "git"` it is the 7-character commit hash of the remote default branch while `currentVersion` stays a semver, so a script must not compare the two as versions there: read `upgradeAvailable` instead, which is `true` when the checkout's `HEAD` differs from that hash.
- `repos list` and `repos clone`: `repos list --json` returns `repos`, one entry per repository configured in `.flisk/project.json` with `name` (the last `dir` segment), `url` (credentials redacted), `path` (the `dir`) and `cloned` (whether `<dir>/.git` exists). `repos clone --json` returns `cloned` (the entries this run cloned, each `url` and `dir`) and `existing` (the entries whose destination already existed). `repos clone` accepts the configured `dir` values as arguments and clones only those; an unknown `dir` is `data: null` with an `UNKNOWN_REPO` error naming the valid dirs and exit code `1`. Other failures are `REPOS_FAILED` with the failure's exit code.

Example output for `flisk upgrade --dry-run --json` on a git install:

```json
{
  "schemaVersion": 1,
  "data": {
    "dryRun": true,
    "currentVersion": "1.4.68",
    "latestVersion": "7520a09",
    "upgradeAvailable": true,
    "method": "git",
    "path": "/home/me/flisk",
    "installations": [{ "method": "git", "path": "/home/me/flisk" }]
  },
  "errors": []
}
```

For `project`, `resource`, `stack`, `import`, `eject` and the `config` subcommands above, the human output goes to stderr without colour and stdout carries the envelope only. Outside a project each prints `data: null` and one `NOT_IN_PROJECT` error with `suggestions`, and exits `1`. When a deeper check stops the command before it can report (for example the machine check of `flisk project`), the error code is the command's own failure code (`PROJECT_FAILED`, `RESOURCE_FAILED`, `STACK_FAILED`, `IMPORT_FAILED`, `EJECT_FAILED`, `REGENERATE_FAILED`, `MIGRATE_FAILED`, `INFRA_TOGGLE_FAILED`) with the message the check printed.

Example output for `flisk resource orders-api --type backend --stack shop --json` in a project with no other backend:

```json
{
  "schemaVersion": 1,
  "data": {
    "action": "created",
    "name": "orders-api",
    "type": "backend",
    "stack": "shop",
    "port": 4000,
    "path": "services/shop/orders-api",
    "framework": "hono",
    "language": "bun",
    "discovered": true
  },
  "errors": []
}
```

`networks --json` previously returned a bare array. It now returns the versioned envelope. During migration, `networks --json-legacy` returns the old array and is scheduled for removal in CLI version 1.5.0; migrate consumers before that release to `data.services`. Existing text and raw output remain available.

Within schema version 1, additive fields are allowed. Clients should ignore unknown fields and reject unsupported major schema versions. Removing or renaming fields, changing their meaning, or changing collection shapes requires a versioned transition and migration notes. Text aliases and plural command aliases remain supported.

Minimal polling example:

```sh
if flisk status --json >status.json; then
  jq -r '.data.stacks[] | [.name, .resourceCount] | @tsv' status.json
else
  jq -r '.errors[]?.message, .data.resources[]? | strings' status.json >&2
fi
```

Example output for `flisk projects --json` in a configured project with a `shop` stack and one resource that is not in any stack:

```json
{
  "schemaVersion": 1,
  "data": {
    "projectRoot": "/home/dev/orders",
    "configured": true,
    "missingFiles": [],
    "resources": 3,
    "stacks": ["shop"],
    "unassignedResources": 1
  },
  "errors": []
}
```

The master configuration files are `TILT_TECH_STACK.star`, `TILT_RESOURCE_DEFAULTS.star` and `spec.master`, which `flisk project` generates in `.flisk/.flisk-out`. In a project that has not been configured yet, `configured` is `false` and `missingFiles` lists the files that are not there. `resources` and `stacks` are still filled in from the `service.json` files that were discovered, so an unconfigured project looks like this:

```json
{
  "schemaVersion": 1,
  "data": {
    "projectRoot": "/home/dev/orders",
    "configured": false,
    "missingFiles": ["TILT_TECH_STACK.star", "TILT_RESOURCE_DEFAULTS.star", "spec.master"],
    "resources": 0,
    "stacks": [],
    "unassignedResources": 0
  },
  "errors": []
}
```

Without `--check`, `flisk projects --json` exits `0` in both cases, so read `data.configured`. With `--check`, the same response is printed and the exit code is `0` when every master file exists and `1` when any is missing, which makes it usable as a CI gate: `flisk projects --json --check`. `--check` only looks for the master files. It does not validate `service.json` files (use `flisk config verify --json` for that) or check that the containers are healthy.

Outside a project, `flisk projects --json` (with or without `--check`) prints `data: null` and one `NOT_IN_PROJECT` error that includes `suggestions`, writes the message to stderr and exits `1`:

```json
{
  "schemaVersion": 1,
  "data": null,
  "errors": [
    {
      "code": "NOT_IN_PROJECT",
      "message": "Could not find project root (no .flisk/project.json found)",
      "suggestions": [
        "Run this from within a Flisk project",
        "Run `flisk project --yes` to initialize a new project"
      ]
    }
  ]
}
```

Example output for `flisk up --dry-run --json --only orders-api`, where `orders-api` lists `orders-db` in `dependsOn`:

```json
{
  "schemaVersion": 1,
  "data": {
    "ok": true,
    "dryRun": true,
    "stack": null,
    "services": ["orders-api", "orders-db"],
    "requested": ["orders-api"],
    "declaredDependencies": ["orders-db"],
    "command": "tilt up -f <path to Tiltfile> -- --focus=orders-api orders-api orders-db"
  },
  "errors": []
}
```

A dry run reports the plan and exits. It does not start Tilt or any services. Read `services` as the list that would start, and `declaredDependencies` as the part of it that comes from `dependsOn` in `service.json`. Shared infrastructure that Tilt always enables, such as Postgres and Traefik, is not listed. The `command` string contains the Tiltfile path on your machine, and is just `tilt up` when neither a stack nor `--only` is given. Without `--only`, `requested` and `declaredDependencies` are absent. This is an illustrative example, and a dry run still runs the checks that `flisk up` runs first (for example, it refuses a project whose generated files were edited by hand). If one of them fails, `data` is `{"ok": false}` and `errors` explains why.

Example output for `flisk up --json`:

```json
{
  "schemaVersion": 1,
  "data": {
    "ok": true,
    "stack": null,
    "services": ["orders-api", "orders-db"],
    "tiltUrl": "http://localhost:10350",
    "urls": [
      { "service": "orders-api", "url": "http://api.shop.localhost/api/orders", "didAnswer": true, "status": 404 },
      { "service": "orders-api", "url": "http://api.shop.localhost/api/orders/health", "didAnswer": true, "status": 200 }
    ]
  },
  "errors": []
}
```

With `--only` (for example, `flisk up --json --only orders-api`), the response also includes `requested` (the services explicitly requested) and `dependencies` (the additional services Tilt enabled that you did not name). `services` lists every service Tilt actually enabled, which is `requested` plus `dependencies`:

```json
{
  "schemaVersion": 1,
  "data": {
    "ok": true,
    "stack": null,
    "services": ["orders-api", "orders-db"],
    "requested": ["orders-api"],
    "dependencies": ["orders-db"],
    "tiltUrl": "http://localhost:10350"
  },
  "errors": []
}
```

Success means startup reached the command's ready state: every expected non-deferred Tilt resource is built and running, and its Docker health check (if declared) has passed. Tilt continues running in the background after the JSON output is emitted, so scripting workflows should run the command in the background (for example, `flisk up --json &`).

With `--only`, the readiness guarantee applies to the requested services only (excluding any that are deferred). Dependency services appear in `services` and `dependencies` because Tilt enabled them, but they are not checked for readiness, so a dependency that is still starting or has failed does not change `ok`. Consumers that need a dependency to be ready must check it themselves.

If one or more resources fail to start or the readiness timeout expires (`FLISK_UP_READY_TIMEOUT_MS`, default 15 minutes), `data.ok` is `false` with `data.tiltUrl` and `data.failures`, and `errors` reports `UP_RESOURCE_FAILED` or `UP_TIMEOUT`:

```json
{
  "schemaVersion": 1,
  "data": {
    "ok": false,
    "tiltUrl": "http://localhost:10350",
    "failures": [
      {
        "name": "orders-api",
        "reason": "Build failed: exit status 1",
        "exitCode": 1,
        "code": "CRASH_LOOP",
        "suggestions": [
          "Run `flisk logs --service orders-api --source runtime` to read the crash output",
          "Fix the cause, then run `flisk up` again"
        ],
        "message": "Build failed: exit status 1"
      }
    ]
  },
  "errors": [
    {
      "code": "UP_RESOURCE_FAILED",
      "message": "Resources failed (orders-api: Build failed: exit status 1). Tilt is still running; inspect it or run: flisk down"
    }
  ]
}
```

Every `failures[]` entry, in a local-process run, a container/Tilt run, a `flisk up --wait` result, and the MCP `up` tool, carries these fields:

- `exitCode`: the last exit code of the service, or `null` when it never exited.
- `code`: one of `PROGRAM_NOT_FOUND` (exit code 127, a command or its program is not installed), `PORT_IN_USE` (a service port is already taken), `HEALTHCHECK_FAILED` (readiness or a health check never passed), `CRASH_LOOP` (the process kept exiting or a one-shot job did not exit 0), `DEPENDENCY_FAILED` (a service it depends on did not start) or `UNKNOWN`.
- `suggestions`: next commands an agent can run, for example `flisk doctor`, `flisk logs --service <name>`, `flisk down` or installing the named program.
- `program`: present with `PROGRAM_NOT_FOUND`, naming the missing executable when it could be identified. `reason` also names it; `reason` never contains "see its output above" in machine output, because a JSON or MCP caller never saw that output. The service's last log lines remain in `logs` when available.

Exit code 127 maps to `PROGRAM_NOT_FOUND` in both runtimes. A program that the preflight finds missing before any process starts has `exitCode` `null`, with `program` set. After a failure that stops the stack, the suggestion is `flisk up`, not `flisk restart`:

```json
{
  "schemaVersion": 1,
  "data": {
    "ok": false,
    "runtime": "native",
    "failures": [
      {
        "name": "shop-api",
        "reason": "kept exiting (bun is not on PATH)",
        "exitCode": 127,
        "code": "PROGRAM_NOT_FOUND",
        "program": "bun",
        "suggestions": [
          "Install bun so it is on PATH, then run `flisk up`",
          "Run `flisk doctor` to check your machine"
        ],
        "logs": ["sh: bun: command not found"]
      }
    ]
  },
  "errors": [{ "code": "UP_RESOURCE_FAILED", "message": "Local processes did not start: ..." }]
}
```

Ready also means every URL `flisk up` prints answers (#3211). After the resources are running, each printed service URL and its health URL is requested (at most 8 at a time, 3 seconds per request, retried within a 15-second deadline that no request runs past). A response whose connection closes before it fully arrives does not count, and an HTTPS URL's certificate is verified as usual. A routed bring-your-own service has no printed health URL unless its service.json declares a `healthCheckPath`. This checks reachability, not application health: any HTTP response from the service counts, its own 404, 500 or 503 and redirects (not followed) included. Only Traefik's own errors do not count, told apart by their body: its 404 `404 page not found` (`route-not-found`: no router for the URL) and its 502 `Bad Gateway`, 503 `Service Unavailable` or `no available server`, and 504 `Gateway Timeout` (`port-not-listening`: the route exists but nothing answers behind it). A refused connection to a local URL is `gateway-not-listening`; to another host (a `FLISK_SERVICE_BASE_URL` elsewhere), a timeout, or any other request error, it is `timeout` or `no-response`. For a URL that does not answer, the service's Tilt state and latest log lines are read: a variable those lines say is not set gives `missing-env` with `envName` (a best-effort hint from the logs), and an exited container gives `container-exited`. The `cause` values are a stable enum, but each one is the likely cause, inferred from the response and the logs; `message` and `nextCommand` are hints for a person and their wording may change. Deferred services are not requested, since a request would start them. Tilt keeps running so you can inspect it:

```json
{
  "schemaVersion": 1,
  "data": {
    "ok": false,
    "tiltUrl": "http://localhost:10350",
    "urls": [
      {
        "service": "orders-api",
        "url": "http://api.shop.localhost/api/orders/health",
        "didAnswer": false,
        "status": 502,
        "cause": "missing-env",
        "message": "the latest logs of orders-api say the environment variable DATABASE_URL is not set",
        "nextCommand": "add DATABASE_URL=<value> to .env, then run: flisk restart orders-api --rebuild",
        "envName": "DATABASE_URL"
      }
    ]
  },
  "errors": [
    {
      "code": "UP_URL_UNREACHABLE",
      "message": "Not ready: 1 of 2 printed URLs does not answer. ...",
      "suggestions": ["orders-api: add DATABASE_URL=<value> to .env, then run: flisk restart orders-api --rebuild", "Tilt is still running; stop it with: flisk down"]
    }
  ]
}
```

When services declare a `smoke` check, the checks are executed against public ingress endpoints after readiness is reached. If a smoke check fails, Tilt is automatically stopped and the command emits `UP_SMOKE_FAILED` before exiting with status 1:

```json
{
  "schemaVersion": 1,
  "data": {
    "ok": false
  },
  "errors": [
    {
      "code": "UP_SMOKE_FAILED",
      "message": "A smoke check failed; Tilt was stopped"
    }
  ]
}
```

Example output for `flisk down --json`:

```json
{
  "schemaVersion": 1,
  "data": {
    "ok": true,
    "stoppedTilt": [48213]
  },
  "errors": []
}
```

With `--prune-cache` (`flisk down --json --prune-cache -y`), the response also reports what was pruned from Docker's build cache:

```json
{
  "schemaVersion": 1,
  "data": {
    "ok": true,
    "stoppedTilt": [],
    "prunedCache": {
      "until": "24h",
      "reclaimed": "2.6GB"
    }
  },
  "errors": []
}
```

With `--dry-run --prune-cache` (`flisk down --json --dry-run --prune-cache`), `data.wouldPruneCache` reports `{ "until": "24h" }` without executing pruning.

By default (`flisk down --json`), the response also lists what happened to the project's Docker networks. A network that still has a container attached is kept, and `reason` is the first line of the Docker error:

```json
{
  "schemaVersion": 1,
  "data": {
    "ok": true,
    "stoppedTilt": [],
    "removedNetworks": ["orders_default"],
    "keptNetworks": [
      {
        "name": "orders_shared",
        "reason": "Error response from daemon: error while removing network: network orders_shared has active endpoints"
      }
    ]
  },
  "errors": []
}
```

`removedNetworks` and `keptNetworks` are present unless `--no-prune-networks` is given and only when the networks could be checked. With the flag, or when the project root or its configuration cannot be read, both fields are absent, so check for them before reading them. In JSON mode the human-readable "Removed networks" and "Kept network" lines are not printed, and a failed network cleanup does not change `ok`. The process ID and network names above are illustrative.

A failed shutdown is reported in the same envelope. If `tilt down` exits with a non-zero code, or a prerequisite check fails (Docker or Tilt missing or not responding), `flisk down` writes the details to stderr, exits with that code (the code from `tilt down`, or `1` for a missing prerequisite), and stdout contains one object with `data.ok` set to `false` and a `DOWN_FAILED` error:

```json
{
  "schemaVersion": 1,
  "data": {
    "ok": false
  },
  "errors": [
    {
      "code": "DOWN_FAILED",
      "message": "flisk down exited with code 1"
    }
  ]
}
```

When the command printed an error before it stopped (for example `Could not find project root`), `message` is that error and `suggestions` lists its hints, so a script gets the real reason from the JSON alone. Otherwise `message` ends with the exit code of the command. A failed shutdown has no `stoppedTilt` or network fields, and containers may still be running, so run `flisk status --json` or `flisk doctor --json` to see what is left. Outside a project, `flisk down --json` does not use this shape: `data` is `null`, `errors` has one `NOT_IN_PROJECT` entry with `suggestions`, and the exit code is `1`.

New resources created by `flisk resource` include a per-file `$schema` reference to the hosted service manifest schema. VS Code's JSON language service uses that reference for completion and validation; the generator leaves `.vscode/settings.json` untouched, so existing project editor settings remain intact. Resource registration adds the reference only when one is absent and preserves a user's existing `$schema` value.
