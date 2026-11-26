import type { CheckResult } from "../../../types/index.js";
/**
 * A bring-your-own service.json that `provides` REDIS_URL, QDRANT_URL or AMQP_URL and has no `framework`: written by
 * `flisk resource --type redis|qdrant|rabbitmq`, which became `--type database|queue --framework ...`. The file keeps working
 * (it is plain bring-your-own), so this is a warning that names the command to recreate it with the web UI port and the
 * `framework` field.
 */
export declare function checkInfraFrameworks(projectRoot?: string): CheckResult;
