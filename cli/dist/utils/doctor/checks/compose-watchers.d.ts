import type { CheckResult } from "../../../types/index.js";
import type { OrphanedEventsWatcher } from "../../compose-events-watchers.js";
/**
 * Doctor's visibility into the watcher leak: Flisk `docker compose ... events --json` streams still alive after
 * their stack went down or their project directory was deleted. Always a warning, never a failure;
 * `flisk doctor --fix` removes them.
 */
export declare function checkComposeEventWatchers(orphans?: OrphanedEventsWatcher[] | null): CheckResult;
