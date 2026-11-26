// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
//
// Fixtures shared by the commands/down unit tests: the project.json body a "test-project" writes, and a
// temp project that carries it.
import { createTempProject } from "../../../test-support/index.js";
export const VALID_PROJECT_CONFIG = {
    version: "1.0.0",
    project: { name: "test-project", version: "1.0.0" },
    phases: Object.fromEntries(["pre_alpha", "alpha", "beta", "out_of_scope"].map((name) => [
        name,
        { name, description: "", enabledStacks: [] },
    ])),
    optional_infra: {
        monitoring: false,
        elk: false,
        debezium: false,
        golden_image: false,
        verdaccio: false,
    },
    discovery: { paths: ["services/**"] },
};
/** A temp project holding `VALID_PROJECT_CONFIG` in `.flisk/project.json`; removed when the test finishes. */
export function makeDownTempProject() {
    return createTempProject({ projectJson: VALID_PROJECT_CONFIG });
}
