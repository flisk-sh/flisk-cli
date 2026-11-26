// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NATIVE_CONTAINER_LABEL } from "./native-container.js";

const execFilePromise = promisify(execFile);

/** The widest formats: everything the purge and the stale-project label scan need, in four calls. */
export const CONTAINER_LIST_ARGS: readonly string[] = [
  "ps",
  "-a",
  "--format",
  '{{.ID}}\t{{.Names}}\t{{.Size}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.Label "sh.flisk.project"}}\t{{.Label "sh.flisk.project.dir"}}',
];
export const VOLUME_LIST_ARGS: readonly string[] = [
  "volume",
  "ls",
  "--format",
  `{{.Name}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.Label "sh.flisk.project"}}\t{{.Label "sh.flisk.project.dir"}}\t{{.Label "${NATIVE_CONTAINER_LABEL}"}}`,
];
export const NETWORK_LIST_ARGS: readonly string[] = [
  "network",
  "ls",
  "--format",
  '{{.Name}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.Label "sh.flisk.project"}}\t{{.Label "sh.flisk.project.dir"}}',
];
export const IMAGE_LIST_ARGS: readonly string[] = [
  "images",
  "--format",
  "{{.Repository}}:{{.Tag}}",
];

/** Raw stdout of the four Docker listings, shared by the purge and stale-project scans. */
export interface DockerListings {
  containers: string;
  volumes: string;
  networks: string;
  images: string;
  /** True when any listing command failed, so an empty listing may mean "could not look", not "nothing there". */
  failed?: boolean;
}

export type DockerListingRun = (args: string[]) => string | Promise<string>;

const defaultRun: DockerListingRun = async (args) => {
  const { stdout } = await execFilePromise("docker", args, {
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout;
};

/** Reads the four independent listings together. A failed listing is treated as an empty one and sets `failed`. */
export async function readDockerListings(
  run: DockerListingRun = defaultRun,
): Promise<DockerListings> {
  let failed = false;
  const read = async (args: readonly string[]): Promise<string> => {
    try {
      return await run([...args]);
    } catch {
      failed = true;
      return "";
    }
  };
  const [containers, volumes, networks, images] = await Promise.all([
    read(CONTAINER_LIST_ARGS),
    read(VOLUME_LIST_ARGS),
    read(NETWORK_LIST_ARGS),
    read(IMAGE_LIST_ARGS),
  ]);
  return { containers, volumes, networks, images, ...(failed ? { failed } : {}) };
}

export function listingLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface ContainerRow {
  id: string;
  names: string;
  size: string;
  composeProject: string;
  composeDir: string;
  fliskProject: string;
  fliskDir: string;
}

/** Parses the wide listing and the older two-column form used by `flisk down --purge`. */
export function parseContainerRows(output: string): ContainerRow[] {
  return listingLines(output).map((line) => {
    const columns = line.split("\t");
    if (columns.length <= 2) {
      return {
        id: "",
        names: columns[0] ?? "",
        size: "",
        composeProject: columns[1] ?? "",
        composeDir: "",
        fliskProject: "",
        fliskDir: "",
      };
    }
    const [
      id = "",
      names = "",
      size = "",
      composeProject = "",
      composeDir = "",
      fliskProject = "",
      fliskDir = "",
    ] = columns;
    return { id, names, size, composeProject, composeDir, fliskProject, fliskDir };
  });
}

export interface VolumeRow {
  name: string;
  composeProject: string;
  composeDir: string;
  fliskProject: string;
  fliskDir: string;
  /** The `sh.flisk.native-root` label Flisk puts on a volume it creates. */
  nativeRoot: string;
}

/**
 * Parses the wide listing (name, Compose project, Compose dir, Flisk project, Flisk dir, native root) and the short
 * form used by `flisk down --purge` (name, Compose project, native root).
 */
export function parseVolumeRows(output: string): VolumeRow[] {
  return listingLines(output).map((line) => {
    const columns = line.split("\t");
    if (columns.length <= 3) {
      return {
        name: columns[0] ?? "",
        composeProject: columns[1] ?? "",
        composeDir: "",
        fliskProject: "",
        fliskDir: "",
        nativeRoot: columns[2] ?? "",
      };
    }
    const [
      name = "",
      composeProject = "",
      composeDir = "",
      fliskProject = "",
      fliskDir = "",
      nativeRoot = "",
    ] = columns;
    return { name, composeProject, composeDir, fliskProject, fliskDir, nativeRoot };
  });
}

export interface NetworkRow {
  name: string;
  composeProject: string;
  composeDir: string;
  fliskProject: string;
  fliskDir: string;
}

/** Parses the wide listing and the older name-only form used by `flisk down --purge`. */
export function parseNetworkRows(output: string): NetworkRow[] {
  return listingLines(output).map((line) => {
    const [name = "", composeProject = "", composeDir = "", fliskProject = "", fliskDir = ""] =
      line.split("\t");
    return { name, composeProject, composeDir, fliskProject, fliskDir };
  });
}

export function parseImageRefs(output: string): string[] {
  return listingLines(output);
}
