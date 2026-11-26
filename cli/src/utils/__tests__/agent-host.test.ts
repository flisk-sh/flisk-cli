// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { hostUpRefusal } from "../../commands/up.js";
import {
  CLOUD_AGENT_DOCKER_FIX,
  CLOUD_AGENT_DOCS,
  cloudAgentHostMessage,
  DEVCONTAINER_DOCKER_FIX,
  detectHost,
  type HostProbeInputs,
  isCloudAgentHost,
  isContainerHost,
  WEBCONTAINER_DOCS,
  WEBCONTAINER_UP_MESSAGE,
} from "../agent-host.js";
import { createDoctorReport } from "../doctor-report.js";

const base: HostProbeInputs = {
  env: {},
  versions: process.versions,
  platform: "linux",
  fileExists: () => false,
};

describe("detectHost", () => {
  it("detects a WebContainer and refuses up", () => {
    const host = detectHost({
      ...base,
      versions: { ...process.versions, webcontainer: "1" } as never,
    });
    expect(host).toEqual({ kind: "webcontainer", canUp: false });
  });
  it("detects Codespaces before the generic Dev Container", () => {
    expect(
      detectHost({ ...base, env: { CODESPACES: "true", REMOTE_CONTAINERS: "true" } }).kind,
    ).toBe("codespaces");
  });
  it("detects a Dev Container via REMOTE_CONTAINERS", () => {
    expect(detectHost({ ...base, env: { REMOTE_CONTAINERS: "true" } }).kind).toBe("devcontainer");
  });
  it("detects a Dev Container via /.dockerenv and DEVCONTAINER env", () => {
    expect(
      detectHost({
        ...base,
        fileExists: (p) => p === "/.dockerenv",
        env: { DEVCONTAINER: "true" },
      }).kind,
    ).toBe("devcontainer");
  });
  it("does not treat a bare /.dockerenv without DEVCONTAINER as a Dev Container", () => {
    expect(detectHost({ ...base, fileExists: (p) => p === "/.dockerenv" }).kind).toBe("local");
  });
  it("ignores DEVCONTAINER env if /.dockerenv does not exist", () => {
    expect(
      detectHost({
        ...base,
        fileExists: () => false,
        env: { DEVCONTAINER: "true" },
      }).kind,
    ).toBe("local");
  });
  it("reports native Windows as unable to up unless explicitly allowed", () => {
    expect(detectHost({ ...base, platform: "win32" })).toEqual({
      kind: "native-windows",
      canUp: false,
    });
    expect(
      detectHost({ ...base, platform: "win32", env: { FLISK_ALLOW_NATIVE_WINDOWS: "1" } }).canUp,
    ).toBe(true);
  });
  it("detects WSL2 and plain local hosts", () => {
    expect(detectHost({ ...base, env: { WSL_DISTRO_NAME: "Ubuntu" } }).kind).toBe("wsl2");
    expect(detectHost(base).kind).toBe("local");
  });
  it("detects Claude Code on the web via CLAUDE_CODE_REMOTE", () => {
    expect(detectHost({ ...base, env: { CLAUDE_CODE_REMOTE: "true" } })).toEqual({
      kind: "claude-code-web",
      canUp: true,
    });
  });
  it("detects the Copilot coding agent only on GitHub Actions", () => {
    // The Copilot CLI sets the same variables locally; GITHUB_ACTIONS is what makes it the cloud agent.
    expect(detectHost({ ...base, env: { COPILOT_AGENT_SESSION_ID: "abc" } }).kind).toBe("local");
    for (const env of [
      { GITHUB_ACTIONS: "true", COPILOT_AGENT_SESSION_ID: "abc" },
      { GITHUB_ACTIONS: "true", COPILOT_AGENT_JOB_ID: "42" },
      { GITHUB_ACTIONS: "true", COPILOT_CLI: "1" },
    ]) {
      expect(detectHost({ ...base, env })).toEqual({ kind: "copilot-agent", canUp: true });
    }
  });
  it("detects Codex cloud via CODEX_ENV_* or the codex-universal image marker", () => {
    expect(detectHost({ ...base, env: { CODEX_ENV_NODE_VERSION: "22" } })).toEqual({
      kind: "codex-cloud",
      canUp: true,
    });
    expect(
      detectHost({
        ...base,
        fileExists: (p) => p === "/opt/codex/setup_universal.sh",
      }).kind,
    ).toBe("codex-cloud");
  });
  it("does not treat a local Codex CLI session as Codex cloud", () => {
    // CODEX_THREAD_ID / CODEX_SANDBOX mark any Codex run, local included: they must not classify the host.
    expect(
      detectHost({ ...base, env: { CODEX_THREAD_ID: "t1", CODEX_SANDBOX: "seatbelt" } }).kind,
    ).toBe("local");
    expect(detectHost({ ...base, env: { CODEX_SANDBOX_NETWORK_DISABLED: "1" } }).kind).toBe(
      "local",
    );
  });
  it("detects cloud agents before Codespaces and Dev Containers", () => {
    expect(
      detectHost({
        ...base,
        env: { CLAUDE_CODE_REMOTE: "true", CODESPACES: "true", REMOTE_CONTAINERS: "true" },
      }).kind,
    ).toBe("claude-code-web");
  });
  it("uses default process inputs when invoked with no arguments", () => {
    const host = detectHost();
    expect([
      "webcontainer",
      "claude-code-web",
      "codex-cloud",
      "copilot-agent",
      "codespaces",
      "devcontainer",
      "wsl2",
      "native-windows",
      "local",
    ]).toContain(host.kind);
    expect(typeof host.canUp).toBe("boolean");
  });
});

describe("isContainerHost", () => {
  it.each([
    ["codespaces", true],
    ["devcontainer", true],
    ["local", false],
    ["native-windows", false],
    ["wsl2", false],
    ["webcontainer", false],
    ["claude-code-web", false],
    ["codex-cloud", false],
    ["copilot-agent", false],
  ] as const)("identifies container host kind %s as %s", (kind, expected) => {
    expect(isContainerHost(kind)).toBe(expected);
  });
});

describe("isCloudAgentHost", () => {
  it.each([
    ["claude-code-web", true],
    ["codex-cloud", true],
    ["copilot-agent", true],
    ["codespaces", false],
    ["devcontainer", false],
    ["local", false],
    ["native-windows", false],
    ["wsl2", false],
    ["webcontainer", false],
  ] as const)("identifies cloud agent host kind %s as %s", (kind, expected) => {
    expect(isCloudAgentHost(kind)).toBe(expected);
  });
});

describe("host constants and messages", () => {
  it("exports consistent remediation and doc paths", () => {
    expect(WEBCONTAINER_DOCS).toBe("docs/agent-hosts.md");
    expect(WEBCONTAINER_UP_MESSAGE).toContain(WEBCONTAINER_DOCS);
    expect(WEBCONTAINER_UP_MESSAGE).toContain("WebContainers cannot run Flisk");
    expect(DEVCONTAINER_DOCKER_FIX).toContain(WEBCONTAINER_DOCS);
    expect(DEVCONTAINER_DOCKER_FIX).toContain("docker-outside-of-docker");
    expect(CLOUD_AGENT_DOCS).toBe(`${WEBCONTAINER_DOCS}#cloud-agents`);
    expect(CLOUD_AGENT_DOCKER_FIX).toContain(CLOUD_AGENT_DOCS);
    expect(CLOUD_AGENT_DOCKER_FIX).toContain("--local");
    for (const kind of ["claude-code-web", "codex-cloud", "copilot-agent"] as const) {
      expect(cloudAgentHostMessage(kind)).toContain(CLOUD_AGENT_DOCS);
    }
  });
});

describe("hostUpRefusal", () => {
  it("refuses a WebContainer without probing Docker", async () => {
    const probe = async () => {
      throw new Error("must not probe");
    };
    expect(await hostUpRefusal({ kind: "webcontainer", canUp: false }, probe)).toMatch(
      /WebContainers/,
    );
  });
  it("gives Dev Container remediation when Docker is unreachable", async () => {
    expect(await hostUpRefusal({ kind: "devcontainer", canUp: true }, async () => false)).toMatch(
      /Dev Container/,
    );
  });
  it("gives cloud-agent remediation when Docker is unreachable", async () => {
    for (const kind of ["claude-code-web", "codex-cloud", "copilot-agent"] as const) {
      expect(await hostUpRefusal({ kind, canUp: true }, async () => false)).toMatch(
        /cloud coding-agent/,
      );
    }
  });
  it("allows reachable Docker and never probes on a local host", async () => {
    expect(await hostUpRefusal({ kind: "devcontainer", canUp: true }, async () => true)).toBeNull();
    expect(await hostUpRefusal({ kind: "local", canUp: true }, async () => false)).toBeNull();
    expect(
      await hostUpRefusal({ kind: "copilot-agent", canUp: true }, async () => true),
    ).toBeNull();
  });
});

describe("doctor report host", () => {
  it("sets canUp false when the container runtime check failed", () => {
    const report = createDoctorReport(
      [{ name: "Container Runtime", didPass: false, message: "down" }],
      false,
      [],
      undefined,
      { kind: "devcontainer", canUp: true },
    );
    expect(report.data.host).toEqual({
      kind: "devcontainer",
      canUp: false,
      containerRuntimeReachable: false,
    });
  });
});
