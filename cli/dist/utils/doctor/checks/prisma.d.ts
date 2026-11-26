import type { CheckResult, DiscoveredResource } from "../../../types/index.js";
/** Enforces the Prisma 7 project contract before `flisk up` can run. */
export declare function checkPrismaConsistency(projectRoot?: string, resources?: DiscoveredResource[], options?: Record<string, unknown>): CheckResult;
