// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";

export type HostKind =
  | "webcontainer"
  | "claude-code-web"
  | "codex-cloud"
  | "copilot-agent"
  | "codespaces"
  | "devcontainer"
  | "wsl2"
  | "native-windows"
  | "local";

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

export const WEBCONTAINER_DOCS = "docs/agent-hosts.md";

export const WEBCONTAINER_UP_MESSAGE = `WebContainers cannot run Flisk: there is no Docker daemon or Tilt. Run \`flisk up\` on a machine with Docker. See ${WEBCONTAINER_DOCS}.`;

export const DEVCONTAINER_DOCKER_FIX = `Docker is not reachable from this Dev Container. Mount the host Docker socket (-v /var/run/docker.sock:/var/run/docker.sock) or add the docker-outside-of-docker feature to devcontainer.json, then retry. Docker-in-docker is not supported. See ${WEBCONTAINER_DOCS}.`;

export const CLOUD_AGENT_DOCS = `${WEBCONTAINER_DOCS}#cloud-agents`;

/** The name a `flisk doctor` Host check prints for each cloud-agent kind. */
export const CLOUD_AGENT_HOST_LABELS: Partial<Record<HostKind, string>> = {
  "claude-code-web": "Claude Code on the web",
  "codex-cloud": "Codex cloud",
  "copilot-agent": "GitHub Copilot coding agent",
};

export const CLOUD_AGENT_DOCKER_FIX = `A cloud coding-agent sandbox usually has no Docker daemon, so a container stack cannot run here. Scaffold services as local processes instead (\`flisk resource <name> --local\`, or \`--type agent --local\` for an agent) and \`flisk up\` runs them without Docker. See ${CLOUD_AGENT_DOCS}.`;

/** One line of `flisk doctor` guidance for a detected cloud-agent host. */
export function cloudAgentHostMessage(kind: HostKind): string {
  return `${CLOUD_AGENT_HOST_LABELS[kind] ?? kind} detected: this sandbox usually has no Docker daemon, so run services as local processes (\`command\` in service.json). A container stack needs Docker. See ${CLOUD_AGENT_DOCS}.`;
}

function defaultInputs(): HostProbeInputs {
  return {
    env: process.env,
    versions: process.versions,
    platform: process.platform,
    fileExists: existsSync,
  };
}

/** Classify where the CLI is running. Informational: Docker reachability is still decided by the runtime checks. */
export function detectHost(inputs: HostProbeInputs = defaultInputs()): HostInfo {
  const { env, versions, platform, fileExists } = inputs;
  if ((versions as Record<string, string | undefined>).webcontainer) {
    return { kind: "webcontainer", canUp: false };
  }
  // Cloud coding agents: a sandboxed VM that usually has no Docker daemon, where a local-process project
  // is the way to run Flisk. canUp stays true: `flisk up` works for services that declare `command`, and
  // the container-runtime check decides for a Docker project. Each signal is specific to the hosted
  // agent: a local Claude Code, Codex CLI or Copilot CLI session is still a "local" host.
  if (env.CLAUDE_CODE_REMOTE === "true") return { kind: "claude-code-web", canUp: true };
  if (
    env.GITHUB_ACTIONS === "true" &&
    (env.COPILOT_AGENT_SESSION_ID !== undefined ||
      env.COPILOT_AGENT_JOB_ID !== undefined ||
      env.COPILOT_CLI === "1")
  ) {
    return { kind: "copilot-agent", canUp: true };
  }
  // Codex cloud publishes no dedicated marker: CODEX_ENV_* is set for the whole session when the
  // environment pins runtime versions, and /opt/codex/setup_universal.sh ships inside the
  // codex-universal image every cloud environment builds on.
  if (
    Object.keys(env).some((key) => key.startsWith("CODEX_ENV_")) ||
    fileExists("/opt/codex/setup_universal.sh")
  ) {
    return { kind: "codex-cloud", canUp: true };
  }
  if (env.CODESPACES === "true") return { kind: "codespaces", canUp: true };
  if (env.REMOTE_CONTAINERS || (fileExists("/.dockerenv") && env.DEVCONTAINER)) {
    return { kind: "devcontainer", canUp: true };
  }
  // Mirrors nativeWindowsUpRefusal in commands/up.ts: native Windows cannot start a container stack unless explicitly overridden.
  if (platform === "win32") {
    return { kind: "native-windows", canUp: env.FLISK_ALLOW_NATIVE_WINDOWS === "1" };
  }
  if (platform === "linux" && env.WSL_DISTRO_NAME) return { kind: "wsl2", canUp: true };
  return { kind: "local", canUp: true };
}

export function isContainerHost(kind: HostKind): boolean {
  return kind === "devcontainer" || kind === "codespaces";
}

/** A hosted coding-agent sandbox (Claude Code web, Codex cloud, Copilot coding agent). */
export function isCloudAgentHost(kind: HostKind): boolean {
  return kind === "claude-code-web" || kind === "codex-cloud" || kind === "copilot-agent";
}
