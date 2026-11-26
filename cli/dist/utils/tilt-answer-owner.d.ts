import type { DiscoveredResource } from "../types/index.js";
/**
 * The resource names a `tilt get uiresources` answer can carry for `resources` — the only names
 * {@link tiltAnswerIsForeign} can match. A project of only declaration resources (for example a
 * single `appType: "database"` service) has no Tilt-visible name, so its own running Tilt cannot
 * be told from another project's by name; callers must treat an empty set as inconclusive (#5346).
 */
export declare function tiltVisibleResourceNames(resources: readonly Pick<DiscoveredResource, "name" | "config">[]): Set<string>;
/**
 * Whether a Tilt answer (from `tilt get uiresources`) came from another project.
 * A foreign Tilt is detected when it names no resource of this project: a Tilt that is
 * answering but running a different stack.
 * Returns false for inconclusive answers: unparseable, no items, only platform resources.
 */
export declare function tiltAnswerIsForeign(resources: unknown, projectResourceNames: Set<string>): boolean;
