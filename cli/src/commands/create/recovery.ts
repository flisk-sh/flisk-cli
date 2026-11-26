// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * `flisk create` reporting: reads back what the generators wrote and turns it into the
 * human-facing text — the next steps on success and the recovery message on failure.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getBackendLanguage } from "../../backend-languages/registry.js";
import {
  CREATE_STACK,
  type CreateAnswers,
  type CreateStep,
  LOCAL_BACKEND_DIR,
  LOCAL_FRONTEND_DIR,
  starterInfo,
} from "../../utils/create-plan.js";
import { JS_PACKAGE_MANAGERS } from "../../utils/which.js";

/** A service `flisk resource --local` wrote: where it lives, how to install it, and how it starts. */
export interface GeneratedService {
  dir: string;
  /** The install command, or the generator's own hint for a language without a package.json. */
  install?: string;
  run: string;
  port?: number;
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** The install command without the "# optional: Docker builds the image" note: on your computer the install is needed. */
export function localInstallHint(hint: string): string {
  return hint.split("#")[0]?.trim() ?? hint;
}

/** The last lines of a failed command's output, in the order the tool printed them. */
export function commandFailureTail(output: string, maxLines = 10): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  return lines.slice(-maxLines).join("\n");
}

/** Advice that fits what the tool actually said, instead of promising a retry can fix it. */
export function installFailureSuggestions(
  label: string,
  output: string,
  projectName: string,
  serviceDir: string,
): string[] {
  if (/requires a different python|requires-python/i.test(output)) {
    return [
      `This project needs the Python version in ${serviceDir}/pyproject.toml (Python 3.12+ for this template).`,
      "Install Python 3.12 or newer and use its pip, for example: python3.12 -m pip install -e '.[dev]'",
      `Run it yourself: cd ${projectName}/${serviceDir} && ${label}`,
    ];
  }
  return [
    "The project is created, but the install failed for the reason shown above.",
    `Check the tool output above (network, compiler, registry or version), then retry: cd ${projectName}/${serviceDir} && ${label}`,
  ];
}

/** The local services a project actually contains, read from the files the generators wrote. */
export function generatedServices(projectDir: string, answers: CreateAnswers): GeneratedService[] {
  const found: GeneratedService[] = [];
  for (const dir of [LOCAL_FRONTEND_DIR, LOCAL_BACKEND_DIR]) {
    const service = readJson(join(projectDir, dir, "service.json"));
    if (!service) continue;
    const pkg = readJson(join(projectDir, dir, "package.json"));
    const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
    const language = dir === LOCAL_BACKEND_DIR ? answers.backend?.language : undefined;
    const command = String(service.command ?? "");
    // The manager written into service.json installs the service too; a service.json without a
    // `command` predates package-manager choice and still implies npm (#3609).
    const manager = JS_PACKAGE_MANAGERS.find((candidate) => command.startsWith(`${candidate} `));
    found.push({
      dir,
      install: pkg
        ? `${manager ?? "npm"} install`
        : language
          ? localInstallHint(getBackendLanguage(language).installHint)
          : undefined,
      run: command || (scripts.dev ? "npm run dev" : ""),
      ...(typeof service.port === "number" ? { port: service.port } : {}),
    });
  }
  return found;
}

/** The first port a starter's services declare, so the next steps can say where to look. */
export function firstPort(projectDir: string): number | undefined {
  let entries: string[] = [];
  try {
    entries = readdirSync(projectDir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch {
    return undefined;
  }
  for (const dir of entries) {
    const port = readJson(join(projectDir, dir, "service.json"))?.port;
    if (typeof port === "number") return port;
  }
  // Starters that group services as services/<group>/<name> (the Launch page one).
  const groups = subdirs(join(projectDir, "services"));
  for (const group of groups) {
    for (const dir of subdirs(join(projectDir, "services", group))) {
      const port = readJson(join(projectDir, "services", group, dir, "service.json"))?.port;
      if (typeof port === "number") return port;
    }
  }
  return undefined;
}

/** Sorted names of the folders directly inside `dir`; empty when it cannot be read. */
function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch {
    return [];
  }
}

/** Where to look once it runs: the website's page, or the API's health check when there is no website. */
export function whereToOpen(services: GeneratedService[]): string | undefined {
  const web = services.find((service) => service.dir === LOCAL_FRONTEND_DIR && service.port);
  if (web) return `Then open http://localhost:${web.port} in your browser.`;
  const api = services.find((service) => service.dir === LOCAL_BACKEND_DIR && service.port);
  if (api) return `Then check it works: http://localhost:${api.port}/health`;
  return undefined;
}

/** The commands to run next, from what was generated. */
export function nextSteps(
  projectDir: string,
  answers: CreateAnswers,
  services: GeneratedService[] = generatedServices(projectDir, answers),
): string[] {
  if (answers.starter) {
    const port = firstPort(projectDir);
    const docker = !starterInfo(answers.starter).local;
    return [
      `cd ${answers.name}`,
      docker
        ? "flisk up        # starts it (Docker must be running)"
        : "flisk up        # starts it",
      ...(port ? [`Then open http://localhost:${port} in your browser.`] : []),
      ...(docker ? ["Its README says what else it needs."] : []),
    ];
  }
  if (answers.runtime === "docker") return [`cd ${answers.name}`, `flisk up ${CREATE_STACK}`];
  // Always flisk up: it starts each part with the port written in its service.json. Running a part's own dev
  // command by hand would fall back to the part's built-in default port, which may not be the one chosen here.
  const open = whereToOpen(services);
  return [
    `cd ${answers.name}`,
    ...services.flatMap((service) =>
      service.install ? [`(cd ${service.dir} && ${service.install})`] : [],
    ),
    services.length === 1 ? "flisk up        # starts it" : "flisk up        # starts both",
    ...(open ? [open] : []),
  ];
}

/** What to tell someone when a step fails halfway: what finished, what did not run, how to start over. */
export function recoveryMessage(
  projectDir: string,
  steps: CreateStep[],
  failedIndex: number,
  createdFolder = true,
): string[] {
  const failed = steps[failedIndex];
  return [
    `The project in ${projectDir} is incomplete${failed ? `: "${failed.label}" did not finish` : ""}.`,
    ...steps.slice(0, failedIndex).map((step) => `  done: ${step.label}`),
    ...steps.slice(failedIndex + 1).map((step) => `  not run: ${step.label}`),
    `Project folder (absolute path): ${JSON.stringify(projectDir)}`,
    createdFolder
      ? "flisk create made this folder just now. Look inside it, delete it yourself if you no longer need it, then run flisk create again."
      : "This folder was already there (empty) before flisk create. Look inside it and remove only what create added, then run flisk create again.",
  ];
}
