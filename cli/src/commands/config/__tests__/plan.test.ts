// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { generateMasterConfigs } from "../../../generator/template-engine.js";
import { createTempProject } from "../../../test-support/index.js";
import { MASTER_CONFIG_FILES } from "../../../utils/constants.js";
import { regeneratePlan } from "../plan.js";
import { configProjectJson } from "./helpers.js";

describe("regeneratePlan", () => {
  it("reports every master file as new when nothing is generated yet", () => {
    const root = createTempProject({ projectJson: configProjectJson("plan-new") });

    const plan = regeneratePlan(root);

    expect(plan.map((change) => change.file)).toEqual([...MASTER_CONFIG_FILES]);
    expect(plan.every((change) => change.status === "new" && change.lineDiff === 0)).toBe(true);
  });

  it("reports every file unchanged right after a real generation", async () => {
    const root = createTempProject({ projectJson: configProjectJson("plan-sync") });
    await generateMasterConfigs(root, { discardHandEdits: true, quiet: true });

    const plan = regeneratePlan(root);

    expect(plan.map((change) => change.file)).toEqual([...MASTER_CONFIG_FILES]);
    expect(plan.every((change) => change.status === "unchanged" && change.lineDiff === 0)).toBe(
      true,
    );
  });

  it("reports a hand-edited file as modified with the line count change", async () => {
    const root = createTempProject({ projectJson: configProjectJson("plan-diff") });
    await generateMasterConfigs(root, { discardHandEdits: true, quiet: true });
    fs.appendFileSync(path.join(root, ".flisk", ".flisk-out", "spec.master"), "\n# hand edit\n");

    const plan = regeneratePlan(root);

    const spec = plan.find((change) => change.file === "spec.master");
    expect(plan.map((change) => change.file)).toEqual([...MASTER_CONFIG_FILES]);
    expect(spec).toMatchObject({ status: "modified", lineDiff: -2 });
    expect(plan.filter((change) => change.status !== "unchanged")).toEqual([spec]);
  });
});
