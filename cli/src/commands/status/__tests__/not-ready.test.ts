// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest";

import { makeResource } from "../../../test-support/index.js";
import type { DiscoveredResource, ServiceRuntimeState } from "../../../types/index.js";
import { failStrictStatus, strictNotReady } from "../not-ready.js";

const typed = (name: string, type: string) =>
  ({ ...makeResource(name, type), type }) as DiscoveredResource;
const web = typed("web", "frontend");
const api = typed("api", "backend");
const worker = typed("worker", "worker");
const db = typed("db", "database");
const state = (status: ServiceRuntimeState["status"]): ServiceRuntimeState => ({ status });

describe("strictNotReady", () => {
  it("returns [] when the project has no services to wait for", () => {
    expect(strictNotReady([], {})).toEqual([]);
    expect(strictNotReady([], null)).toEqual([]);
  });

  it("returns [] when every service is ready", () => {
    expect(strictNotReady([web, api], { web: state("ready"), api: state("ready") })).toEqual([]);
  });

  it("names the services that are still starting", () => {
    expect(
      strictNotReady([web, api, worker], {
        web: state("ready"),
        api: state("pending"),
        worker: state("pending"),
      }),
    ).toEqual(["api", "worker"]);
  });

  it("names the services that failed, in discovery order", () => {
    expect(
      strictNotReady([worker, web, api], {
        worker: state("ready"),
        web: state("error"),
        api: state("error"),
      }),
    ).toEqual(["web", "api"]);
  });

  it("names pending and failed services together", () => {
    expect(
      strictNotReady([web, api, worker], {
        web: state("ready"),
        api: state("pending"),
        worker: state("error"),
      }),
    ).toEqual(["api", "worker"]);
  });

  it("returns null when nothing of the project is running", () => {
    expect(strictNotReady([web, api], { web: state("unknown"), api: state("unknown") })).toBeNull();
    expect(strictNotReady([web, api], {})).toBeNull();
    expect(strictNotReady([web, api], null)).toBeNull();
  });

  it("does not name a service that simply has not started when another is ready", () => {
    expect(strictNotReady([web, api], { web: state("ready"), api: state("unknown") })).toEqual([]);
  });

  it("leaves out a database that has no process of its own", () => {
    expect(strictNotReady([web, db], { web: state("ready"), db: state("unknown") })).toEqual([]);
  });

  it("has nothing to wait for when only no-process databases exist", () => {
    expect(strictNotReady([db], {})).toEqual([]);
    expect(strictNotReady([db], null)).toEqual([]);
  });

  it("counts a database that runs its own container like any service", () => {
    expect(strictNotReady([db], { db: state("pending") })).toEqual(["db"]);
    expect(strictNotReady([db], { db: state("error") })).toEqual(["db"]);
  });
});

describe("failStrictStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("writes nothing and leaves the exit code alone when everything is ready", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    failStrictStatus([]);
    expect(err).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("exits 1 with a why-line when nothing is running", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    failStrictStatus(null);
    expect(err).toHaveBeenCalledWith(
      "flisk status --strict: nothing is running. Start it with: flisk up",
    );
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 and names one not-ready service", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    failStrictStatus(["api"]);
    expect(err).toHaveBeenCalledWith("flisk status --strict: 1 service not ready: api");
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 and names every not-ready service", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    failStrictStatus(["api", "worker"]);
    expect(err).toHaveBeenCalledWith("flisk status --strict: 2 services not ready: api, worker");
    expect(process.exitCode).toBe(1);
  });
});
