# Changelog

Notable changes to the `flisk` CLI. Versions match [npm](https://www.npmjs.com/package/@flisk-sh/flisk?activeTab=versions) and the [binary releases](https://github.com/flisk-sh/releases/releases).

## Unreleased

- Re-running `flisk resource` over an existing service no longer reports "registered successfully" for a no-op. If the requested `--type`, `--stack` or `--port` disagrees with the existing `service.json`, the command now exits non-zero, names the existing resource and leaves every file untouched; with nothing to change it prints "<name> already exists, nothing to do" and does not rewrite the manifest. The old ignored-flag warnings and JSON fields are gone: a conflicting flag is now an error, not a warning (#5416).
- `flisk demo` prints where the host dependency install landed, how much disk it uses and that the folder is safe to delete (#5344). New `flisk demo --reset` stops the demo stack and removes the marked demo folders (`~/.flisk/flisk-demo` and `~/.flisk/flisk-demo-native`, or `--project <dir>`), reporting the space reclaimed; unmarked directories are left alone.
- The generated `.tiltignore` now anchors generic folder names to the project root or per-service output paths, so Tilt keeps watching source folders and resources named `logs`, `build`, `out`, `dist`, `tmp`, `temp` or `coverage`. `.flisk/project.json` accepts `tiltignore.exclude` to remove generated lines and `tiltignore.extra` to append project-specific patterns (#5387).
- `flisk ui` now shows whether Tilt is running in the header, alongside the CLI version, project path and discovered-resource count; the status reuses the same Tilt answer that already supplies per-service states (#452).
- `flisk project --force` now saves the previous `.flisk/project.json` to `.flisk/project.json.bak` and lists every key it resets (for example `discovery.paths`, `phases.beta.enabledStacks` and `project.version`) before rewriting it. The `--name` refusal suggests renaming `project.name` first and warns that `--force` also resets those keys. The backup path and reset key names are included in `--json` output (#5477).
- `flisk project` no longer names every project whose folder has no ASCII letters or digits `my-project`. It derives a stable `project-<hash>` from the absolute folder path instead, and prefixes digit-leading names with `p-` so they remain valid unquoted Postgres identifiers (#5418).
- `flisk up` no longer prints a false Postgres fallback notice on a machine where nothing listens on 5432. Flisk never tried that host port: the shared Postgres uses 15432 by default, so the notice now appears only when 15432 is taken, names a known holder of it, and suggests `FLISK_POSTGRES_PORT=15432` when an override is needed (#5510).
- `flisk resource` now gives a scaffolded service the project's package scope (for example `@shop/api`) instead of the literal `@project/api`, so two projects can share one Bun workspace without colliding. The scope comes from `project.name` or the checkout folder, the same source as the root workspace manifest; when neither is usable the service package stays unscoped. The ORACLE package-scope invariant is no longer a known gap (#5480).

## 1.4.74 (2026-11-24)

- Binary releases no longer publish the redundant `flisk-cli-<tag>-binaries.zip`. The five platform binaries, `flisk-cli-engine.tar.gz` and `checksums.txt` remain, and `checksums.txt` still covers every file the installers download (#4189).
- `flisk up` and `flisk run` now pass `params` (or the deprecated `envVars` when `params` is absent) to a service that declares `command`, the same non-secret contract a container's generated env file has. Values reach the process literally; `env` keeps its `${VAR}` expansion and wins on a shared name. `flisk config verify` and `flisk doctor` report a malformed `params`/`envVars` on a `command` service (#5106).
- `flisk tool add litellm` prints the steps to run the LiteLLM gateway as a bring-your-own image on port 4000: the project's Postgres stores a virtual key per agent with its own `max_budget`, dependent agents take `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` from the gateway's `provides`, and a cost-per-task recipe in `docs/agents/ai-agents.md` shows budgets and spend per key (#4056).
- `flisk repos clone` accepts the `dir` values of configured repositories (`flisk repos clone services/orders`) and clones only those instead of failing with `too many arguments`; without arguments it still clones every missing repository. An unknown `dir` exits `1` naming the valid values, and `flisk repos clone <dir> --json` reports it as an `UNKNOWN_REPO` error (#4969).
- `flisk logs --service <name>` on a project that runs under Tilt checks the name against the project's resources before contacting Tilt, so a mistyped service reports `Resource "<name>" not found in project.` with the valid names (and the `UNKNOWN_RESOURCE` code in `--json`, like `restart` and `run`) instead of "Could not reach Tilt" when the stack is down. When discovery skipped a `service.json`, or the project is orchestrated by an imported Tiltfile, the running Tilt's own resource list decides instead, so a real service is never reported unknown. A local-process (`command`) project still reports an unknown `--service` name as `UNKNOWN_SERVICE` with exit code `2` (#4971).
- `flisk up --only <name>` in a project with no resources now reports the same "This project has no resources yet" refusal as plain `flisk up` (exit 1, `NO_RESOURCES` under `--json`) instead of `Unknown service <name>. Valid names:` with an empty list and exit 2; the unknown-service error no longer prints a dangling `Valid names:` when there are no names to list, and points at adding a resource instead (#4966).
- `flisk doctor --json` now reports `dockerUsage` with `imageBytes`, `reclaimableBytes` and `totalBytes` from `docker system df`, alongside the existing `buildCache` and `colimaDisk` fields, so disk use is readable by machine on any Docker host (#4067).

## 1.4.73 (2026-11-22)

- `flisk doctor` warns about Flisk projects whose `tilt up` has been running for 48 h or more: for each one it prints the uptime, container and volume counts, container data size and the exact `flisk down --project <path>` command, plus pointers to stale-project pruning and the Colima trim (#4772).
- `flisk doctor` reports a fresh worktree or clone's missing local dependencies (a gitignored `node_modules` or `.venv`) with the install command for each, and points at another worktree's `.env` with a copy command it never runs itself; `flisk up` prints the same `.env` hint before starting services. The findings are in `--json` and the MCP `doctor` tool (#4830). The file-sharing check is skipped when the Docker daemon is unreachable (#4812), and `flisk doctor --problems-only` (also on the MCP `doctor` tool) filters to the findings (#3851).
- `flisk up --dry-run` runs the native preflight — invalid plan, toolchain, missing program and port-in-use checks — so a dry run fails with `ok: false`, exit 1 and actionable errors instead of printing an unusable plan (#4783). `flisk up` also retries transient install-deps failures such as `FailedToOpenSocket` (#3957), and it sees the program after a leading `cd` in a setup job, so the generated `langgraph` and `tool-loop` starters run their setup (#4676).
- `flisk config verify` checks hand-edited platform compose files (#3735) and collects all invalid `project.json` fields at once instead of stopping at the first (#4574). Project regeneration is serialized and vendored directories are staged atomically, so two writes can no longer interleave (#4762).
- `flisk status` no longer reports `router (Traefik): on` and `PostgreSQL: on` in a local-process project, where nothing runs them (#4671).
- `flisk eject` writes an `EJECTED.md` that fits a local-process project — run each service's `command` from its folder, with a table of commands and ports — lists a ready-made image container with its image and port instead of claiming the project has no containers, and reports the runtime in `--json` with a null `tiltUpCommand` (#4424).
- `flisk upgrade` resolves the latest version without requiring npm: it falls back to the registry HTTPS lookup, keeps npm's configured registry when npm is there, and reports the real failure instead of blaming the network (#4719).
- New `flisk repos list` lists the repositories configured in `.flisk/project.json` and their checkout status without cloning, with `--json`; `flisk repos` still clones them (#4564).
- `flisk up <stack>` accepts a single stack selector and shows a resources hint; conflicting and empty selectors are refused before the lookup (#4660).
- `flisk kill` suggests `flisk down`, `flisk start` suggests `flisk up`, and `flisk completion bash --shell zsh` refuses the conflicting shell argument and option instead of silently keeping the option (#4474, #4433). `flisk help` lists `demo`, and `flisk help demo` shows its own help (#3743).
- Generated services get `FLISK_CHECKOUT_ID` and `FLISK_CHECKOUT_NAME`, so a git worktree's services can tell which checkout they run from (#4771).
- The Claude Code plugin ships a PreToolUse guard for Flisk-generated paths, a PostToolUse `flisk config verify --json` check after `service.json` edits, and a read-only `flisk-verifier` subagent; the skills explain `flisk connect claude` when the MCP tools are missing (#4833).
- The `inference` preset mounts a named model volume and sets `OPENAI_BASE_URL`, and the tool-loop starter reads `MODEL` and both base URLs from the environment, including a real OpenAI-compatible `/chat/completions` tool loop with the mock as the default (#4836).
- A Windows clone with Git's default `autocrlf=true` no longer checks out shell, Python, Starlark and Dockerfile sources as CRLF (which broke Linux containers on CRLF shebangs): `.gitattributes` pins LF for them and CRLF for PowerShell, and the generated Docker templates normalize CRLF scripts instead of blaming the registry (#4006, #4820). On native Windows the printed next steps are the Windows ones (#4811).
- Starters cloned with `flisk project` no longer bring the template author's `SALES_PITCH.md` and `DEMO_GUIDE.md`; a per-template omit list strips those paths and their README links (erp, user-management, restaurant, saas, demo) (#4766).
- `flisk networks` checks URL status with Node's fetch instead of `curl` (#4002), and `flisk import` uses `bunx` when `npx` is unavailable (#4845).
- `flisk demo` shows why an image is building and port-aware log hints (#3958).
- A non-empty `FLISK_LICENSE_KEY` no longer points package scopes at a Verdaccio registry the free-tier stub never starts; scope routing now needs an explicit project opt-in and a non-stub loader (#3956).
- The unscoped image-prune loops in `watchers.star`, which ran host-wide cleanup with no caller, are removed (#4838).

## 1.4.72 (2026-11-21)

- `flisk logs --json` lines carry a monotonic `seq` and the envelope carries `nextCursor` and `truncated`; `--after <cursor>` returns only newer lines, and the MCP `logs` tool's `after` parameter works the same way (#4786).
- `flisk create --json` emits a versioned envelope for dry runs and real runs and routes errors through the shared JSON path (#4788).
- `flisk resource` keeps a service's existing port when re-registering it instead of reserving a new one (#4183).
- `flisk tool add postgresql` refuses in a local-process project before writing anything — the shared Postgres is a Flisk-managed database with no ready-made image to mix with `command` services — and explains the image-backed alternatives; `mysql` and `mongodb` already use pinned images (#4790).
- An unknown command under `--json` exits 1 again with the `USAGE` envelope; a parser-wide exit-2 change had moved it to 2. Did-you-mean hints still travel in `errors[0].suggestions` (#4533).
- `flisk demo` shows the previous-stack reset and the first Tiltfile evaluation in its fixed phase frame, so a clean start can be verified as one load (#4801).

## 1.4.71 (2026-11-20)

- The Claude Code plugin starts its MCP server through a shipped Node launcher instead of a `#!/bin/sh` script, so the plugin works on native Windows and on machines without `/bin/sh` (#4012).
- `flisk doctor` no longer fails the "Tilt Resources" check with another project's failing resources when that project's Tilt owns the UI port. It skips the check, names the foreign project, and points at `flisk up` for this project; `flisk status` and doctor now share the same Tilt-port ownership lookup (#4016).
- `flisk config verify --json` and the `config_verify` MCP tool now lead with a small report: every error line plus each drifted file's path, state (`missing` or `different`) and line counts, instead of whole generated files as diffs. The MCP text part is a short human summary rather than a second copy of the JSON, so a project with several missing files stays under 4 KB. Full diffs are opt-in with `flisk config verify --diff <file>` or the tool's `diffFiles` argument, capped at 200 lines per file with a note when cut (#4205).
- `flisk project <starter>` generates the master configuration files before it prints the next steps, so `flisk config verify` passes on a freshly scaffolded project instead of reporting missing `.flisk/.flisk-out/` files (#4196).

## 1.4.70 (2026-11-20)

- `flisk tool add openapi-mcp` prints the steps to run an OpenAPI-to-MCP gateway as a bring-your-own image, and `flisk tool add rag` points at a new recipe for the Qdrant MCP server with one collection per customer. A second recipe shows a policy check that refuses a `pay` tool call above a limit (#4060).
- The golden image publish check holds each layer to its own size budget (measured size plus 10%, in `scripts/golden/size-budgets.json`) instead of one 400 MB cap, and `docs/golden-image-sizes.md` lists what each layer holds (#2692).
- `flisk runtime --check-assets --json` now returns the standard envelope (`{"schemaVersion":1,"data":{"ok":...},"errors":[]}`) instead of a bare object; on failure `errors` carries a `RUNTIME_CHECK_FAILED` entry and the exit code is `1` (#4467).
- `flisk project langgraph`: a run started with `"approve": true` stops at LangGraph's `interrupt()` before its side effect and waits for `POST /runs/:id/resume`, however often the agent restarts; the side effect is keyed by the run, so a resumed run sends once (`agent/effects.mjs`). With `DATABASE_URL` set the agent uses the Postgres checkpointer (`@langchain/langgraph-checkpoint-postgres`) and an `agent_effects` table instead of files. Runs without `approve` are unchanged (#4057).

## 1.4.69 (2026-11-17)

- `flisk export` and `flisk import` pass arguments to npx on Windows without `cmd.exe` splitting them: a path with a space no longer breaks the call, and `&` or `|` in an argument can no longer run a second command (#4004).
- `flisk logs` reads a local service's log tail backwards from the end of the file instead of loading it whole, whatever `--tail` says, and the supervisor rotates `<service>.log` at 10 MB keeping one old file, so an always-on local service no longer grows its log forever (#3720).
- `flisk logs --source runtime|build` (and the MCP `logs` tool's `source`) selects the service's own output or its build log, so a crash cause is readable without the image-build lines mixed in (#4482).
- `flisk up --json` and the MCP `up` tool report where a native start stands (`state: ready | starting | failed | timeout`, plus `ready`) instead of leaving an agent to infer it from a launched process, `up` gains `waitForReady` (default 120 s, max 600 s), and a failed local process carries its last lines in `failures[].logs`; `resource_restart` works in place on native resources (#4506, #4510).
- `flisk demo` refuses an unknown root option such as `--dry-run` before anything is fetched, written or started (#4487).
- `flisk down` verifies a recorded pid's identity before stopping it in a local-process project, so a recycled pid is not killed (#3960).
- Two `flisk resource` creates running at the same time reserve their ports, so they can no longer pick the same one (#4023).
- Every argument-parser usage error (unknown command or option, missing argument or option value) returns the standard `USAGE` envelope under `--json`, not only in `down`, `status` and `logs`; the "Did you mean" line moves into `suggestions`, and the plain-text path is unchanged (#4246).
- `flisk resources --stack nosuch` lists the project's stacks when no name is close, like the unknown-resource error already did (#4515).
- A project `.env`'s `DATABASE_URL` for the shared Docker Postgres is no longer passed to local-process services that declare no database (#4456), and a local project whose services run `npm run dev` needs and reports `npm`, not Bun (#4459).

## 1.4.68 (2026-11-16)

- `flisk logs`, `flisk restart` and `flisk status` accept `--project <path>` outside a project, so a running project can be inspected and restarted from any directory; a nonexistent path is refused (#4413).
- A mistyped starter, resource type or tool name answers with one "Did you mean ..." line instead of only the full list: `flisk project sas`, `flisk resource --type bakend`, `flisk tool add reakt` (#4287, #4400). An action word such as `validate` or `check` suggests `flisk project --check` (#4435).
- `flisk down` and `flisk status` print a positional-argument hint and route usage errors through the `--json` envelope (#4251).
- `flisk upgrade --dry-run --json` returns the standard envelope (#4262).
- The Tilt manifest check accepts a multi-line `container.command` (an `sh -c` script), matching the CLI check and the Compose generator, so an imported service with such a command no longer fails `flisk up` with a manifest error (#4386).
- A Prisma service's image builds again when Bun's isolated linker makes `node_modules/prisma` a symlink: the purger stage copied the link itself, so the runtime `COPY --from` failed; it now dereferences it (#4409).
- `flisk resource`'s printed next steps shell-quote the `cd` path when it needs quoting (#4450).

## 1.4.67 (2026-11-16)

- `flisk project launch`, `fullstack` and `portal` leave the new project on its `main` branch at the pinned starter commit instead of a detached HEAD, so your first commits are on a branch (#4286).
- `flisk config verify` reports an `appName` used by more than one resource, which `flisk up` already refused, so a green verify no longer hides it (#4190).
- `flisk project --list --json` now returns the standard envelope (`{"schemaVersion":1,"data":{"templates":[...]},"errors":[]}`) instead of a bare array; `key`/`repo`/`description`/`ref` are unchanged (#4247).
- New `flisk agent list` subcommand lists the project's agent resources (#4249).
- `flisk project <starter>` puts generated and composed starters in a folder named after the starter instead of the flisk repository, so a second bundled starter no longer collides with the first (#4199).
- `flisk resource` validates the name and `--type` before the project-root lookup, so a bad value is reported even outside a project (#4359), refuses a name that is also a command, and needs explicit non-interactive flags (`--yes`) for scripted creation (#3994).
- `flisk up` keeps probing a ready URL that times out for 60 s instead of giving up after 15 s, so a dev server's slow first request (Vite compiling its first page) no longer fails the run; a refused connection still fails after 15 s (#4357).
- `flisk restart` restarts a container resource directly without a Tilt rebuild (#4192).
- The stack runs on Kiri, which speaks the Docker Engine API: `flisk up` points Traefik at Kiri's Docker socket on Linux, creates `traefik-dynamic` readable by Kiri's classic builder, and the local-process demo runs on it (#4344, #4351, #4364).

## 1.4.66 (2026-11-15)

- `flisk run`, `flisk restart` and `flisk agent sessions` answer an unknown resource name the same way: one `UNKNOWN_RESOURCE` error with the project's resource suggestions, in `--json` too; `run` used to report `RUN_FAILED` with a different message and no `--json` suggestions (#4253).
- The CLI starts faster: command modules load lazily instead of all at startup (#4212).
- `flisk up --wait` takes a fast no-op path when the services it would start are already ready (#4193).
- `flisk up` outside a project refuses with the project-root error before it touches Docker; it used to prune `tilt-<hash>` images and trim the build cache on the way to the refusal (#4282).
- `flisk doctor` names the container engine it finds in a `Container Engine` row (Kiri, Colima, OrbStack, Docker Desktop, Podman, Docker Engine) and says what Kiri can and cannot run (#4311).
- A Tiltfile load makes fewer shell-outs: file and directory existence checks answer in-process instead of one `test -f`/`test -d` each (125 to 61 shell-outs on the shop probe) (#4237).

## 1.4.65 (2026-11-15)

- `flisk doctor --json` on a usage error now returns `data: null` instead of a placeholder report claiming `inProject: false`, matching `logs` (#4252).
- A new Python (FastAPI) backend's `/health` checks the database when `DATABASE_URL` is set and answers 503 with the reason, so a wrong password shows as that service failing (#683).
- The Python dev loop is measured through a real `flisk up`: a source edit is synced and uvicorn reloads without an image rebuild, median save-to-ready 0.50 s (plain `uvicorn --reload` 0.24 s); first start 41 s, start with a warm image 19 s. The numbers and the script are in `docs/backend-language-providers.md` (#683).
- `flisk config verify` on a Docker project that was never generated reports one "not generated yet" finding (`data.state` `not_generated`) instead of one error and one diff per file (68 errors and 54 KB for the saas starter); a deleted or edited generated file is still reported (#4219).

## 1.4.61 (2026-11-13)

- New `flisk tool add weather`, `flisk tool add chart` and `flisk tool add services` add the Flisk Chat widgets by name, in the same way as the other tools (#4106).
- The CLI's status markers are plain ASCII on terminals that cannot show UTF-8 and on `TERM=linux` consoles, so they no longer print as broken characters (#4105).
- `flisk doctor` and `flisk up` now name the process that holds a conflicting port on Windows too; they used to name it only on macOS and Linux (#4029).

## 1.4.60 (2026-11-13)

- New `flisk tool add <tool> [name]` adds a tool by the name people know it by (`react`, `nextjs`, `nodejs`, `fastapi`, `postgresql`, `mysql`, `mongodb`, `rag`, `embeddings`, `llm-api`) by running the matching `flisk resource` command. It refuses a name already in use, validates `--stack` before anything runs, reports one error outside a project, and rejects cloud providers (#4038, #4040, #4065, #4066).
- `flisk resource <name> --type mail` runs Mailpit, a local mail catcher, and `--type payments` runs stripe-mock, a local Stripe API stand-in, so an app can send mail and take payments without a cloud account (#4020).
- Infrastructure types are one table of presets. MinIO moves from `--type queue` to `--type storage`; the other types are unchanged (#4017).
- `flisk resource <name> --type ... --dry-run` shows the scaffold plan without writing any file, and scaffold plans and registration reports are validated before they are written (#3996, #3997).
- Shell completion offers the fixed values of flags such as shell, scope, runtime and starter (#3986).
- `flisk project <starter>` keeps the starter repository as `origin`'s upstream and shallow-clones unpinned templates; pinned commits are kept as before (#3987).
- A scaffolded worker's `dev` command runs a script that exists in its `package.json`. It used to run `bun run worker`, which the template does not have, so the first `flisk up` failed (#3740, #3988).
- `flisk logs` says so when a local-process service has not written any log line yet, instead of printing nothing (#3990).
- `flisk up` and `flisk down` keep only the newest `tilt-<hash>` image of each service and untag the older ones, so a stack that is never stopped no longer piles up tagged images (#4067, #4069, #4074).
- Versions 1.4.58 and 1.4.59 were released without changelog entries; their changes are listed here.

- The Next.js frontend image no longer stores `node_modules` twice. A `chown -R` over the app folder after `npm install` added a second layer of 387 MB for a minimal app and a slower cold build; ownership is now set by `COPY --chown`, and the development stage chowns only the app folder and `.next`. Images already built keep their size until they are rebuilt.
- On Colima and Lima, `flisk down --prune-cache` now trims the VM after pruning and prints how much space went back to the Mac, and `flisk doctor` has a `Colima Disk` check (also in `--json` as `colimaDisk`) that compares the VM's disk file with what `docker system df` reports and warns when it is more than 3x and 5 GB larger. The disk file only shrinks after `fstrim`, so freed Docker space stayed unavailable on the Mac. `flisk doctor --fix` plans the trim for that case too (#4071).
- A scaffolded Prisma migrator image is 175 MB smaller (606 MB to 431 MB of layers, 478 MB to 303 MB over the shared golden base). The relink step copied `@prisma/client`, `adapter-pg` and `engines` a second time in their own layer (98 MB) and is gone, and the build moves aside the TypeScript native compiler, pglite, elkjs, react-dom and the query-plan executor, which `migrate deploy` never loads, and puts them back if `prisma validate` then fails. The prisma e2e suite has a new case (P5) that fails when the migrator holds more than 400 MB over its base. Part of #4070; the 100 MB target needs the migrator to share the API image's dependency layer, which this does not do.

## 1.4.57 (2026-11-11)

- Two projects with the same name in different folders (two clones of a starter, git worktrees, `flisk demo` next to your own copy) share one set of Docker containers and one Postgres volume. `flisk up` now stops, before it replaces anything, when another existing folder already has containers of this project name, and says which folder and how to rename the project. `flisk down --purge` (and its `--dry-run`) refuses when another folder holds the project's containers or is recorded in `~/.flisk/projects`, so it can no longer delete a database that another folder uses (#3961).
- `flisk demo` no longer deletes the database volume of your own project that has the demo's name. The starters `demo` and `restaurant` are one repository, so a copy made with `flisk project restaurant` shares the project name `flisk-restaurant-example` and its Docker volume with the demo, and a fresh demo run removed that volume to avoid a Postgres password mismatch. The demo now stops, before it deletes anything, when another existing folder recorded in `~/.flisk/projects` holds that name and a volume of the name exists, and says which folder and how to go on (#3963).

## 1.4.55 (2026-11-11)

- The wake-gateway image (built when a resource uses `sablier.deferStart`) is now one `flisk-wake-gateway:<tilt version>-<hash>` per machine instead of one copy per project, so two projects no longer hold 2 x 257 MB. The tag changes when its Dockerfile, Tilt version or sources change. `flisk down --purge` keeps it while a container of another project still runs from it, and still removes the old `<project>-traefik-wake-gateway` copies (#3837).

## 1.4.53 (2026-11-11)

- `flisk projects --stale` reuses its Docker artifact listings across recorded stale projects instead of rerunning the same four listings for each one (#3786).

## 1.4.46 (2026-11-09)

- Editing a new Bun backend now reloads it. The `development` image of a Bun backend used to be the compiled `dist` build, so `flisk up` copied your edit into the container and the old code kept answering. When the `dev` script in `package.json` runs under `bun --watch` (the scaffold does), `flisk up` now builds a development image that runs that script, and a saved edit restarts the app within seconds. Set `"dev": { "liveReload": false }` in `service.json` to keep the compiled build; a Dockerfile you wrote yourself is still built as `production`. Fixes #3395.
- Flisk can be installed on Windows with Scoop: `scoop bucket add flisk https://github.com/flisk-sh/scoop-bucket`, then `scoop install flisk/flisk`. On such an install, `flisk upgrade` now tells you to run `scoop update flisk` instead of replacing files Scoop owns.

## 1.4.45 (2026-11-08)

- Flisk can be installed with Homebrew: `brew install flisk-sh/tap/flisk`. On such an install, `flisk upgrade` now tells you to run `brew upgrade flisk` instead of replacing files Homebrew owns.
- `flisk projects --stale --prune` asks before deleting; `--yes` skips the question, and a run with no terminal or with `--json` needs it.

## 1.4.44 (2026-11-08)

- The Claude Code plugin (`plugins/flisk-claude`) carries the skills only. The Claude directory refused version 1.0.0 because it shipped a local MCP server (`.mcp.json`) and a shell launcher, which it takes only from Verified organizations. Add the server yourself with `claude mcp add flisk -- flisk mcp`; the skills work through the CLI without it.

## 1.4.43 (2026-11-08)

- Fixed two data-safety bugs in 1.4.42's cleanup commands. `flisk down --purge` matched Docker names by prefix, so project `shop` could delete the database of an unrecorded `shop-admin`; it now matches only the exact names of the project's own infrastructure and stacks. `flisk projects --stale --prune` force-removed every project in the report, including Compose projects that are not Flisk's; it now deletes only projects `flisk up` recorded, and treats a folder it cannot check as still there.

## 1.4.42 (2026-11-07)

- `flisk up` pulls the golden base images from `ghcr.io/flisk-sh` by default and builds them locally only when the pull fails (offline, or no image for that hash). They used to be pulled only with `FLISK_GOLDEN_REGISTRY` set, so every machine and every new project rebuilt them (9 min and 2 GB of build cache on a cold Mac). `FLISK_GOLDEN_REGISTRY=off` keeps the local build. The publish workflow now runs on each push to main that changes the engine. (#3361)
- New `flisk down --purge` deletes this project's Docker volumes (database data), networks and images after stopping it, so nothing of a throwaway project stays in Docker. Without it `flisk down` keeps all three, as before. `flisk up` now records each project's folder in `~/.flisk/projects/`, and `flisk projects --stale` uses it to find the volumes, networks and images of projects whose folder was deleted (Docker records no folder on a volume, so these were invisible once the containers were gone); `flisk projects --stale --prune` deletes them. The stale report used to suggest `flisk down --purge`, which did not exist and cannot run in a deleted folder. The e2e scripts that start a scratch project (`hpc<pid>`, `prov<pid>`, smoke, go dev loop, byo ports) now also remove its Postgres volume; each run left one behind.

## 1.4.41 (2026-11-07)

- New database frameworks: `flisk resource <name> --type database --framework mysql|mongodb|clickhouse` run MySQL 8.4, MongoDB 8.0 and ClickHouse as containers of their own (pinned image, readiness probe, a data volume `flisk down` keeps) and give the services that list them in `dependsOn` `MYSQL_URL`, `MONGODB_URL` or `CLICKHOUSE_URL`. They sit beside postgres (the shared Flisk Postgres), redis, qdrant, minio and mlflow.

- `flisk resource --type database --frameworks` and `--type queue --frameworks` (and `--json`) list the infrastructure frameworks: postgres (default, the shared Flisk Postgres), redis, qdrant, minio, mlflow, and nats (default), rabbitmq. They used to fail with "No frameworks are registered". `flisk resource <name> --type database|queue` on a terminal now asks which framework.

## 1.4.34 (2026-11-04)

- `flisk up <git-url>` (#3188): a git URL in place of the stack name is shallow-cloned into `./<repo name>` and started from there; an existing checkout in that folder is reused.

## 1.4.33 (2026-11-02)

- Cycle-time scorer with median, p90, and slow PR detection (#3147): `make scores ARGS="--source all"` includes cycle time (time from open to merge) for recent PRs, reporting the median and 90th percentile to help identify process bottlenecks.

- Shared project checks between container and local-process lists (#3146): `flisk doctor` refactored to deduplicate project validation logic, ensuring the same checks run whether services use Docker or run locally.

- Postgres 18+ image volume mount validation (#3142): `flisk doctor` warns when a `postgres:18+` image mounts its volume at a non-standard path, as the default `/var/lib/postgresql/data` is required for proper data persistence.

- Service directory .env expansion (#3143): Services can now use `${VAR}` in their `env` values, with variables read from the service folder's `.env` file, allowing environment-specific configuration.

- Secrets generation to .env (#3144): `secrets.generate` entries in `service.json` let `flisk up` write missing development secrets into the project's `.env` once, without overwriting existing values.

## 1.4.24 (2026-10-31)

- Opt-in profiles (#2873): `"profiles": ["admin"]` in a `service.json` leaves the service out of `flisk up` unless `flisk up --profile admin` (or `--only <service>`) asks for it, so heavy parts stay off by default. `flisk up` says what it left out and refuses a profile no service declares. `scripts/benchmark/memory-footprint.mjs` measures a running stack's idle memory per profile; the restaurant demo idles at about 203 MiB ([memory footprint](benchmarks/memory-footprint.md)).

- A service can be ready by an open TCP port or a command, not only an HTTP path (#2875): `"healthCheck": { "port": 9090 }` or `{ "command": ["grpc_health_probe", "-addr=:9090"] }`. Containers get a matching compose health check (the port probe tries `nc`, bash's `/dev/tcp`, then bun or node), local processes wait for the port or for the command to exit 0, and Traefik gets no HTTP health path. Only one of `path`, `port` and `command`; `flisk config verify` refuses two.

- `flisk run <service> -- <command>` runs a one-off command with the environment the service has in the stack (#2872): in its running container (`docker exec`), or on the host from the service folder for a local process (project `.env`, its `env`, `PORT`). Interactive, with the command's exit code; `--json` returns `exitCode`, `stdout` and `stderr`. The MCP server gains `resource_run` for agents (23 tools).

- `"toolchain": "node@24"` in a local-process service's `service.json` says which runtime it needs (#2876): `flisk doctor` (**Service toolchains**) and `flisk up` compare it with the program on `PATH` and stop with `TOOLCHAIN_MISMATCH`, naming the service and both versions. Without it, a `.nvmrc`, `.node-version` or `.python-version` is a hint that only warns. Supported: node, bun, deno, python, go, ruby.

- `flisk doctor` warns about env values that point outside the local stack (#2874): a URL or `*_HOST` value in the project `.env`, a service's `env`/`params`, or a service folder's `.env`, `.env.local` or `.env.development`, whose host is not local. It prints the service, variable, host and file, never the value; `--strict` makes it fail; hosts that are meant to be remote go in `allowedHosts` in `.flisk/project.json`.

- A service that depends on a migrator, or on a bring-your-own job with `"restart": "no"`, now starts only after the job exited 0 (#2871). Tilt counted the job ready as soon as its container ran, so with cached images an API could start while its migrations were still running. Each such job gets a `<job>-done` resource that waits for it and fails when the job does, so the services after a failed job are not started. For local processes, a one-shot job with no port now counts as ready when it exits 0 and is never restarted, so services can depend on it.

- New resource type `database` (#2863): `flisk resource shop-db --type database` writes a `service.json` with `"appType": "database"` and `"framework": "postgres"` for the project's Postgres, so it shows up next to the services and they wait for it by name (`"dependsOn": ["shop-db"]`) instead of the magic name `postgres`. It is the same shared Postgres with one database per stack, and declaring it starts Postgres even with the database capability off. `postgres` and `database-management` in `dependsOn` keep working.

## 1.4.23 (2026-10-31)

- `npx @flisk-sh/flisk demo` no longer needs Docker. When Docker is not installed or not running, Compose or Tilt is missing, on native Windows, or with `--no-docker`, it writes a two-service menu app (an API and a website) to `~/.flisk/flisk-demo-native`, starts it as local processes on free ports and opens it, in about a second. With Docker and Tilt ready it still starts the full restaurant demo. A second run while it is up reopens it; `flisk down` stops it.
- Native Windows runs projects whose services each declare a `command`: `flisk up` no longer refuses them with the WSL2 message (Docker projects still get it), and `flisk down` ends each service's whole process tree with `taskkill /T` instead of leaving the program the shell started running.
- After a failed `flisk up` on a machine without Docker, the hints point to running services as local processes.

## 1.4.15 (2026-10-30)

- The migrator image no longer stores `node_modules` twice. A `chown -R` over the copied directory added a second 332 MB layer (1.54 GB against 181 MB for the agent next to it); ownership is now set by `COPY --chown`. Images already built keep their size until they are rebuilt.
- The MCP `up` tool no longer ends the whole MCP server when `projectPath` does not exist: the failed spawn emitted an unhandled `error` event and the connection to the agent dropped. It now returns an error result saying `flisk up` could not start.
- `flisk up` (also `--dry-run`) now refuses a `secrets.required` name that has no value in the env file of the run or the environment, naming the service.json and the secret. Compose refuses to interpolate such a name, which failed the whole Tiltfile and stopped every service, not only the one that needs it. Set `FLISK_SECRET_PROVIDER=infisical` to leave the names to Infisical.
- `secrets` in service.json must be `{ "required": [...], "optional": [...] }` of environment variable names; any other shape (a bare list, a name such as `1BAD` or `A-B`) used to pass the check and then failed the Tiltfile.
- `flisk up` and `flisk config verify` warn when `params` or `env` sets a name that `secrets` also declares: the literal wins and the secret from `.env` is ignored.
- `flisk config regenerate` lists the services whose generated files (compose, Dockerfile) are older than their service.json (`staleServiceOutputs` in `--json`) and says `flisk up` writes them; it rewrites only the master files.
- A command that throws inside an async action (a corrupt `.flisk/project.json` read by `flisk networks`) now prints one error line and exits 1 instead of ending as an unhandled rejection with a raw runtime stack trace.
- Resource and stack names must start and end with a letter or digit: `--json` taken as the value of `--stack` created `services/--json/<name>`, and `-x` or `x-` passed the name check and were refused later by Docker.
- A service with its own `dockerfile` (one outside `.autogenerated`) no longer fails the whole Tiltfile with "refused to write outside its generated-file allowlist". Flisk wrote a `.dockerignore` next to it; it now leaves the Dockerfile and its own `.dockerignore` alone. A service whose `command` runs without Docker reads `dependsOn` like the Docker path: the deprecated `dependencies` key counts and a stack name means its services.

## 1.4.14 (2026-10-29)

- `dependsOn` now means the same everywhere. `flisk up --only`, the circular-dependency check, `flisk config verify` and the generated Tiltfile read one graph: a service name, a stack name (the stack's other services, never its frontends, as with `--focus`), a frontend's `backendName` (also when the backend is in another stack) and the deprecated `dependencies` key.
- A frontend that named a stack in `dependsOn` no longer fails the whole Tiltfile with `string value is not iterable`. A `dependsOn` written as a string, object or `null` no longer crashes `flisk config verify` (`{} is not iterable`) or splits into one unknown name per character; both commands report one clear error.
- `flisk config verify` reports circular `dependsOn` and wrong-typed `dependsOn`, as `flisk up` already refused them. `flisk up` warns about a `dependsOn` name that is no service, stack or shared Postgres name, and the dry-run JSON lists them as `unknownDependsOn`.
- `flisk up` now refuses, before anything starts, the `service.json` values that used to pass and then stopped inside Tilt, Compose or Docker: an `appName` or `stack` Docker cannot name an image after (uppercase, spaces, `/`, a leading or trailing separator, over 63 characters), a field of the wrong type (`traefik`, `sablier`, `params`, `build`, `featuresEnabled`, `image`, `replicas` outside 1-10), an absolute `dockerfile`, `buildContext` or `dev.watch` path (build paths are relative to the service directory; `..` stays allowed, so a service can build from a tree outside the project, as `flisk import` writes for a Compose app), and `image` together with `dockerfile`.
- The frontend env no longer gets a `VITE_<NAME>_API_URL` line for a typo, a stack or the shared Postgres, and each line uses the route Traefik serves that backend on, the same as `VITE_API_URL`. It no longer reads the deprecated `dependencies` key in place of `dependsOn`.
- `flisk up --only <service>` starts the service's `backendName` and the stack's services, as the Tiltfile waits for them.
- A service named `alpha`, `beta` or `pre-alpha` is no longer taken for the release phase of that name by `--focus`, which started every service.
- A new `service.json` now reloads a running Tilt: the discovery daemon wrote its snapshot outside the watched path and scanned `services/product` from inside `.flisk/.flisk-out`.
- `flisk up` now also refuses a frontend `framework` that is not registered (it used to stop inside Tilt with "Unknown frontend framework for Vite generation") and `replicas` above 1 on a frontend (Tilt looked for a `<name>-1` Compose service that is never generated), and warns about a frontend whose `backendName` is no service of the project (`unknownBackendNames` in the dry-run JSON).
- Found by running a real stack: the discovery daemon was created but stayed **Disabled** in every `flisk up` (focus runs leave out whatever the allowlist does not name), so a service added while the stack ran never appeared. It is now on the allowlist. A stack that is already running keeps its old state: run `flisk config regenerate`, then `flisk down` and `flisk up`.
- Found by running a real stack: when Tilt itself rejected a circular `dependsOn`, it stopped watching every `service.json`, so removing the cycle did nothing and the stack stayed on the old graph until restarted. The Tiltfile now catches the cycle first, as an ordinary error that names it, and reloads by itself once it is gone.
- Found by running a real stack: after an edit the Tiltfile cannot load (a cycle, a wrong-typed field), `flisk status` said every service was healthy. It now prints "Tilt could not reload the Tiltfile: ..." and `--json` has `tilt.tiltfileError`.
- The discovery daemon's output is line-buffered, so "Changes detected" shows in Tilt's log when it happens instead of minutes later.
- New tests: `tests/chaos` (random `service.json` edits checked against Tilt, `flisk up` and `flisk config verify`; a Docker tier that follows each value into the generated Compose file and Dockerfile; a bulk check that runs millions of good and corrupted `service.json` sets through the gates).

## 1.4.3 (2026-10-25)

- `flisk init` is now an alias of `flisk project`. It accepts the same template names and flags.

## 1.3.195 (2026-10-21)

- `flisk demo` and `flisk restaurant` now clone the demo template into a fixed directory (`~/.flisk/flisk-demo/`) instead of creating `tdk-restaurant-example-N` directories in the current workspace. Previous runs are cleaned up automatically. The `restaurant` template still creates a named directory in the current folder when used explicitly.

## 1.3.194 (2026-10-21)

- `flisk open` now opens the frontend of the project that was started, not the current working directory. The one-command flow (`npx @flisk-sh/flisk demo`) boots the cloned project and opens its frontend automatically.

## 1.3.193 (2026-10-21)

- New `flisk open` command: opens the first ready frontend in the browser. Works with `--json` output and integrates with the one-command flow.

## 1.3.192 (2026-10-21)

- Fixed the one-command flow (`npx @flisk-sh/flisk demo`): the cloned project now boots in place and the browser opens when the stack is up. The CLI copy was updated from "tdk" to "Flisk" throughout.

## 1.3.191 (2026-10-21)

- One command from scratch: `npx @flisk-sh/flisk demo` (or `restaurant`, `saas`, `erp`, etc.) clones a starter, installs the CLI globally, boots the stack, and opens the frontend.
- CLI rebrand: all user-facing copy changed from "tdk" / "TDK" to "Flisk" / "flisk" (package scope, homepage, repository, command names, error messages, docs).
- Internal: `cli/src/utils/one-command.ts` added to run the stack and detect the frontend URL.

## 1.3.190 (2026-10-21)

- Package metadata corrected: `repository`, `bugs`, and `homepage` in `package.json` now point at `flisk-sh/flisk` and `https://flisk.sh` (were still pointing at the decommissioned `tdk-landscape/tdk-cli-core` and `tdk-landscape.github.io`).

## 1.3.189 (2026-10-21)

- `flisk resource` now reports a malformed `service.json` with the file path and the reason it could not be parsed, instead of a raw JSON error (#1685).
- A malformed or unreadable `.tdk/project.json` now names the file and the reason, instead of failing with a bare parse error (#1681).
- Error output from the CLI goes through one formatter now, so `TdkError`, `runCommand` and the commands that printed their own red text all read the same way (#1620).
- New: a workflow opens an issue for every open dependency advisory, with the advisory detail and the labels a contributor needs to find and claim it (#1783, #1784).

## 1.3.188 (2026-10-20)

- Security: the BYO examples install `certifi` 2026.10.19 now (was 2026.7.22). The older bundle shipped the `emSign ECC Root CA - G3` root, and the eight eMudhra intermediate CAs that chain to it had their private keys compromised and were revoked, so anyone holding one of those keys could mint a certificate for any hostname. Advisory GHSA-6q48-6c7w-9gw2 (#1779).
- Security: `vite` moves to 8.3.3. The `launch-editor` it bundles had three Windows command-injection advisories: CVE-2026-112942, CVE-2026-112943 and CVE-2026-112944. Both advisories are tracked on the [security page](https://github.com/tdk-landscape/tdk-cli-core/security) (#1780).
- `cli/pnpm-lock.yaml` is regenerated. It had drifted from `cli/package.json`, so `pnpm install --frozen-lockfile` failed there; it tracks the manifest again now (#1780).

## 1.3.151 (2026-10-12)

- The Prisma migrator image builds again. It used to `COPY` `migrate.sh` and `prisma-runtime-relink.sh` from `shared-platform-engineering/docker-templates/`, which no package ships, so `flisk up` failed with `…/migrate.sh: not found`. Both are now written inline into the Dockerfile. The relink step is reconstructed and not yet verified against a real migrator build (#1094).
- Generated Dockerfiles start with `# syntax=docker/dockerfile:1`, so the heredocs in them build on CI's Docker builder (#1092).

## 1.3.131 (2026-10-12)

- `healthCheckPath` is optional for `appType: "bring-your-own"` in `service.json`, so a service that is not HTTP (Postgres, Redis, MinIO, an SMTP relay) no longer needs a made-up `"/"` to validate. Without it Flisk sends no HTTP probe to the service and gives its Traefik route no health check; the container counts as healthy once Docker reports it running. `port` stays required, and a set `healthCheckPath` behaves as before. Fixes #1086.
- `flisk up` now publishes Traefik on host port 80 (and 443) when they are free, so routed URLs read `http://app.<project>.localhost/<app>` instead of `...localhost:8080/<app>`. It always wanted 80 but only ever tried 8080-8180. On macOS the free-port check treated the kernel's refusal of a non-root bind below 1024 as "busy", although Docker Desktop publishes those ports itself; that also made `TDK_HTTP_PORT=80` fail with "already in use". A project whose saved plan is on 8080 moves to 80 on its next `flisk up` once 80 is free. On Linux and WSL2 a non-root user cannot check port 80, so the 8080-8180 range is kept there. Printed URLs no longer end in `:80`.
- Flisk MCP tools now accept an absolute `projectPath` so a projectless MCP client can run doctor, inspect services and logs, and manage the intended project without depending on the server launch directory.
- Shared platform stacks (postgres, traefik, proxy, messaging, infisical, monitoring, cdc, elk) now run in Compose projects named `<project>-<stack>` (for example `tdk-erp-system-database-management`) instead of the directory-named `database-management`, `tdk-out` and so on. Two Flisk projects on one Docker daemon no longer share them.

- Two Flisk projects that each have a stack with the same name (for example `people`) no longer share Docker names. Compose projects are now `<project>-<stack>-autogenerated`, containers `<project>-<stack>-autogenerated-<service>-1` and images `<project>_<stack>_<service>:dev` (migrators `<project>_<stack>-db-migrator:dev`). Before, the second project's `flisk up` removed the first project's containers as orphans and overwrote its image. Containers from before this change keep the old names and are not removed by the new engine: stop them once, see [layout.md](layout.md).

## 1.3.130 (2026-10-08)

- Releases now come with a signed checksum list: `checksums.txt.sigstore.json` (keyless Sigstore signature from the release workflow) is attached next to the binaries in [tdk-cli-releases](https://github.com/tdk-landscape/tdk-cli-releases/releases) and to a release with the same tag here. How to verify is in [docs/security.md](security.md#releases). The binaries themselves are not signed individually (#869, #840).
- `flisk resource` for a Python backend now writes `pytest==9.0.3` in the generated `pyproject.toml` (was 8.3.4, affected by GHSA-6w46-j5rx-g56g) (#867).
- Examples: bumped past open Dependabot alerts: puma 7.2.1 (Sinatra), NestJS 11.1.18, drizzle-orm 0.45.2 and pytest 9.0.3 (#867).
- Supply chain: every checked-in Dockerfile base image is pinned to a digest (#865).
- Tests: a property-based fuzz test for the `service.json` line-break guard runs on every pull request (#866).
- Docs: the README shows the OpenSSF Best Practices badge (#868).

## 1.3.129 (2026-10-08)

- Security policy: `SECURITY.md` now states acknowledgement, assessment, fix and disclosure timelines (#842).
- Dependencies: four vulnerable transitive JavaScript dependencies bumped in `bun.lock` and `cli/pnpm-lock.yaml` (shell-quote, smol-toml, source-map-js, ws), and the BYO fiber (v2.52.15) and starlette (1.x) examples moved past known advisories (#843, #844, #845).
- Supply chain: every GitHub Action is pinned to a commit SHA (#864).
- Docs: a guide for testing webhooks locally (#846).

## 1.3.128 (2026-10-08)

- Internal: the skills-sync workflow gets `contents: write` only on the job that pushes, not workflow-wide (#841). No change to the CLI.

## 1.3.127 (2026-10-08)

- Security hardening flagged by Socket (#826). The npm package no longer includes `ext/ide-components/code_executor/server.py`, a browser terminal that ran client-supplied commands through a shell. `flisk` and the Tilt engine never started it. The other IDE components are unchanged. `flisk doctor` now single-quotes the registry URL and container name it passes to `curl` and `docker logs`, so a value such as `$(...)` can no longer run a command.

## 1.3.126 (2026-10-08)

- Security: fixes [GHSA-phgf-pww4-7jxc](https://github.com/tdk-landscape/tdk-cli-core/security/advisories/GHSA-phgf-pww4-7jxc) (all earlier versions). A line break in a `service.json` value was written into the generated Docker Compose file and could add keys such as `privileged: true` to a service when you ran `flisk up` or `tilt up` on a repository you did not write. `flisk` and the Tilt engine now refuse any `service.json` string key or value that contains a line break (including U+0085, U+2028 and U+2029) or another control character, and `healthCheckPath`, `traefik.host`, `traefik.pathPrefix`, `traefik.healthCheck`, `nats.queueGroup`, `databaseName`, `stack` and `image` must also match a pattern. `smoke` is exempt. `flisk up` and `flisk config regenerate` stop with an error that names the field and does not print the value, and `tilt up` stops the same way. Upgrade, and check `service.json` files from repositories you did not write.
- `flisk up`, `flisk status` and `flisk ui` now treat a container as ready only once its Docker health check passes. Tilt reports a running container as ready even while its health check is starting or failing, so a Postgres that never accepted connections counted as up and its dependents looked ready. A health check that is still starting now counts as starting (`waiting for postgres` on dependents), and a failing one makes `flisk up` stop with `✗ postgres failed: container is running, but its health check is failing`, the services it blocks, and how many dependents are not ready. Containers without a health check (BYO images) are unchanged. Part of #683.

## 1.3.125 (2026-10-08)

- `flisk upgrade` no longer falls back to installing from the repository's moving GitHub default branch when the npm or Bun registry install fails. It reports the original install error, exits non-zero and prints the published-package command (`npm install -g @tdk-landscape/tdk-cli-core@latest` or `bun install -g @tdk-landscape/tdk-cli-core@latest`). npm `EACCES`/`EPERM` failures also point at npm's global-prefix docs and the official installer. Fixes #702.
- `flisk networks` now lists routable frontend, backend and MCP services that omit `basePath`, using the same default route the generator uses. `--json`, `--raw` and stack filtering are unchanged, and the advice that `basePath` is required is gone. Fixes #719.
- `flisk down`, `flisk eject` and `flisk logs` report a missing or invalid project root with the shared error and suggestions, before any Docker or Tilt check. `down --json` and `logs --json` return it in one schema-versioned envelope. Fixes #722.
- Registering an SDK resource whose path has no `service.json` now stops before scaffolding with the path and the next step (add a `service.json` with `"appType": "sdk"`, then rerun), instead of a raw `Object.entries` exception. Fixes #714.
- Repairing an empty generated value in an existing `.env` now rewrites the file atomically and keeps its mode; a failed write leaves the old file intact. Other lines and comments are unchanged. Fixes #724.
- The engine's remaining Starlark `DEBUG` lines are now printed only with `TDK_DEBUG=1` (`TILT_DEBUG` still works). Fixes #701.
- Internal: `flisk ui` key bindings come from one typed keymap shared by the help panel, footer and tab bar (#448); the scaffold templates moved to `cli/src/generator/resource-templates.ts` (#699) and doctor's Starlark load checks to `cli/src/utils/doctor-starlark.ts` (#698). No behaviour change.
- Docs: `docs/ui.md` lists every `flisk ui` key binding (#697); new contributor guides for finding bugs (`docs/contributing/finding-bugs.md`) and for reviewing PRs with the AI buttons (`docs/contributing/04-review-a-pr.md`); a new README intro on why Flisk generates the local infrastructure (#738).

## 1.3.124 (2026-10-07)

- A `service.json` with a `schemaVersion` this flisk does not know now stops `flisk up` (dry run included) before anything starts and names the file; a missing `schemaVersion` still only warns. `flisk up` requires Bun only when the project has services that need it, the same rule `flisk doctor` uses (#731).
- Discovered resources now carry their `port` and `type`, so `flisk resources --ports`/`--verbose` and `flisk status --json` show real values, and new services no longer all get port 4000 (#736).
- `.env` files are parsed like Compose does: inline comments after whitespace, BOM and CRLF, matching quotes and the documented escapes; `N= # c` stays empty. Fixes #725 (#737).
- CI: `wsl2-smoke` runs only when started by hand (#716, #717, #730).

## 1.3.123 (2026-10-07)

- Version-only release: `package.json` on `main` was brought back in line with the published version (#734). Same code as 1.3.122.

## 1.3.122 (2026-10-07)

- `flisk stack` can assign named resources in scripts with `--resources` (space- or comma-separated) and skip confirmation with `--yes`. Unknown names list valid resources, and non-TTY assignments without explicit resource names fail with a command hint. Invalid JSON encountered while writing now names the affected `service.json`.
- Security (GHSA-3hj3-f39v-j2x5): the standalone Traefik (80/443) and Postgres ports bind to loopback instead of `0.0.0.0`, so others on the network can no longer reach them, and the Traefik API/dashboard (`--api.insecure`) is off (#720).
- `flisk logs`, `flisk doctor --json` and error messages replace values from the project's `.env` (8 characters or longer) with `[REDACTED]` (#703).
- `flisk up` and `flisk doctor` say when `schemaVersion` is missing or unsupported (#687), and refuse circular `dependsOn` and invalid ports before anything starts (#681).
- `flisk up` names the next step when another process holds a port (#711) and checks Bun against the same minimum version as `flisk doctor` (#688).
- Two backends in one stack no longer share the stack-scoped Traefik routers, so each gets its own route (#732).
- `flisk doctor` no longer reports a port another process listens on as free (#691) and links the Tilt UI URL that is actually running (#712).
- `flisk logs` tells you to run `flisk up` when Tilt is not reachable (#693).
- Tech-stack validation messages are fully formatted (#690).
- `flisk --help` and the cheat sheet list `logs`, `eject`, `import` and `mcp` (#727).
- `flisk ui` gains a Tilt events timeline (#655).
- Engine: the no-op port replacement pass in `compose.star` is removed (#477).
- Tests: the generated Tilt and Compose files are locked with golden copies (#689); the engine tests declare their Python packages (#729).
- Docs: command cheat sheet (#692), `up`/`down`/`status` flags (#660), one product description (#694), quick-start URL fixes (#704, #726), issue-claiming and quick setup with a Starlark recipe (#728).
- CI: the Biome autofix no longer breaks Lint on every new PR (#685).

## 1.3.121 (2026-10-07)

- `flisk status` shows readiness per service and marks a service blocked by a failed dependency (#678); `flisk ui` shows the same readiness and names the failed dependency (#679).
- `flisk up` names the service that failed and what it blocks, and prints `Flisk is up.` only once everything is ready (#669). A Tilt resource that is still building is no longer counted as ready (#677).
- `flisk up` names the host port it wanted, the one it chose and how to force one (#667). A second `flisk up` no longer starts another Tilt on a new port: it prints `Environment is already running` and exits 0, and `--force` replaces the running one (#663).
- Misspelled stack and resource names get a "did you mean" suggestion (#618).
- Generated files are written atomically (#668), and their headers say to run `flisk config regenerate` (#680).
- `flisk ui`: a stack with no known service status shows as unknown, not error (#671).
- Docs: `flisk doctor --no-ping` and `--ping-timeout` (#659), the MCP agent guide (#675), Codex MCP setup (#674, #676), project history notes (#670, #672); OpenSpec for stabilizing local-dev commands (#662). #665 (drift gate spec) was reverted by #666 after it left conflict markers on `main`.

## 1.3.120 (2026-10-07)

- Tests only: coverage for the env-validator, file and command helper utilities (#656, #657, #658). No behaviour change.

## 1.3.119 (2026-10-06)

- Adds a CLI start-up benchmark (#653). No behaviour change.

## 1.3.118 (2026-10-06)

- A resource that `dependsOn` the shared platform Postgres now starts it (#643, #646).
- `flisk resource --feature prisma` on a backend also creates a `<api>-migrator` resource that runs `prisma migrate deploy`, and the API depends on it (#649), and `flisk doctor` fails inconsistent Prisma 7 setups (#647, #648).
- `flisk ui` shows the CLI version and the discovered resources (#638), pages through long lists with the keyboard (#645), and hides the unfinished Events tab (#622).
- Docs: `TILT_TECH_STACK` version scope (#625); OpenSpec for a NestJS bring-your-own example (#636).
- CI: conflict-resolution buttons on PRs, spec badges kept on one line (#651).

## 1.3.117 (2026-10-06)

- CI: repository spell check (#639); AI review buttons also run for fork PRs and render as one line of product badges (#640, #641, #642).
- Docs: OpenSpec for `dependsOn` starting the shared platform Postgres (#644).

## 1.3.116 (2026-10-06)

- `flisk ui` adapts its layout to the terminal size (#635) and the resource table columns are clearer (#637).
- CI: "Write spec" buttons on issue bodies (#632).

## 1.3.115 (2026-10-05)

- CI: Grok, Claude and Codex review buttons are appended to PR bodies (#626, #627, #629, #630).

## 1.3.114 (2026-10-05)

- `flisk status` pointed to a `flisk list-stacks` command that does not exist; it now points to `flisk stacks`. `--json` adds the resource count, each stack's resources and the unassigned ones. Fixes #79 (#621).

## 1.3.113 (2026-10-05)

- Docs: the README demo shows the generated frontend files (#620); generated service files and drift checks are documented (#619).

## 1.3.112 (2026-10-05)

- `flisk eject` no longer claims files it does not create or prints a command that cannot work. It still writes only `EJECTED.md` (no file is copied, moved or generated; the Tiltfile and engine stay in git-ignored `.tdk/.tdk-out/`, and the per-service Compose files, golden-layer Dockerfile and Traefik file only exist after Tilt has run). `EJECTED.md` no longer lists them under "Keep" and says the Tiltfile still reads `.tdk/project.json` and the `service.json` files. `Next: tilt up` (which finds no Tiltfile at the project root) is replaced by `tilt up -f .tdk/.tdk-out/Tiltfile -- --focus=<stack>`, the form `flisk up` runs. A project that already has an `EJECTED.md` keeps its old text (the file is never overwritten) and is now told so. `--dry-run` headings read `Generated files, left where they are (git-ignored):` and `Files written:`. A command that exports plain Compose files and Dockerfiles does not exist. Fixes #610. (#611)

## 1.3.111 (2026-10-05)

- `flisk config regenerate` now restores a root `.tiltignore` that Flisk wrote (it carries the `SYSTEM-GENERATED BY Flisk CLI` header) and that was edited by hand, and prints `Restored: .tiltignore → project root (hand edits discarded)`. Before, it only copied the file when none existed, so `flisk config verify` kept failing with `Out of sync: .tiltignore (run 'flisk config regenerate')` after the advice was followed. A root `.tiltignore` without the header is still never overwritten, and plain `flisk project --yes` still does not overwrite an existing one. Docs: `docs/adopt-flisk.md` now quotes the current `flisk doctor` unknown-field wording. (#615)
- `flisk doctor` now checks the project's own resource configs for duplicates. Two resources with the same `appName` fail (`Duplicate resource names`, naming both `service.json` paths): the name becomes the Compose service and Traefik router, so they collide, and before nothing reported it. Two backend, mcp or routed bring-your-own resources on the same `port` give a warning, not a failure (`Duplicate resource ports`): service ports are not published on the host and each service has its own container, so the pair can run, but it is usually a copied `service.json`. Frontends, workers, libraries and a missing `port` are ignored. Fixes #76. (#609)
- `flisk doctor` no longer fails with `N resources without a package.json` for a bring-your-own resource. A bring-your-own resource (`--image`, `--dockerfile` or `buildContext`) is a plain container: its image is pulled or built from its own Dockerfile, never from the generated Dockerfile that copies a `package.json`, so the check was a false positive that made `flisk doctor` (and CI recipes that gate on it) exit non-zero right after wrapping an existing service. Backend, frontend, worker, migrator, mcp, library and sdk resources without a `package.json` still fail; Python, Go and Rust backends were already exempt. The other doctor checks were run on a project with only bring-your-own resources and report nothing. Fixes #599. (#600)
- A scaffolded frontend now says why `bun run build` / `bun run dev` cannot run on the host before `flisk up`: the `.autogenerated/vite.config.*.autogenerated.ts` files its scripts point at are written by the engine (Tilt) when `flisk up` loads the resource, and neither `flisk resource` nor `flisk config regenerate` creates them. Before, `vite` stopped with an esbuild `Could not resolve` stack trace. New `predev`/`prebuild` scripts print what is missing and how to get it; once the file exists (and inside the engine image build) they pass silently. Existing frontends need the two scripts added by hand. Backend, worker and mcp scaffolds are unchanged. Fixes #592. (#594)
- `flisk up` now honours `minTdkVersion` from `.tdk/project.json`, like `flisk doctor`. On an older CLI (or a malformed value) it exits 1 before the Docker checks and before Tilt starts, with `flisk X is older than the Y this project requires (minTdkVersion)` and `Run: flisk upgrade`; `--dry-run` reports it the same way. New `flisk up --ignore-version` skips the check with a warning. A project without `minTdkVersion` behaves as before. The check lives in `cli/src/utils/tdk-version.ts`, shared with doctor. (#595)
- `init-networks` now fails with Docker's own message when a network that does not exist cannot be created. It ran `docker network create X 2>/dev/null && echo ... || true`, so a failure such as `all predefined address pools have been fully subnetted` was reported as `Docker networks initialized` and Postgres and Traefik then failed with `network ... declared as external, but could not be found`. An already existing network (including one another process creates between the check and the create) is still not an error, and a network with incorrect compose labels is still removed first when unused. Fixes #587. (#589)
- A freshly scaffolded worker now type-checks: its `src/index.ts` typed `Job.payload` as `Record<string, JsonValue>`, but `JsonValue` is a type internal to the CLI that the generated project neither defines nor imports, so `bun run build` failed with `TS2304: Cannot find name 'JsonValue'`. The payload is now `Record<string, unknown>`. Existing workers need the same one-word edit. Fixes #588. (#590)
- A freshly scaffolded backend, worker or mcp service now builds on the host: its `tsconfig.json` sets `"types": ["node"]`, matching the generated Docker tsconfig. Before, `bun run build` failed with `TS2591: Cannot find name 'process'` because TypeScript 7 no longer auto-includes `@types/*`. Frontend scaffolds are unchanged. Existing services need `"types": ["node"]` added by hand. Closes #581. (#586)
- The `Dockerfile` that `flisk resource` writes next to `service.json` now follows the service: `PORT`, `EXPOSE` and the health check use the `port` (and `healthCheckPath`) from `service.json` instead of a fixed 3000, the health probe no longer needs `curl` (not in `oven/bun`), `bun.lock` is optional in the `COPY` (a Flisk workspace keeps it at the project root, so the old file stopped at `"/bun.lock": not found`), and a header comment says `flisk up` does not build this file (it builds `.autogenerated/Dockerfile.app.autogenerated`). A worker, which declares no health path, gets no HEALTHCHECK. Fixes #579. (#580)
- `flisk down` now removes what `flisk up <stack>` started. It ran `tilt down` without `--focus`, so the Tiltfile fell back to its default phase and did not register the stack's own compose project: the generated service container (`shop-autogenerated-orders-api-1`) kept running and only Traefik and Postgres were removed. It now passes every stack to the Tiltfile, and it stops the project's own `tilt up` process first (it kept running, and a live Tilt re-creates removed containers). Only a `tilt up` started with this project's Tiltfile is stopped. New `flisk down --prune-networks` also removes the project's Docker networks (`<project>_backend`, `_database`, `_traefik-public`, ...) that no container is attached to; without the flag they are kept, as before. `flisk doctor`'s "all predefined address pools are in use" fix now names it. (#585)
- `flisk resources --type <type>` filters the list (#616).
- `flisk resource --yes` no longer prompts for a stack: a new project uses `main`, a single existing stack is reused, and several stacks require `--stack` (#591).
- `flisk upgrade` of a binary install left `flisk` non-executable (mode 0644); it now sets 0755, and a failed check prints `chmod +x <path>` (#596).
- Shell completion accepts the shell as a positional argument (#578).
- Docs: troubleshooting page for flisk and Tilt messages (#612), a GitHub Actions recipe for `flisk config verify` and `flisk up` (#608), how to leave Flisk (#607), scope and non-goals for team leads (#577), services spread over several repos (#582), the database is per stack (#584), adoption-docs accuracy sweep (#597).
- CI: "Shipped in vX" comments on fixed issues after each release (#606), issue claiming (#605), contributor thanks and welcome messages (#598, #613), hall-of-fame issue with kyu/dan ranks (#601, #604).

## 1.3.110 (2026-10-05)

- `flisk config verify` no longer fails on a root `.tiltignore` the repository already had. `flisk project` never overwrote it, but verify compared it with the generated one and reported `Out of sync: .tiltignore`; it now warns `not generated by Flisk, left as is`. A `.tiltignore` carrying Flisk's generated header that was edited is still reported. Refs #568. (#574)
- A repo can pin the oldest CLI it works with: add `"minTdkVersion": "1.3.80"` to `.tdk/project.json`, and `flisk doctor` fails with `Run: flisk upgrade` on an older `flisk` (a value that is not `MAJOR.MINOR.PATCH` also fails). It is a floor, not an exact pin. Documented in `docs/upgrading.md`. Refs #564. (#572)
- `flisk ui` search shows the match count and a no-matches message (#562).
- Docs: `SUPPORT.md` for team leads (#575), local Postgres data, reset, seed and snapshot (#573), network calls, secrets and images (#571).

## 1.3.109 (2026-10-05)

- `flisk ui` replaces the fake 100% loading bar with a spinner (#561).
- The local loop can be handed over: drift gate, runbook and adopters list (#548).
- Docs: `tdk-import` 0.1.1 pinned and its release alignment (#558, #559, #560); README install-size badge fixed (#557).

## 1.3.108 (2026-10-05)

- `flisk resources` and `flisk networks` exit non-zero with the stack-not-found error when `--stack` names a stack that does not exist. Fixes #439 (#551).
- Docs: `--version` and `--verbose` flags clarified (#555). Tests for `flisk down` projects and stacks (#554).

## 1.3.107 (2026-10-05)

- `TILT_PORT` is validated before start-up (#550).
- Shell completions cover every registered command (#556).
- `flisk ui`: a new status message cancels the previous message's clear timer, so overlapping messages no longer disappear early. Fixes #454 (#553).

## 1.3.106 (2026-10-04)

- `flisk doctor` warns when a backend or worker applies database migrations from its own start-up (a `start`/`dev` script, a Dockerfile `CMD`/`ENTRYPOINT`, a shell entrypoint or its source: Prisma, Drizzle, Knex, TypeORM, MikroORM, Sequelize, dbmate, Atlas, Alembic). It is a warning, not a failure: such services work, but migrations belong in a `migrator` resource that runs once before the services that depend on it. `migrator` and bring-your-own resources are not checked. (#546)
- New `flisk mcp`: a stdio MCP server that exposes the `--json` commands to agents (#549).
- New `flisk logs`: a bounded log snapshot, with `--json` (#542).
- `flisk stacks --json` and `flisk projects --json` (#541, #544).
- `flisk up --only` (spike), and readiness no longer waits on Tilt resources that are disabled (#545).
- CI: `wsl2-smoke` runs less often on pull requests (#543).

## 1.3.105 (2026-10-04)

- `flisk status --json` reports each service's URL, container port and host port, plus stack ports (#539).
- Flisk detects Dev Container, Codespaces and WebContainer hosts; `flisk up --json` and `flisk down --json` (#534).
- `flisk ui` suggests existing commands in its empty state (#536).
- OpenSpec: agent-host runtime contract (#528).

## 1.3.104 (2026-10-04)

- Bring-your-own services can build from a source tree with `buildContext` (#520, #525).
- Docs: issue labels and a documentation issue form (#530); install-size badge points at the latest version (#526).

## 1.3.103 (2026-10-04)

- `flisk import` delegates to the separate `tdk-import` tool (#511, #520, #521).
- Docs: npm version and size badges (#523).

## 1.3.102 (2026-10-04)

- Focus only enables `<name>-image` prebuilds that are registered (#522).
- Go: deferred-start live-reload services prebuild the development target; Fiber, Echo and chi verified (#369, #519).

## 1.3.101 (2026-10-04)

- Go services can opt in to a live development loop with `"dev": { "liveReload": true }` in `service.json`: edits are copied into the running container and recompiled without an image rebuild, while `go.mod`, `go.sum` and the generated Dockerfile still rebuild the image. The watcher compiles into a staging binary while the old build keeps serving and swaps only on success, so a compile error shows in the Tilt log and the last good build keeps answering (Air, tried first, stopped the app before compiling and left it down for the whole compile; in 2 of 6 edits a Traefik health check then returned 503 for 10 s). Measured on one loaded Mac: median edit-to-ready 1.63 s for the scaffold. The default Go image (`golang:1.23`) now sets `GOTOOLCHAIN=auto`, so a `go.mod` that needs a newer Go, such as Gin 1.12 (`go 1.25`), downloads that toolchain instead of stopping with `requires go >= 1.25`. Offline or air-gapped builds of a go.mod newer than 1.23 still fail, but now at the toolchain download rather than at the version check. `scripts/e2e/go-dev-loop.sh` checks all of this through a real `flisk up`. Refs #369. (#495)
- Docs: adoption guide for team leads (#499), FAQ for agencies (#503), friendlier issue templates (#502), "Who uses Flisk" and `ADOPTERS.md` (#496, #498), governance docs and maintainers check (#488).

## 1.3.100 (2026-10-04)

- `flisk ui`: Esc at the top level shows a quit hint instead of exiting (#482).

## 1.3.99 (2026-10-04)

- First version of the opt-in Go dev loop via `dev.liveReload` (#369, #483); replaced by the build-then-swap watcher in 1.3.101.
- Docs: Japanese and Chinese READMEs (#484).
- CI: `wsl2-smoke` skipped for docs, BYO-example and TUI-only changes (#487); journey-map workflow fixes (#485, #486).

## 1.3.98 (2026-10-03)

- Rebuild of 1.3.97 from the same source commit; no change.

## 1.3.97 (2026-10-03)

- `flisk up` keeps each smoke step's status and response body under `.tdk/smoke/<service>/<step>/` (`latest.json` and `body.txt`, body capped at 64 KiB), plus `last-success.json` and `last-success-body.txt` that a later failure never overwrites, so a regression can be diffed against the last good response. The failure line ends with the record path, and `flisk project` gitignores `.tdk/smoke/`. A new `smoke-e2e` workflow runs `scripts/verify-smoke.sh` and uploads the records. Before its first step a smoke check now waits for the service's health path (`healthCheckPath`, default `/health` for backends) with GETs until it answers something other than a connection error, 404 or 5xx, so a write is no longer the first request to hit a service that is still building; write retry rules are unchanged. (#480)
- Each `service.json` warning is printed once per command (#479).
- Stack names are validated, and name errors show the invalid value (#478).
- `flisk status` checks for a project before printing (#470).
- `flisk resource` rejects an unknown `--type` instead of prompting (#472).
- `flisk help <unknown>` reports an unknown command and exits 1 (#473).
- `flisk ui`: the dead `a` shortcut is gone from the help panel and footer (#475).
- Frontend framework inventory, picker and meta-framework handoff (#467).
- Bring-your-own examples: Tornado, Polka, Sanic, Falcon, Starlette, Hapi (#430, #431, #432, #446, #457, #468).
- Docs: contributor journey map with islands and kyu/dan ranks (#466, #471, #474).

## 1.3.96 (2026-10-03)

- Rebuild of 1.3.95 from the same source commit; no change.

## 1.3.95 (2026-10-03)

- New frontend provider: TanStack Router (#234, #420).
- Bring-your-own examples: Slim (PHP), Actix Web (Rust), Hanami (Ruby) (#422, #424, #426); SvelteKit verified through `flisk up` (#428).
- Tests for `flisk status` output and options (#14, #427).
- Release notes no longer repeat changelog text from earlier releases (#418, #419).

## 1.3.94 (2026-10-03)

- Release workflow starts its version search from the newest published version (#417). No CLI change.

## 1.3.93 (2026-10-02)

- `service.json` JSON Schema for editor completion and validation (#416).
- The `service.yaml` mirror is written deterministically (#415).

## 1.3.92 (2026-10-02)

- New `mcp` resource type for Model Context Protocol servers (#388), treated as an API service by `up`, `networks` and `doctor` (#391), verified with the official MCP SDK client (#406).
- `flisk up` runs a `smoke` block that checks each service's public URL after start-up (#413, #414).
- Env: secrets are injected, the shared JWT default is gone, `AUTH_MODE=None` works and params are quoted (#390). The engine parses `.env` in Starlark instead of shelling out to `cat` (#400) and builds one identity URL and auth config for the env file and Compose (#399).
- Scaffolds write `dependsOn` (not the deprecated `dependencies`) (#409) and `healthCheckPath`, the key the engine reads (#408).
- `flisk doctor` warns that `dependencies` and `envVars` are deprecated instead of calling them unknown (#401).
- Turso (libSQL) runs locally as a Flisk resource (#386).
- Bring-your-own examples: create-hono, Elysia, Micronaut, Sinatra, Echo, chi, Strapi, dbmate job (#363, #365, #367, #379, #381, #384, #403, #404).
- All 8 frontend frameworks are verified through `flisk up` (#412). CI's Test job gets a 10-minute hang guard (#407).

## 1.3.91 (2026-10-02)

- Native backend frameworks: h3 and Koa (#354, #356).
- Bring-your-own examples: Symfony and Gin (#358, #360).
- Verify runs also remove the golden-layer images they build (#352).

## 1.3.90 (2026-10-02)

- Native backends: NestJS (#350) and Rust (#348).
- Bring-your-own example: Docusaurus (#346).

## 1.3.89 (2026-10-02)

- Native backends: Go (#340), Fastify (#317) and Elysia (#315, recovered after it never reached `main`).
- New frontend provider: vanilla TypeScript (Vite SPA) (#319).
- Bring-your-own examples: Flask, Rails, SvelteKit, Django, Angular, Next.js, .NET, Laravel, Spring, Phoenix, Deno Fresh (#320, #322, #324, #326, #328, #330, #332, #334, #336, #338, #342); five migration job examples recovered (#316).

## 1.3.88 (2026-10-02)

- Native backend framework: Express (#298).
- New frontend providers (Vite SPA): Svelte, Preact, Lit, Solid, Qwik (#260, #261, #276, #277, #296).
- Bring-your-own: a restart policy so one-shot jobs are not restarted (#275), and verified examples for full-stack-fastapi-template, loco, React Router, Nuxt, Astro, express-generator, Refine, Analog, Bati, Ember, AdonisJS, Mastra and Better-T-Stack, plus a dbmate job and a verify script (#274, #279–#285, #297, #300–#304, #313).
- The schema accepts open framework and language ids and is published from `main` (#278).
- Docs: reorganised docs folder and bring-your-own guide (#288, #262, #287); Rsbuild and moon recipes (#286, #295).

## 1.3.87 (2026-10-01)

- Add an opt-in Python backend: `flisk resource <name> --type backend --language python` scaffolds a FastAPI service (`pyproject.toml`, `src/main.py`, a pytest smoke test) and Flisk generates its Docker image (`python:3.12-slim`, with `test` and `production` stages). The choice is saved as `language` in `service.json` only when you pass the flag; omitting it keeps the existing Bun + Hono output byte for byte. Unknown ids and `--language` on non-backend types fail before any file is written. A runnable example is in `examples/one-backend-python`, and the provider contract is in `docs/backend-language-providers.md`. Node.js is not included. (#227)
- `flisk doctor` no longer reports "resource without a package.json" for a Python backend, and a Python service missing `pyproject.toml` or `src/main.py` now fails early with the missing file named.
- Live reload now works: Tilt `live_update` sync paths were relative to the project root while Tilt resolves them against `.tdk/.tdk-out`, so they never matched and every source edit rebuilt the image ("Found file(s) not matching any sync"). An edit under `src/` is now copied into the running container without a rebuild, for Bun and Python services. Dependency file changes (`package.json`, `pyproject.toml`) still rebuild the image. (#228, #230)
- The service schema (`https://tdk-landscape.github.io/schema.service.json`) gains the `language` field (`bun`, `python`).
- Fix the routed health URL in the `one-backend` example README.
- CI: WSL2 landscape gate and native Windows refusal (#220, #222, #223, #224).

## 1.3.86 (2026-10-01)

- Cold start: the Sablier plugin loads and the cold health URL is found (#219, #217).

## 1.3.85 (2026-10-01)

- Expanded focus includes deferred images (#210).

## 1.3.84 (2026-10-01)

- Stack focus includes deferred image builds (#209); the cold-start delay type-checks with `tsc` (#208).

## 1.3.83 (2026-10-01)

- Docs: README SVG demo restored and public copy aligned (#205, #206).

## 1.3.82 (2026-10-01)

- Docs: quick-start claims and example E2E ports aligned (#201).

## 1.3.81 (2026-10-01)

- Host port planning is wired into the CLI at run time (#198).
- Windows release assets are smoke-tested before a release is published (#199, #200).
- README: demo, comparison table and benchmark restored (#197).

## 1.3.80 (2026-09-30)

- Add `flisk doctor --json` with schema-versioned readiness, checks, and structured errors; diagnostics remain on stderr.
- Stabilize doctor exits: 0 ready, 1 blocking findings, 2 invalid arguments/internal check failures. Invalid `--ping-timeout` now exits 2 instead of 1 and rejects fractional/unit-suffixed values.
- Add versioned `--json` envelopes to `flisk status`, `flisk resources`, and `flisk networks`; existing `networks --json` array consumers can migrate with `--json-legacy` through CLI 1.4.x. The compatibility flag is scheduled for removal in 1.5.0.
- Add `flisk config verify --json` with drift summaries and unified diffs for missing or stale master outputs; verification remains read-only, and structured command/internal failures use exits 1/2.


## 1.3.77 (2026-09-30)

- `flisk up` no longer leaves `nats` (and any other service in `services/platform/messaging/docker-compose.yml`, e.g. a local mail catcher) disabled in Tilt. The pre-alpha default always goes through a focus-filter path that only re-enabled `init-networks`/`postgres`/`traefik`/`golden-layers-build`, so a resource with the `nats` feature retried its broker connection forever until you ran `tilt enable nats` by hand. Fixes #155.

- `flisk doctor` now catches wiring mistakes that used to surface minutes into `flisk up`: a resource with no `package.json` (the image build stops at "COPY ... not found"), a `params` URL such as `http://auth-emulator:4000` whose port is not the one the target listens on (its `service.json` `port`), a frontend calling a backend through `localhost:<port>` (Flisk publishes no backend ports on localhost; use the Traefik route), the `nats` feature without `services/platform/messaging/docker-compose.yml` (Flisk does not generate it, so no NATS server starts), two Tilt processes running for one project, and Docker having no address pool left for the networks a project needs. Found while building [tdk-ecommerce-example](https://github.com/tdk-landscape/tdk-ecommerce-example) and a queue/auth example.

- `flisk project ecommerce` clones [tdk-ecommerce-example](https://github.com/tdk-landscape/tdk-ecommerce-example), a Vue 3 storefront and Hono catalog API. Before, only restaurant, saas, erp, user-management and example were accepted.

## 1.3.73 (2026-09-28)

- Free-tier projects no longer start the `sablier` and `wake-gateway` containers, and Traefik no longer downloads the Sablier plugin from GitHub on every start. They were always launched (the `sablier` one with a read-write Docker socket) even though the license only gated the per-service labels, so nothing could use them. They are now generated only when a license grants Sablier. Fewer containers, one image build less, and no network fetch at Traefik boot. Spotted in the ERP CI run log.

## 1.3.72 (2026-09-28)

- `flisk doctor` no longer fails with "Verdaccio is not reachable" when the project config enables Verdaccio but no Premium license grants it. Flisk does not start Verdaccio in that case, so the check could never pass; it is now skipped with a note. A registry your own `.npmrc` points at (`:4873`) is still checked. Found by the ERP CI workflow.

## 1.3.71 (2026-09-28)

- `flisk project` in a freshly cloned repo (one that already has `.tdk/project.json`) now creates the missing `.env` with working defaults. Before, it regenerated the configs but left no `.env`, and `flisk doctor` then failed with "set VERDACCIO_URL_DOCKER=<value>". Doctor now says to run `flisk project` when there is no `.env` at all. Found by the ERP CI workflow.

## 1.3.70 (2026-09-28)

- **Fix for 1.3.69:** `flisk doctor` no longer reports "Environment not ready" for the ERP example. The new check for missing `@types/*` packages flagged its 7 frontends, but they build with `vite build`, which never type-checks, so `types: ["node"]` cannot fail their build. It now only flags a service whose `build` script runs `tsc` (following `bun|npm|pnpm|yarn run` hops). Found by the new ERP CI workflow on its first run.

- New CI workflow that boots the public 100-service ERP example on a clean GitHub-hosted runner with the published CLI and waits for every backend to answer `/health` through Traefik, then writes the time to healthy and the resource use to the job summary. Manual (`full` or `one-stack`) and weekly.

## 1.3.69 (2026-09-28)

- `flisk resource --type backend` adds `@types/node` to the new service. The Docker build uses a tsconfig with `"types": ["node"]`, so without it the image failed at `bun run build` with `TS2688: Cannot find type definition file for 'node'`. This was the next blocker on a clean machine, after the base-image race and the default Prisma feature.
- `flisk doctor` now checks **every** entry in the Docker tsconfig's `types` list against the service's dependencies. It only looked at `"bun"`, so a missing `@types/node` passed. It names the service, the entry and the package to add, and handles subpath (`vitest/globals`) and scoped entries.

## 1.3.67 (2026-09-28)

- The clean-machine quickstart run (`flisk project`, `flisk resource`, `flisk up`, wait for `/health`) now starts by itself after every successful release and tests exactly the version just published. It also still runs nightly and on demand.
- **`flisk resource --type backend` now produces a service whose image builds.** It set `featuresEnabled: ["prisma"]` by default but never created `prisma/schema.prisma` or the `prisma` dependency, so the generated Dockerfile failed on `COPY services/<stack>/<name>/prisma` and no scaffolded service could start. Prisma is now opt-in, like in the ERP and restaurant examples that boot, and `docs/FEATURES.md` says what it needs. Found by the clean-machine quickstart run, one step after the base-image race.

## 1.3.66 (2026-09-28)

- **`flisk up` on a machine with no base images no longer leaves every service stuck on a 404.** The generated Tiltfile dropped the golden-layers resource name, so app and migrator resources never waited for `golden-layers-build`. Their image builds started at once, failed with "pull access denied" because the base images did not exist yet, and Tilt never retried. Machines that had built the layers before (any second run) were unaffected, which hid it. Found by the clean-machine quickstart run.
- `flisk doctor` now names a missing golden base image for any project name (`shop-l4-backend`, ...). The hint was hard-coded to the `tdk-project-` prefix, so a real project got the raw BuildKit error.

## 1.3.64 (2026-09-28)

- `traefik.healthCheck` in service.json (the path Traefik's load balancer probes, documented in the schema) is now honored. It was read by discovery but never used, so Traefik always probed `healthCheckPath`. It defaults to `healthCheckPath`, so manifests that only set that generate the same output as before.
- `flisk doctor` checks that every backend defines the health routes it is probed on (`healthCheckPath` for the container, `traefik.healthCheck` for Traefik, both defaulting to `/health`) somewhere in `src/`. A backend without them never turns healthy, so Traefik returns 404, which used to surface only after a slow image build.

## 1.3.62 (2026-09-28)

- `flisk doctor` no longer skips the service health check when Traefik answers with an error. A 404 (no route yet) or 502/503/504 (route found, container not answering) is reported as a failure that names the service and URL, instead of being read as "Traefik never bound :80". It is skipped only when every probe fails to connect.

## 1.3.61 (2026-09-28)

- `flisk doctor` and `flisk up` no longer report free host ports (80, 443, 5432) as "taken" on Linux. The port check bound `0.0.0.0` and `127.0.0.1` at the same time, and on Linux the second bind collided with our own first probe. It now probes them one after the other, which still catches a loopback-only Postgres on macOS. Found by the nightly clean-machine quickstart run.

## 1.3.60 (2026-09-27)

- Backends and workers scaffolded by `flisk resource` get a `start` script, and `@types/bun` is pinned instead of `latest`. Before, `flisk doctor` failed on every new service. Found by the clean-machine quickstart run.

## 1.3.59 (2026-09-27)

- `flisk doctor` no longer fails every fresh project with "Generated Dockerfiles reference missing project runtime assets: prisma-runtime-relink.sh, migrate.sh". Those two scripts were never shipped or used by generated Dockerfiles; doctor now checks the scripts Flisk ships plus whatever generated Dockerfiles actually copy. Found by the new clean-machine quickstart run.

## 1.3.58 (2026-09-27)

- Dropped the `ink-select-input` dependency in favor of a small built-in list in `flisk ui` (same keys: arrows or j/k, 1-9, Enter). Removes 4 packages: ink-select-input, figures, to-rotated and is-unicode-supported.

## 1.3.57 (2026-09-27)

- Binary installs (`tdk-landscape.github.io/install.sh`) ship the Docker helper scripts generated Dockerfiles run. Before, `flisk project` warned "Flisk runtime assets not found" and image builds could fail. The release script now smoke-tests the built binary.

## 1.3.56 (2026-09-27)

- `flisk project` adds `.env`, `.tdk/.tdk-out/`, `.tdk/.project-id` and `node_modules/` to `.gitignore`. `.env` holds a generated database password and was easy to commit by accident.
- `flisk doctor` checks that host ports 80, 443 and 5432 are free and names what holds them (usually a local Postgres). `flisk up` prints the same warning before starting Tilt.
- `flisk project` no longer tells you to edit `.env` first: the defaults work, and the Verdaccio variables are marked as belonging to the paid registry.
## 1.3.55 (2026-09-27)

- Dropped the `ora` dependency (only `flisk upgrade` used it) in favor of a small built-in spinner: 50 installed packages instead of 61, and no more duplicate versions of cli-cursor, restore-cursor, onetime and signal-exit.
- `flisk doctor` outside a project checks only Docker, Compose and Tilt, and reports "This machine is ready for Flisk". Before, running it right after installing (as the installer suggests) failed with "Master configs missing … Environment not ready".

## 1.3.54 (2026-09-27)

- The npm package ships only what the CLI needs at runtime: 294 files and 458 kB, down from 678 files and 888 kB. Repo tooling, tests, source maps, CI config and the openspec docs are no longer included.

## 1.3.53 (2026-09-27)

- The "requires a license key" errors link to the working request form (`tdk-landscape.github.io/tdk-website/#waitlist`); the old link pointed at a page without it.
- New issue template for Premium license requests.

## 1.3.52 (2026-09-27)

- `flisk up` works in a fresh project. The Tiltfile no longer aborts when a stack listed in `project.json` has no directory yet, and stacks created after `flisk project` are added to the `pre_alpha` phase so they actually start.
- Prompts fail with an error and exit 1 when there's no input to read (CI, `< /dev/null`). Before, `flisk resource` printed its summary, exited 0 and created nothing.
- `flisk help`: one-line header with the version, instead of a misaligned ASCII box and doubled icons.
- One installer: `install.sh` in this repo hands off to `https://tdk-landscape.github.io/install.sh`, which verifies release checksums. `flisk upgrade` verifies checksums too.

## 1.3.51 (2026-09-27)

- Cold start on first request (`sablier.deferStart`, paid): an opted-in resource skips the normal bring-up and starts when it first gets a request, through a generated Traefik route and a wake gateway.
- The wake gateway starts already-built images with `docker compose up --no-build` instead of waiting in Tilt's build queue, which could time out with a 504 under load.
- The generated wake route strips the same API path prefix as the real route.

## 1.3.50 (2026-09-27)

- Fixed the npm package: 1.3.49 shipped without the compiled CLI and its runtime dependencies, so `flisk` failed to start after `npm install -g`.
- Requires Node.js 22.12+.
- `flisk up <stack>` starts only that stack instead of every stack.

## 1.3.39 (2026-09-23)

- `flisk doctor` and `flisk up` time out after 10 s when the Docker daemon is unresponsive, instead of hanging.

## 1.3.37 (2026-09-22)

- Fixed the Vite base path for frontends routed under a path prefix.

## 1.3.36 (2026-09-22)

- Service URL helpers, `BASEPATH` routing and health-check targets.

## 1.3.35 (2026-09-22)

- `flisk doctor` checks that each service's `package.json` has the scripts the generated containers run.

## 1.3.34 (2026-09-22)

- Fixed resource filtering in focus mode and the frontend Docker `tsconfig`.

## 1.3.33 (2026-09-22)

- Core infrastructure (Traefik, Postgres) is always on. Fixed `flisk upgrade` self-repair.

## Earlier

Releases before 1.3.33 are listed in the [git history](https://github.com/tdk-landscape/tdk-cli-core/commits/main).
