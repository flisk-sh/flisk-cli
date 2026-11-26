// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * The `flisk create` review: what gets created, what it needs and what was chosen, shown before
 * anything is written, plus the "Create it?" confirmation the interactive flow asks on a real choice.
 */

import { arrowSelect } from "../../utils/arrow-prompt.js";
import { backendCatalog, frontendCatalog } from "../../utils/create-catalog.js";
import {
  type CreateAnswers,
  type CreateStep,
  describeAnswers,
  describeParts,
  describeRequirements,
  missingPrograms,
} from "../../utils/create-plan.js";
import { findOnPath } from "../../utils/which.js";
import { installHelp } from "./answers.js";

/** What gets created, what it needs, and what was chosen, shown before anything is written. */
export function reviewLines(
  answers: CreateAnswers,
  steps: CreateStep[],
  onPath: (program: string) => boolean = (program) => findOnPath(program) !== null,
): string[] {
  const chosen = describeAnswers(answers)
    .filter((line) => !line.startsWith("name:"))
    .join(" · ");
  const lines = [
    `Creating ${answers.name}: ${describeParts(answers, steps)}`,
    `Needs: ${describeRequirements(answers, onPath)}`,
    `Chosen: ${chosen}`,
  ];
  // The runtime is never a question: an app runs on this computer unless the parts say otherwise,
  // so the Docker route stays reachable as a one-flag switch.
  if (answers.runtime === "local" && !answers.starter) {
    lines.push(
      `Runs on this computer. --runtime docker switches to containers, one gateway and live reload.`,
    );
  }
  const missing = missingPrograms(answers, onPath);
  if (missing.length > 0) {
    lines.push(`To install what is missing:`, ...installHelp(missing));
  }
  return lines;
}

/** Every answer is the default the plain journey gives: no flag, no pick, the stock name. */
function allDefaultsChosen(answers: CreateAnswers): boolean {
  const defaultFrontend = frontendCatalog()[0]?.id;
  const defaultBackend = backendCatalog()[0];
  const defaultBackendFramework = defaultBackend?.frameworks[0]?.id;
  const hasFrontend = !!answers.frontend;
  const hasBackend = !!answers.backend;
  // "Just a website" or "just the API" is a choice, not the default: ask before writing.
  const frontendDefault = hasFrontend && answers.frontend === defaultFrontend;
  const backendDefault =
    hasBackend &&
    answers.backend?.language === defaultBackend?.id &&
    answers.backend?.framework === defaultBackendFramework;
  return (
    answers.runtime === "local" &&
    !answers.starter &&
    frontendDefault &&
    backendDefault &&
    answers.extras.length === 0 &&
    answers.name === "my-app"
  );
}

/**
 * Prints the review before anything is written, in every mode, so a default is never a surprise.
 * An interactive run also asks "Create it?", but only when the user made a non-default choice:
 * pressing Enter through everything already said yes. Returns false when the user cancels.
 */
export async function confirmCreate(
  answers: CreateAnswers,
  steps: CreateStep[],
  interactive: boolean,
): Promise<boolean> {
  const review = reviewLines(answers, steps);
  if (!interactive) {
    for (const line of review) console.log(line);
    return true;
  }
  console.log("");
  for (const line of review) console.log(`  ${line}`);
  console.log("");
  if (allDefaultsChosen(answers)) return true;
  const go = await arrowSelect<"create" | "cancel">({
    message: "Create it?",
    choices: [
      { title: "Yes, create it", value: "create" },
      { title: "No, cancel", value: "cancel" },
    ],
  });
  return go === "create";
}
