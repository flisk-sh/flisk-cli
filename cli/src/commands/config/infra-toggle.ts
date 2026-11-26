// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { hasVerdaccioLicense } from "../../generator/extension-fetch.js";
import { readProjectConfig } from "../../generator/template-engine.js";
import type { JsonCommandResult, ProjectConfig } from "../../types/index.js";
import { assertValid } from "../../utils/command-helpers.js";
import { OPTIONAL_INFRA_SERVICES, PROJECT_JSON } from "../../utils/constants.js";
import { errorFactories, FliskError, requireProjectRoot, runCommand } from "../../utils/errors.js";
import { writeJsonFile } from "../../utils/file-helpers.js";
import { enforceFliskVersionGate } from "../../utils/flisk-version-gate.js";
import { runJsonCommand } from "../../utils/json-command.js";
import { findProjectRoot } from "../../utils/paths.js";
import { validateOptionalInfraService } from "../../utils/validation.js";

/**
 * Type guard for optional infrastructure service keys.
 * Validates that a service name is a valid key of the optional_infra object.
 */
export function isOptionalInfraKey(
  service: string,
  config: ProjectConfig,
): service is keyof ProjectConfig["optional_infra"] {
  return (
    (OPTIONAL_INFRA_SERVICES as readonly string[]).includes(service) &&
    Object.hasOwn(config.optional_infra, service)
  );
}

/**
 * Enables or disables one optional infrastructure service in `.flisk/project.json`.
 * Validations and the Verdaccio license gate run before any write; `--dry-run` only prints the plan.
 */
export async function toggleInfraService(
  service: string,
  enabled: boolean,
  options: { json?: boolean; ignoreVersion?: boolean; dryRun?: boolean } = {},
): Promise<JsonCommandResult> {
  const projectRoot = options.json ? findProjectRoot() : requireProjectRoot();
  if (!projectRoot) throw errorFactories.notInProject();

  enforceFliskVersionGate(projectRoot, {
    ignoreVersion: options.ignoreVersion,
    json: options.json,
  });

  // Validates service is in OPTIONAL_INFRA_SERVICES array
  const validation = validateOptionalInfraService(service);
  if (options.json && !validation.valid) {
    throw new FliskError(validation.error ?? "Invalid infrastructure service", [
      `flisk config ${enabled ? "enable" : "disable"}-infra monitoring`,
    ]);
  }
  assertValid(validation);

  const config = readProjectConfig(projectRoot);

  // Runtime validation: ensure service is a valid key of optional_infra
  if (!isOptionalInfraKey(service, config)) {
    throw new FliskError(
      `Invalid infrastructure service: "${service}". ` +
        `Must be one of: ${Object.keys(config.optional_infra).join(", ")}`,
      [`flisk config enable-infra ${Object.keys(config.optional_infra)[0] ?? "monitoring"}`],
    );
  }

  const wasEnabled = config.optional_infra[service];
  const changes = Boolean(wasEnabled) !== enabled;

  // Verdaccio is a Premium feature - refuse to enable it without a license key that actually grants it,
  // rather than writing a config that generateMasterConfigs will just silently downgrade back to false
  // later. Only a disabled-to-enabled change needs the license (#4432): a repeated run on an already
  // enabled verdaccio is a no-op and must not demand it again.
  if (service === "verdaccio" && enabled && changes) {
    const granted = await hasVerdaccioLicense(projectRoot);
    if (!granted) {
      throw new FliskError(
        "Verdaccio is a Premium feature and requires a license key that grants it. " +
          "Set export FLISK_LICENSE_KEY=<key> (request a Premium license at https://flisk.sh/#waitlist) and try again.",
        [
          "export FLISK_LICENSE_KEY=<key>",
          "Request a Premium license at https://flisk.sh/#waitlist",
        ],
      );
    }
  }

  if (options.dryRun) {
    console.log(
      changes
        ? `Would ${enabled ? "enable" : "disable"} ${service}.`
        : `No change: ${service} is already ${enabled ? "enabled" : "disabled"}.`,
    );
    return {
      data: { dryRun: true, service, enabled, wasEnabled: Boolean(wasEnabled), changed: changes },
    };
  }

  // A repeated run is a no-op: say so and leave project.json byte-identical (#4432). The JSON
  // envelope keeps its existing shape (service, enabled, wasEnabled), with no regenerate hint.
  if (!changes) {
    console.log(
      chalk.gray(`No change: ${service} is already ${enabled ? "enabled" : "disabled"}.`),
    );
    return { data: { service, enabled, wasEnabled: Boolean(wasEnabled) } };
  }

  const projectJsonPath = join(projectRoot, ".flisk", PROJECT_JSON);
  const rawProjectValue: unknown = JSON.parse(readFileSync(projectJsonPath, "utf-8"));

  if (
    typeof rawProjectValue !== "object" ||
    rawProjectValue === null ||
    Array.isArray(rawProjectValue)
  ) {
    throw new FliskError("Invalid project.json: expected an object.", [
      "Fix .flisk/project.json so it holds a JSON object",
    ]);
  }

  const rawProject = rawProjectValue as Record<string, unknown>;
  const rawOptionalInfra = rawProject.optional_infra;

  if (
    typeof rawOptionalInfra !== "object" ||
    rawOptionalInfra === null ||
    Array.isArray(rawOptionalInfra)
  ) {
    throw new FliskError("Invalid project.json: optional_infra must be an object.", [
      "Set optional_infra in .flisk/project.json to an object, or remove it",
    ]);
  }

  (rawOptionalInfra as Record<string, unknown>)[service] = enabled;

  writeJsonFile(projectJsonPath, rawProject);

  const action = enabled ? "Enabled" : "Disabled";
  console.log(chalk.green(`✓ ${action}: ${service}`));
  console.log(chalk.gray("Run `flisk config regenerate` to apply."));
  return { data: { service, enabled, wasEnabled: Boolean(wasEnabled) } };
}

/** `flisk config enable-infra` and `disable-infra`: the same command with the other value. */
export function infraToggleCommand(
  name: "enable-infra" | "disable-infra",
  enabled: boolean,
): Command {
  return new Command(name)
    .description(`${enabled ? "Enable" : "Disable"} optional infrastructure service`)
    .argument("<service>", "Service name (monitoring, elk, debezium, golden_image, verdaccio)")
    .showHelpAfterError(`\nThe service is one of: ${OPTIONAL_INFRA_SERVICES.join(", ")}.`)
    .option("--dry-run", "Show the planned change without writing project.json")
    .option(
      "--ignore-version",
      "Continue even if the CLI does not match the project's version requirements",
      false,
    )
    .option(
      "--json",
      "Print one JSON envelope on stdout with the service and its previous state",
      false,
    )
    .action(
      async (
        service: string,
        options: { json?: boolean; ignoreVersion?: boolean; dryRun?: boolean },
      ) => {
        const action = () => toggleInfraService(service, enabled, options);
        if (options.json) {
          await runJsonCommand("INFRA_TOGGLE_FAILED", `flisk config ${name}`, action);
          return;
        }
        await runCommand(action);
      },
    );
}
