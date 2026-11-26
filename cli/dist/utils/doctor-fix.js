// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// The `flisk doctor --fix` pipeline, split by job: `plan.ts` decides what to fix from injected findings (no Docker
// needed), `deps.ts` builds the Docker/exec surface the plan and the appliers run against, and `apply.ts` runs the
// plan. This file only re-exports the public surface so existing `doctor-fix.js` imports keep working.
// Plan application
export { applyDoctorFixes, hasFailedActions } from "./doctor-fix/apply.js";
// Docker/exec surface the plan and the appliers use
export { anyTiltAnswers, checkDuplicateFliskInstalls, createDockerFixDeps, dockerFixDeps, findFliskInstalls, parseElapsed, projectTiltPids, runColima, } from "./doctor-fix/deps.js";
// Fix plan: findings in, planned actions out
export { planDoctorFixes } from "./doctor-fix/plan.js";
