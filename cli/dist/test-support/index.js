// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Helpers shared by CLI tests. This folder is excluded from the build and the npm package.
export { expectBackendScaffold, expectServiceGitignore, } from "./backend-language-scaffold.js";
export { cleanEnv } from "./clean-env.js";
export { runCompletionCommand } from "./completion.js";
export { compareConfigModels, composeConfigAvailable, composeConfigModel, composeConfigParity, MISSING_COMPOSE_MESSAGE, } from "./compose-config.js";
export { captureExit, makeResource } from "./doubles.js";
export { installFakeContainerTools } from "./fake-container-tools.js";
export { freePort } from "./free-port.js";
export { git, singleCommitRepo } from "./git-repo.js";
export { expectGeneratedFile, expectPinnedHash, goldenUpdate, } from "./golden.js";
export { captureJsonCommand } from "./json-command.js";
export { npxArgs } from "./npx-args.js";
export { parseEnvelope } from "./parse-envelope.js";
export { projectConfig, projectJsonPath, readProjectConfig, writeProjectConfig, } from "./project-config.js";
export { fliskBin, runFlisk } from "./run-flisk.js";
export { runCommandInProcess } from "./run-in-process.js";
export { fakeSpawn } from "./spawn-double.js";
export { engineFile, evaluateStarlark, resolveTiltAvailability, tiltAvailable, } from "./starlark.js";
export { createTempDir, createTempProject, projectJsonFixture, validProjectJson, } from "./temp-project.js";
export { ttyStreams } from "./tty-streams.js";
