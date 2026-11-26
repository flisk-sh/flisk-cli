// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempDir, createTempProject } from "../../test-support/index.js";
import { FliskError } from "../../utils/errors.js";
import {
  type FliskOsHost,
  type FliskOsLocation,
  fliskOsArgs,
  locateFliskOs,
  type OsOptions,
  parsePort,
  resolveOsProject,
} from "../os/surface.js";
import { host } from "./os-fakes.js";

/**
 * The launch surface is a data builder: a project, a port and the switches go in and the `fliskos` argument vector
 * comes out. The table pins the whole mapping, so the launcher in launch.ts can stay a thin spawn over it.
 */
describe("fliskOsArgs: project and options -> argv", () => {
  it.each<[string, Parameters<typeof fliskOsArgs>[0], string[]]>([
    ["nothing given", { project: null }, []],
    ["only a project", { project: "/work/shop" }, ["--project", "/work/shop"]],
    ["an explicit port", { project: null, port: 4300 }, ["--port", "4300"]],
    ["port 0 asks FliskOS for a free one", { project: null, port: 0 }, ["--port", "0"]],
    ["--no-open", { project: null, open: false }, ["--no-open"]],
    ["open left at its default passes nothing", { project: null, open: true }, []],
    ["one scan root", { project: null, scanRoots: ["/work"] }, ["--scan-root", "/work"]],
    [
      "scan roots keep their order",
      { project: null, scanRoots: ["/a", "/b", "/c"] },
      ["--scan-root", "/a", "--scan-root", "/b", "--scan-root", "/c"],
    ],
    [
      "every surface option in its documented order",
      { project: "/p", port: 1, open: false, scanRoots: ["/r1", "/r2"] },
      ["--project", "/p", "--port", "1", "--no-open", "--scan-root", "/r1", "--scan-root", "/r2"],
    ],
  ])("%s", (_name, input, expected) => {
    expect(fliskOsArgs(input)).toEqual(expected);
  });
});

/** The whole surface a launch is built from: the raw options and a folder go in, project and argv come out. */
function surfaceArgs(
  options: Pick<OsOptions, "project" | "port" | "open" | "scanRoot">,
  cwd: string,
): { project: string | null; args: string[] } {
  const project = resolveOsProject(options.project, cwd);
  return {
    project,
    args: fliskOsArgs({
      project,
      port: options.port === undefined ? undefined : parsePort(options.port),
      open: options.open,
      scanRoots: (options.scanRoot ?? []).map((root) => resolve(cwd, root)),
    }),
  };
}

describe("the surface: fixture folders and raw options -> launch data", () => {
  it.each<{
    name: string;
    options: Pick<OsOptions, "project" | "port" | "open" | "scanRoot">;
    inProject: boolean;
    expected: (dir: string) => { project: string | null; args: string[] };
  }>([
    {
      name: "a project around the current folder, no options",
      options: {},
      inProject: true,
      expected: (dir) => ({ project: dir, args: ["--project", dir] }),
    },
    {
      name: "outside a project the surface is empty",
      options: { port: "4300" },
      inProject: false,
      expected: () => ({ project: null, args: ["--port", "4300"] }),
    },
    {
      name: "port, --no-open and scan roots resolve against the working folder",
      options: { port: "0", open: false, scanRoot: ["rel", "/abs"] },
      inProject: false,
      expected: (dir) => ({
        project: null,
        args: [
          "--port",
          "0",
          "--no-open",
          "--scan-root",
          resolve(dir, "rel"),
          "--scan-root",
          "/abs",
        ],
      }),
    },
  ])("$name", ({ options, inProject, expected }) => {
    const dir = inProject ? createTempProject() : createTempDir();
    expect(surfaceArgs(options, dir)).toEqual(expected(dir));
  });

  it("finds the project root from a folder inside it", () => {
    const root = createTempProject();
    const nested = join(root, "services", "web");
    mkdirSync(nested, { recursive: true });
    expect(surfaceArgs({}, nested)).toEqual({
      project: root,
      args: ["--project", root],
    });
  });
});

describe("locateFliskOs: the machine -> where FliskOS is", () => {
  it.each<[string, FliskOsHost, FliskOsLocation | null]>([
    [
      "the fliskos command wins over an installed app",
      host({ findCommand: () => "/usr/local/bin/fliskos", exists: () => true }),
      { via: "command", path: "/usr/local/bin/fliskos" },
    ],
    [
      "the system app bundle",
      host({ exists: (path) => path === "/Applications/FliskOS.app" }),
      { via: "app", path: "/Applications/FliskOS.app" },
    ],
    [
      "the user's app bundle when the system one is absent",
      host({ exists: (path) => path === "/Users/test/Applications/FliskOS.app" }),
      { via: "app", path: "/Users/test/Applications/FliskOS.app" },
    ],
    ["no app lookup off macOS", host({ platform: "linux", exists: () => true }), null],
    ["a machine with neither", host(), null],
  ])("%s", (_name, machine, expected) => {
    expect(locateFliskOs(machine)).toEqual(expected);
  });
});

describe("parsePort", () => {
  it.each([
    ["0", 0],
    ["4300", 4300],
    ["65535", 65535],
  ])("accepts %s", (value, port) => {
    expect(parsePort(value)).toBe(port);
  });

  it.each(["abc", "-1", "65536", "4.5", "", " "])("rejects %j with a hint", (value) => {
    expect(() => parsePort(value)).toThrow(FliskError);
    expect(() => parsePort(value)).toThrow(/--port must be an integer from 0 to 65535/);
  });
});
