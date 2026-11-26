import type { CheckResult, DiscoveredResource } from "../../types/index.js";
/**
 * A bring-your-own `container.gpus` reserves NVIDIA devices in the generated Compose file. `config verify` accepts it anywhere, so
 * on a host whose Docker has no NVIDIA runtime (a laptop, Docker Desktop on a Mac) the failure comes from Docker when the container
 * is created, after the build. Warn up front instead. A Docker that cannot be asked is not a finding (the Docker checks report it),
 * and a host using CDI may not list the runtime, so this is a warning, never a gate.
 */
export declare function checkGpuRuntime(projectRoot?: string, resources?: DiscoveredResource[], runtimes?: () => string[] | null): CheckResult;
/** What Docker can tell about Model Runner: no `docker model` plugin, the plugin without a running backend, or a running backend. */
export type ModelRunnerState = "no-plugin" | "backend-not-running" | "running";
/** The Model Runner state, or null when Docker itself cannot be asked. `docker model status` exits 0 only with a running backend. */
export declare function dockerModelRunnerState(): ModelRunnerState | null;
/**
 * A bring-your-own `models` list becomes Compose `models:`, which Docker serves through Docker Model Runner. Without the
 * `docker model` plugin (Docker Engine on a Linux host or CI runner has none unless `docker-model-plugin` is installed) Compose
 * refuses to start the service with "'models' support requires Docker Model plugin", minutes into `flisk up`; with the plugin
 * but no running backend the model cannot be served. Warn up front instead, saying which of the two it is. A Docker that cannot
 * be asked is not a finding (the Docker checks report it), so this is a warning, never a gate.
 */
export declare function checkModelRunner(projectRoot?: string, resources?: DiscoveredResource[], runnerState?: () => ModelRunnerState | null): CheckResult;
/** Prints the Docker Model Runner warning at `flisk up`; the stack still starts, as the services without models can run. */
export declare function warnModelRunner(projectRoot: string, resources?: DiscoveredResource[]): void;
