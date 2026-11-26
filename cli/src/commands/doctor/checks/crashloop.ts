// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { checkCrashLoopingContainers } from "../../../utils/doctor-crashloop.js";
import { findProjectRoot } from "../../../utils/paths.js";
import { envSecretValues } from "../../../utils/secret-redaction.js";
import { getProjectName } from "../../../utils/service-urls.js";
import type { DoctorCheckSpec } from "./spec.js";

/** A container restarted thousands of times is invisible in `docker ps` until someone looks. */
export const crashLoopingContainersCheck: DoctorCheckSpec = {
  name: "Crash-looping containers",
  requires: "container-runtime",
  run: () => {
    const root = findProjectRoot() ?? process.cwd();
    let secrets: string[] = [];
    try {
      secrets = envSecretValues(root);
    } catch {
      // Without the secret values, log lines cannot be shown safely.
      return {
        name: "Crash-looping containers",
        didPass: true,
        isSkipped: true,
        message: "Could not read .env - skipped crash-loop check",
      };
    }
    return checkCrashLoopingContainers(getProjectName(), secrets);
  },
};
