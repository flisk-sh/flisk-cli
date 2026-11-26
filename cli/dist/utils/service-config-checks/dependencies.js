import { declaredDependsOn, dependencyEdges } from "../dependency-graph.js";
import { formatCount } from "../formatting.js";
import { findProjectRoot } from "../paths.js";
import { discoverResourcesFromRoot } from "../services.js";
import { filePath } from "./shared.js";
/** Each cycle once, as service names starting from the alphabetically first, ending where it started. */
function findDependencyCycles(resources) {
    const edges = dependencyEdges(resources);
    const cycles = new Map();
    const state = new Map();
    const stack = [];
    const visit = (name) => {
        state.set(name, "visiting");
        stack.push(name);
        for (const dep of edges.get(name) ?? []) {
            if (state.get(dep) === "visiting") {
                const loop = stack.slice(stack.indexOf(dep));
                const start = loop.indexOf([...loop].sort((a, b) => a.localeCompare(b))[0] ?? dep);
                const ordered = [...loop.slice(start), ...loop.slice(0, start)];
                cycles.set(ordered.join(">"), [...ordered, ordered[0] ?? dep]);
            }
            else if (!state.has(dep)) {
                visit(dep);
            }
        }
        stack.pop();
        state.set(name, "done");
    };
    for (const name of [...edges.keys()].sort((a, b) => a.localeCompare(b))) {
        if (!state.has(name))
            visit(name);
    }
    return [...cycles.values()];
}
/** A dependsOn that is not a list of service names cannot be followed, so say so instead of failing later. */
export function checkDependsOnShape(projectRoot = findProjectRoot() ?? process.cwd(), resources = discoverResourcesFromRoot(projectRoot)) {
    const problems = resources.flatMap((resource) => declaredDependsOn(resource.config) === null
        ? [
            `${filePath(projectRoot, resource)} dependsOn ${JSON.stringify(resource.config?.dependsOn)}: expected an array of service names`,
        ]
        : []);
    if (problems.length === 0) {
        return {
            name: "dependsOn",
            didPass: true,
            message: "Every dependsOn is a list of service names",
        };
    }
    return {
        name: "dependsOn",
        didPass: false,
        message: `${formatCount(problems.length, "invalid dependsOn", "invalid dependsOn")}:\n    ${problems.join("\n    ")}`,
        fix: 'Write "dependsOn" as an array of service names, for example ["postgres", "api"]',
    };
}
/** Services that wait on each other can never both start. A dependsOn name that is not a service is left to the unknown-name check. */
export function checkCircularDependencies(projectRoot = findProjectRoot() ?? process.cwd(), resources = discoverResourcesFromRoot(projectRoot)) {
    const byName = new Map(resources.map((r) => [r.name, r]));
    const cycles = findDependencyCycles(resources);
    if (cycles.length === 0) {
        return {
            name: "Circular dependencies",
            didPass: true,
            message: "No service depends on itself through dependsOn",
        };
    }
    const lines = cycles.map((cycle) => {
        const first = byName.get(cycle[0] ?? "");
        const next = cycle[1] ?? "";
        return `${first ? filePath(projectRoot, first) : cycle[0]} dependsOn "${next}": circular dependency ${cycle.join(" -> ")}`;
    });
    return {
        name: "Circular dependencies",
        didPass: false,
        message: `${cycles.length} ${cycles.length === 1 ? "circular dependency" : "circular dependencies"}:\n    ${lines.join("\n    ")}`,
        fix: 'Remove one "dependsOn" entry in each cycle so the services no longer wait on each other, or move what they share into a third service',
    };
}
