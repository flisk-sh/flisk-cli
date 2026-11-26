export type HostKind = "webcontainer" | "claude-code-web" | "codex-cloud" | "copilot-agent" | "codespaces" | "devcontainer" | "wsl2" | "native-windows" | "local";
export interface HostProbeInputs {
    env: NodeJS.ProcessEnv;
    versions: NodeJS.ProcessVersions;
    platform: NodeJS.Platform;
    fileExists: (path: string) => boolean;
}
export interface HostInfo {
    kind: HostKind;
    /** False when `flisk up` cannot work on this host regardless of Docker state. */
    canUp: boolean;
}
export declare const WEBCONTAINER_DOCS = "docs/agent-hosts.md";
export declare const WEBCONTAINER_UP_MESSAGE = "WebContainers cannot run Flisk: there is no Docker daemon or Tilt. Run `flisk up` on a machine with Docker. See docs/agent-hosts.md.";
export declare const DEVCONTAINER_DOCKER_FIX = "Docker is not reachable from this Dev Container. Mount the host Docker socket (-v /var/run/docker.sock:/var/run/docker.sock) or add the docker-outside-of-docker feature to devcontainer.json, then retry. Docker-in-docker is not supported. See docs/agent-hosts.md.";
export declare const CLOUD_AGENT_DOCS = "docs/agent-hosts.md#cloud-agents";
/** The name a `flisk doctor` Host check prints for each cloud-agent kind. */
export declare const CLOUD_AGENT_HOST_LABELS: Partial<Record<HostKind, string>>;
export declare const CLOUD_AGENT_DOCKER_FIX = "A cloud coding-agent sandbox usually has no Docker daemon, so a container stack cannot run here. Scaffold services as local processes instead (`flisk resource <name> --local`, or `--type agent --local` for an agent) and `flisk up` runs them without Docker. See docs/agent-hosts.md#cloud-agents.";
/** One line of `flisk doctor` guidance for a detected cloud-agent host. */
export declare function cloudAgentHostMessage(kind: HostKind): string;
/** Classify where the CLI is running. Informational: Docker reachability is still decided by the runtime checks. */
export declare function detectHost(inputs?: HostProbeInputs): HostInfo;
export declare function isContainerHost(kind: HostKind): boolean;
/** A hosted coding-agent sandbox (Claude Code web, Codex cloud, Copilot coding agent). */
export declare function isCloudAgentHost(kind: HostKind): boolean;
