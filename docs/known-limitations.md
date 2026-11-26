# Known limitations

What to expect as an early adopter. Each item links to the page with the details.

## Local development only

Flisk runs services on your own machine, either as local processes or as containers through Docker and
Tilt. It does not deploy to a cluster and does not emit Kubernetes manifests. The one agreed export
scope is `flisk export render`, `flisk export wrangler` and `flisk export compose`, and they write
files only: they never deploy, never create DNS records and never call a cloud API. Cluster releases
stay with your existing Helm, Kustomize, Flux or Argo workflow. See [scope and non-goals](scope.md)
and [Flisk and Helm](with-helm.md).

## Windows runs through WSL2

On native Windows, `flisk demo` and projects whose services each declare a `command` run as local
processes, and `flisk doctor` and `flisk up --dry-run` can inspect a Docker project. Starting a
Docker project with `flisk up` needs Ubuntu on WSL2. The step-by-step setup is in
[Start here on Windows](start-here-on-windows.md); the reference is the
[Windows & WSL2 guide](wsl2.md).

## The first start can take 10+ minutes

`flisk up` needs Flisk's shared base images ("golden layers"). They are pulled the first time and
built locally only when the pull fails, so a first cold start can take 10+ minutes while they
download or build ([#3201](https://github.com/flisk-sh/flisk/issues/3201)). Later starts reuse them;
measured timings are in [docs/claims.md](claims.md) and the [timing notes](benchmarks/quickstart-timing.md).

## A Compose import can drop or approximate features

`flisk import` maps a root `docker-compose.yml` to `service.json` files, and some Compose features
have no Flisk equivalent or are approximated: a bind path from a variable without a default,
`extra_hosts` entries that use a variable, and similar edges. What is kept and what is dropped is
listed in the [flisk-import README](https://github.com/flisk-sh/flisk-import); printing that summary
after each import is tracked in
[#3108](https://github.com/flisk-sh/flisk/issues/3108). Check the plan with
`flisk import --dry-run` first.

## Docker and Tilt are still needed for the full path

A project whose services each declare a `command` runs them as local processes with no Docker. A
database such as Postgres, one gateway URL (`*.localhost`) in front of every service, or the same
container you deploy all need Docker and Tilt installed. `flisk doctor` checks only what your
project actually uses. See [run without Docker](run-without-docker.md).
