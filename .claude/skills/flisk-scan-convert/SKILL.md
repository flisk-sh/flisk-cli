---
name: flisk-scan-convert
description: Scan GitHub (a search, an org, or one repo) for projects that Flisk would help, rank them, and convert the best ones locally with measured before/after evidence and a user handoff. Works for any kind of repo (web stacks, microservices, ML/MLOps, agent stacks). Use when asked to "find repos to migrate to Flisk", "scan for MLOps repos", "find a repo where our PR gets merged", or "convert this repo and show it is faster".
license: MIT
compatibility: Requires gh (authenticated), jq, and the flisk CLI. Docker and Tilt for the container paths.
metadata:
  author: flisk-sh
  version: "2.0"
---

# Scan, rank and convert

Find repos where Flisk would help local development, then convert one locally. The scanner's 500-star cap is a discovery filter, not permission to contact a repository. Conversion itself follows flisk-convert; this skill adds the read-only search, ranking and local evidence.

## 0. Whose repo is it?

- Your own repo, or one the user owns: go on and follow flisk-convert; this third-party restriction does not change the normal owner-repository workflow.
- Someone else's repo: conversion is local-only, regardless of star count. Never open a pull request, issue, discussion or comment on it, even if the user approves the repo or text. Do not create a fork or push a branch to a fork or upstream. Hand the local conversion and evidence to the user; the user opens any upstream PR themselves. This rule also applies when the repo was supplied directly rather than found by the scanner.

## 1. Scan

The script is `.claude/skills/flisk-scan-convert/scripts/scan-repos.sh`; run it from the repository root (written `scripts/scan-repos.sh` below). It needs `gh` (logged in) and `jq`, and it only reads.

Two ways in, and run both:
- `scripts/scan-repos.sh "<repo search>" [limit]`, for example `"docker-compose postgres redis in:readme"` or `"pgvector docker-compose in:readme"`. Avoid bare `OR` across terms: GitHub applies it to the whole query, so you get 15k results.
- `scripts/scan-repos.sh "issues:<terms>" [limit]` starts from repos with **fresh `good first issue`/`help wanted` issues** (last 30 days), which means maintainers who invite outside help. This mode finds far more merge-ready repos than keyword search, where most hits are solo repos.

Tested queries for each type of repo are in the sub-issues of epic flisk-sh/flisk#3164 (#3165 to #3176). Only repos pushed in the last 14 days with 10 to 500 stars come back. flisk-sh repos are skipped.

Each JSON line has:
- activity: `merged60`, `authors60` (distinct human authors), `outsiderMerged60`, `outsiderAuthors60` (distinct non-member authors with a merged PR), `outsiderClosedUnmerged`, and `medHoursOutsider`;
- setup pain: `setupPainIssues`, the open issues from the last 120 days about setup, install, Docker or local dev;
- fit: `compose`, `dockerfiles`, `procfile`, `hasFlisk`;
- policy: `contributing` (the file path) and `policy` (`ai-policy`, `cla`, from CONTRIBUTING or CLA files);
- `discussions`, `license`, `farm`, `farmLabels`, and a `score`.

## 2. Filter and rank

The score adds points for distinct outside contributors (the strongest signal), active authors, setup-pain issues, things to orchestrate, outsiders merged in under 72 h, and Discussions. It takes points off for an AI-contribution policy, a CLA, solo repos and existing Flisk.

`score: -99` with `farm: true` marks a **contribution or bounty farm**: Hacktoberfest/GSSoC/bounty/wave labels, a repo name like "open-source-contribution", or more outside authors than stars. Those repos merge anything, so a merge says nothing. Never target them.

Shortlist scores of **10 or more**, then check by hand. Keep a repo only if all of these hold:
- **500 stars or fewer. This is a discovery filter, checked first, and no good merge record overrides it. It never grants permission for upstream contact.** A maintainer blocked us after a PR to a large org (2026-11-02). The script drops bigger repos. Re-check with `gh repo view OWNER/REPO --json stargazerCount` for any repo you were pointed at by hand.
- at least 2 distinct outsiders merged in 60 days, by real people (open their profiles), not one prolific contributor;
- 2 or more things started together, and local setup is genuinely painful (more than about 4 commands, or open setup issues);
- their CONTRIBUTING and AI policy allow it, and there is no CLA a bot or lawyer must clear;
- small enough for one focused local conversion.

Rank by distinct outsiders, then setup pain, then fewer stars.

## 3. Convert one

Clone the repository into a fresh local directory (never into the Flisk checkout), make a local branch, and follow flisk-convert. For a third-party repo, keep the conversion local and hand it to the user. Do not create a fork or push a branch to a fork or upstream for that conversion. Keep the existing compose file and README flow; Flisk only adds `service.json` files and docs.

## 4. Measure before and after

Same machine, same commands, three runs each, report the median and say what was measured:
- cold start: from clean checkout (no images, no volumes) to every URL answering;
- warm restart: down, then up;
- edit to reload: change one source line, time until the running service shows it.
Save the raw output with the evidence; keep the proof local for third-party repos. For owner repos, follow flisk-convert's normal evidence workflow. If a number cannot be measured, say so; never estimate.

## 5. Prove it works, like tubehaus#42

Timing alone is not enough. Follow flisk-convert step 5; the reference is the self-review on [biolend83/tubehaus#42](https://github.com/biolend83/tubehaus/pull/42#issuecomment-6556357152) (merged). In short:
- a real `flisk up` on the released Flisk the docs name, with a fresh project name or volumes (an old test's data can fake a result), run from under `$HOME` on Colima;
- 5-10 screenshots: the app doing a real action, `flisk up` output, Tilt all green, the changed service's logs, the config traced `.env` → `service.json` → generated Compose → `docker inspect`, and an outside reachability check (loopback vs the LAN address);
- the raw text of each log under its screenshot, private values masked;
- a local self-review: what was checked, fixed after review, behaviour changes, Flisk-side issues (linked), and what was not verified;
- Flisk as an option next to their Compose file, the same Docker volume names, and disclosure (Flisk maintainer, AI assistant).
Every gap found on the way is a Flisk bug: fix it in Flisk, then re-run. For a third-party conversion, the user handles any upstream PR, issue, discussion or comment. Do not publish the evidence or contact maintainers yourself.

## Guardrails

The trust rules and the "What maintainers told us" table in epic flisk-sh/flisk#3164 are read-only context, not authorization for third-party contact. In short:
- **Scanning is read-only.** For third-party repos, conversion and evidence stay local even after user confirmation. Do not publish the evidence or contact maintainers yourself. Hand the work to the user; they decide whether to contact upstream.
- **Disclose** that you work on Flisk and that AI helped. Lychee declined partly because heavy AI use and a young, churning project "raise eye-brows". Pin a Flisk release that has been out for at least 7 days.
- **Never add anything that points at our domains or services** (workflows, uploads, badges, telemetry). charset_normalizer called that "an attempt for something terrible", and Parcels blocked us.
- **No default passwords or keys** in our files, their `.env` wins, and add a CI check (the haben#188 lessons).
- Never send outreach, follow-ups or acknowledgements to third-party maintainers. Keep any supplied feedback in the local handoff; the user handles replies and publication.
- Do not claim speedups without the measured evidence above.
