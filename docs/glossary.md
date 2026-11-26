# Glossary

The words Flisk uses for its local development model, in alphabetical order. For beginner-friendly explanations of everyday terms such as terminal, container and port, see [Words you'll see](start/words.md).

## App type (`appType`)

The kind of resource declared in a `service.json` manifest; it chooses the generators and validation rules that apply, such as `backend` for an HTTP API, `frontend` for a Vite app, or `database` for the shared Postgres. The CLI's `flisk resource --type` flag writes this field when it scaffolds a resource.

Example: `"appType": "backend"` in a service manifest.

Where it matters: [configuration and editor schemas](configuration.md#apptype) and the [service schema](../runtime/engine/schemas/service-schema.json).

## Discovery

The Starlark subsystem that scans the `discovery.paths` from `.flisk/project.json` for `service.json` manifests, normalizes them and resolves `dependsOn` into the resource graph the engine consumes. It runs inside Tilt when Tilt loads the generated `Tiltfile`; it does not start containers or change your files.

Example: `"discovery": { "paths": ["services/*/*"] }` finds `services/<stack>/<resource>/service.json`.

Where it matters: [architecture](ARCHITECTURE.md#1-the-three-subsystems), [project configuration](configuration.md) and the [discovery source](../runtime/discovery/AGENTS.md).

## Enabled stacks (`enabledStacks`)

The list of stack names inside each phase of `.flisk/project.json`; a stack appears in that phase's list when the phase should turn it on. When `flisk up` finds a stack in a manifest that no phase lists yet, it adds the stack to `pre_alpha` automatically.

Example: `"pre_alpha": { "enabledStacks": ["shop"] }` makes `flisk up` start the `shop` stack by default.

Where it matters: [auto-enabling discovered stacks](how-flisk-up-works.md#enablediscoveredstacks) and [`.flisk/project.json`](configuration.md#fliskprojectjson).

## Engine

The Starlark framework under `runtime/engine/` that runs inside Tilt when it loads the generated `Tiltfile`. It applies the phase filter from `spec.master`, then registers image builds, live updates, health checks and Traefik routes for each enabled resource.

Example: `should_enable()` in the engine reads `spec.master` before the Tiltfile registers a resource.

Where it matters: [architecture](ARCHITECTURE.md#1-the-three-subsystems) and the [engine source](../runtime/engine/README.md).

## Golden layers

The shared base Docker images (L1–L4, eight targets) built or pulled once per machine from `.flisk/.flisk-out/golden-layers.Dockerfile`; generated service Dockerfiles start `FROM` them instead of rebuilding the same toolchain for every service. A first `flisk up` may spend extra time building or pulling them, while later runs reuse them.

Example: a generated Dockerfile begins with `FROM <project>-l1:latest` and later `FROM <project>-l4-backend:latest`.

Where it matters: [troubleshoot Docker layers](troubleshoot-docker-layers.md) and [golden image sizes](golden-image-sizes.md).

## Health route

The HTTP path a service serves so Docker, Traefik and `flisk up` can tell that it is ready; `healthCheckPath` in `service.json` sets it (default `/health` for backends and MCP servers). `flisk doctor` also checks that the service's source defines the route it is probed on, because a missing route leaves a container unhealthy and Traefik returns 404.

Example: `"healthCheckPath": "/health"` matches a backend that answers `GET /health` with 200.

Where it matters: [readiness in the configuration guide](configuration.md#readiness-listening-is-not-ready), the [`service.json` reference](service-json.md#dependencies-routes-and-health-checks) and [troubleshooting](troubleshooting.md#backends-without-a-health-route).

## Landscape

The older, looser word for the whole local environment Flisk boots: its stacks, shared infrastructure and containers. The main docs say "project" or "stack" instead, but the name survives in the native-Windows refusal, `Landscape startup needs Ubuntu on WSL2.`, and in the README that quotes it.

Example: starting "a large landscape" means running `flisk up` for a project with many resources.

Where it matters: [README support section](../README.md#requirements-and-support) and [the refusal message source](../cli/src/utils/native-windows.ts).

## Master configs

The generated project-level files in `.flisk/.flisk-out/` that Tilt loads: `Tiltfile`, `TILT_RESOURCE_DEFAULTS.star` (ports, naming and default health settings), `TILT_TECH_STACK.star` (technology labels, not version pins) and `spec.master` (active phases and enabled stacks). Flisk renders them from [CLI templates](../cli/templates) and `.flisk/project.json`, so hand edits are reported as drift and fixed by `flisk config regenerate`.

Example: `flisk project --check` reports whether the master configs exist and are in sync.

Where it matters: [architecture](ARCHITECTURE.md#step-1-flisk-project-project-initialization), [tech stack ownership](tech-stack-lock.md) and the [`spec.master` template](../cli/templates/spec.master.hbs).

## Phase

One of the four release stages in `.flisk/project.json` — `pre_alpha`, `alpha`, `beta` or `out_of_scope` — that groups stacks for progressive rollout. All four are required: `pre_alpha` is enabled by default, `out_of_scope` is excluded from normal startup, and the others are enabled when promoted or targeted.

Example: `"beta": { "name": "Beta", "description": "Extended features", "enabledStacks": [] }`.

Where it matters: [the four release phases](how-flisk-up-works.md#the-four-release-phases) and [project configuration](configuration.md#fliskprojectjson).

## Project

The app and its local Flisk configuration, rooted at the folder that contains `.flisk/project.json`; that file holds the project name, phases, discovery paths and optional infrastructure. `flisk up`, `flisk down` and `flisk doctor` act on this project, while `flisk project` creates or checks its configuration.

Example: `flisk project --yes` creates `.flisk/project.json` in the current folder.

Where it matters: [configuration and editor schemas](configuration.md) and the [project overview](project-overview.md).

## Resource (service)

One part of an app — an API, website, worker, database and so on — described by a committed `service.json` manifest with an `appName`, `appType`, `port` and `dependsOn`. The CLI and engine say "resource" (`flisk resource`, `flisk resources`), while beginner docs often call the same thing a "service"; Flisk writes its generated files under that resource's `.autogenerated/` folder.

Example: `flisk resource orders-api --type backend --stack shop --yes` writes `services/shop/orders-api/service.json`.

Where it matters: [the `service.json` reference](service-json.md) and [generated service files](generated-files.md).

## Stack

A named group of related resources: each `service.json` declares its `stack`, and `flisk up <stack>` starts that group with its dependencies. Stacks are assigned to phases through `enabledStacks`; a resource that runs as a local process with a `command` may omit the field.

Example: `"stack": "shop"` in two manifests, then `flisk up shop`.

Where it matters: [configuration and editor schemas](configuration.md#stack) and the [stack lifecycle](how-flisk-up-works.md#2-auto-enabling-discovered-stacks--release-phases).

## Tiltfile

The generated Starlark entry point that Tilt loads from `.flisk/.flisk-out/Tiltfile`; it imports the vendored discovery and engine code and turns your manifests into Tilt resources. `flisk up` launches `tilt up -f .flisk/.flisk-out/Tiltfile`, and `flisk config verify` catches hand edits to that generated file.

Example: `tilt up -f .flisk/.flisk-out/Tiltfile` is the Tilt command behind `flisk up`.

Where it matters: [how `flisk up` works](how-flisk-up-works.md#1-project-root-discovery--runtime-asset-refresh), the [Tiltfile template](../cli/templates/Tiltfile.hbs) and [generated files](generated-files.md).

## Traefik routes

The labels Flisk generates on each HTTP service so the local Traefik gateway exposes it at a `*.localhost` URL, with a path such as `/api/<name>` for backends or `/<name>` for frontends. `flisk up` prints these URLs and `flisk networks` lists them; a project whose services all declare a `command` uses plain localhost addresses instead.

Example: `http://api.my-shop.localhost/api/orders/health` for a backend named `orders-api` in project `my-shop`.

Where it matters: [routed URLs](how-flisk-up-works.md#4-routed-urls--endpoint-resolution), [port wiring in the configuration guide](configuration.md#port) and the [`networks` command](../cli/src/commands/networks.ts).
