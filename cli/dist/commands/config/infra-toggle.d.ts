import { Command } from "commander";
import type { JsonCommandResult, ProjectConfig } from "../../types/index.js";
/**
 * Type guard for optional infrastructure service keys.
 * Validates that a service name is a valid key of the optional_infra object.
 */
export declare function isOptionalInfraKey(service: string, config: ProjectConfig): service is keyof ProjectConfig["optional_infra"];
/**
 * Enables or disables one optional infrastructure service in `.flisk/project.json`.
 * Validations and the Verdaccio license gate run before any write; `--dry-run` only prints the plan.
 */
export declare function toggleInfraService(service: string, enabled: boolean, options?: {
    json?: boolean;
    ignoreVersion?: boolean;
    dryRun?: boolean;
}): Promise<JsonCommandResult>;
/** `flisk config enable-infra` and `disable-infra`: the same command with the other value. */
export declare function infraToggleCommand(name: "enable-infra" | "disable-infra", enabled: boolean): Command;
