// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import { makeResource } from "../../test-support/index.js";
import type {
  DiscoveredResource,
  DiscoveredStack,
  ServiceRuntimeState,
} from "../../types/index.js";
import {
  groupServicesByStack,
  hasNoOwnProcess,
  healthCountedResources,
  isUnhealthyState,
  NO_STACK_LABEL,
  unhealthyServiceNames,
} from "../status-groups.js";

const typed = (name: string, type: string) =>
  ({ ...makeResource(name, type), type }) as DiscoveredResource;
const makeStack = (name: string, resources: DiscoveredResource[]): DiscoveredStack => ({
  name,
  resources,
  resourceCount: resources.length,
});
const web = typed("web", "frontend");
const api = typed("api", "backend");
const db = typed("db", "database");
const state = (status: ServiceRuntimeState["status"]) => ({ status });

function summary(resources: DiscoveredResource[], states: Record<string, ServiceRuntimeState>) {
  const [group] = groupServicesByStack([makeStack("main", resources)], [], states);
  return `${group?.healthy}/${group?.total}`;
}

describe("isUnhealthyState", () => {
  it("counts error, unhealthy and pending as unhealthy", () => {
    expect(isUnhealthyState(state("error"))).toBe(true);
    expect(isUnhealthyState(state("unhealthy"))).toBe(true);
    expect(isUnhealthyState(state("pending"))).toBe(true);
  });

  it("counts ready, unknown and a missing state as not unhealthy", () => {
    expect(isUnhealthyState(state("ready"))).toBe(false);
    expect(isUnhealthyState(state("unknown"))).toBe(false);
    expect(isUnhealthyState(undefined)).toBe(false);
  });
});

describe("the healthy count", () => {
  it("leaves out a database that has no process of its own", () => {
    expect(
      summary([web, api, db], { web: state("ready"), api: state("ready"), db: state("unknown") }),
    ).toBe("2/2");
  });

  it("leaves it out when there is no state for it at all", () => {
    expect(summary([web, db], { web: state("ready") })).toBe("1/1");
  });

  it("counts a database that runs its own container", () => {
    expect(summary([api, db], { api: state("ready"), db: state("ready") })).toBe("2/2");
    expect(summary([api, db], { api: state("ready"), db: state("error") })).toBe("1/2");
  });

  it("still drops below the total for a service that is not ready", () => {
    expect(
      summary([web, api, db], { web: state("ready"), api: state("error"), db: state("unknown") }),
    ).toBe("1/2");
  });

  it("does not count a service whose re-probes stopped answering as healthy", () => {
    expect(summary([web, api], { web: state("ready"), api: state("unhealthy") })).toBe("1/2");
  });

  it("still counts a service that has not started", () => {
    expect(summary([web, api], { web: state("ready"), api: state("unknown") })).toBe("1/2");
  });
});

describe("hasNoOwnProcess", () => {
  it("is only true for a database nothing reports on", () => {
    expect(hasNoOwnProcess(db, state("unknown"))).toBe(true);
    expect(hasNoOwnProcess(db, undefined)).toBe(true);
    expect(hasNoOwnProcess(db, state("pending"))).toBe(false);
    expect(hasNoOwnProcess(api, state("unknown"))).toBe(false);
  });
});

describe("healthCountedResources", () => {
  it("keeps every service when there are no states", () => {
    expect(healthCountedResources([web], null)).toEqual([web]);
  });
});

describe("groupServicesByStack", () => {
  it("returns one group per stack, each with its own healthy and total counts", () => {
    const groups = groupServicesByStack(
      [makeStack("main", [web, api]), makeStack("data", [db])],
      [],
      { web: state("ready"), api: state("error"), db: state("ready") },
    );
    expect(groups.map((group) => group.name)).toEqual(["main", "data"]);
    expect(groups[0]).toMatchObject({ healthy: 1, total: 2, resources: [web, api] });
    expect(groups[1]).toMatchObject({ healthy: 1, total: 1, resources: [db] });
  });

  it("adds a (no stack) group only when there are unassigned services", () => {
    const withUnassigned = groupServicesByStack([makeStack("main", [web])], [api], {
      web: state("ready"),
      api: state("pending"),
    });
    expect(withUnassigned.map((group) => group.name)).toEqual(["main", NO_STACK_LABEL]);
    expect(withUnassigned[1]).toMatchObject({ healthy: 0, total: 1, resources: [api] });

    const allStacked = groupServicesByStack([makeStack("main", [web, api])], [], {
      web: state("ready"),
    });
    expect(allStacked.map((group) => group.name)).toEqual(["main"]);
  });

  it("reports healthy 0 when there are no states at all", () => {
    const [group] = groupServicesByStack([makeStack("main", [web, api])], [], null);
    expect(group?.healthy).toBe(0);
    expect(group?.total).toBe(2);
  });
});

describe("unhealthyServiceNames", () => {
  it("does not name a database with no process of its own", () => {
    expect(unhealthyServiceNames([web, db], { web: state("ready"), db: state("unknown") })).toEqual(
      [],
    );
  });

  it("keeps discovery order", () => {
    expect(
      unhealthyServiceNames([web, api], { api: state("pending"), web: state("error") }),
    ).toEqual(["web", "api"]);
  });

  it("ignores services that have no reported state", () => {
    expect(unhealthyServiceNames([web, api], { api: state("error") })).toEqual(["api"]);
    expect(unhealthyServiceNames([web, api], null)).toEqual([]);
  });

  it("names a service reported unhealthy by its periodic re-probe", () => {
    expect(
      unhealthyServiceNames([web, api], {
        web: state("ready"),
        api: { status: "unhealthy", reason: "GET /health failed 3 consecutive probes" },
      }),
    ).toEqual(["api"]);
  });
});
