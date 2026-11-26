// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTempDir,
  engineFile,
  evaluateStarlark,
  makeResource,
  tiltAvailable,
} from "../../test-support/index.js";
import {
  applyCheckoutHostCollisionSuffix,
  checkoutNameCollides,
  claimCheckoutHost,
} from "../checkout-host.js";
import { recordCheckoutHostClaim } from "../checkout-host-claims.js";
import {
  exportCheckoutEnv,
  isLinkedGitWorktree,
  readCheckoutHostSuffix,
  setCheckoutHostSuffix,
} from "../checkout-id.js";
import {
  BASE_DOMAIN_DEFAULT,
  CHECKOUT_DOMAIN_ENV,
  CHECKOUT_HOST_ENV,
  CHECKOUT_HOST_SUFFIX_ENV,
  exportCheckoutHostEnv,
  getBaseDomain,
  getCheckoutDomain,
} from "../constants.js";
import { resolveServiceUrl, resolveSubdomainBases } from "../service-urls.js";

const PROJECT_NAME = "acme-shop";

function makeCheckouts(): { main: string; worktree: string } {
  const root = createTempDir("flisk-hostnames-");
  const main = join(root, "main-checkout");
  const worktree = join(root, "feature-login");
  for (const dir of [main, worktree]) {
    mkdirSync(join(dir, ".flisk"), { recursive: true });
    writeFileSync(
      join(dir, ".flisk", "project.json"),
      `${JSON.stringify({ project: { name: PROJECT_NAME } })}\n`,
    );
  }
  mkdirSync(join(main, ".git"));
  writeFileSync(join(main, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  // A linked git worktree has a .git *file* starting with gitdir:, not a directory.
  writeFileSync(join(worktree, ".git"), "gitdir: /somewhere/.git/worktrees/feature-login\n");
  return { main, worktree };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isLinkedGitWorktree", () => {
  it("distinguishes a linked worktree from a normal clone", () => {
    const { main, worktree } = makeCheckouts();
    expect(isLinkedGitWorktree(worktree)).toBe(true);
    expect(isLinkedGitWorktree(main)).toBe(false);
    expect(existsSync(join(worktree, ".git"))).toBe(true);
  });

  it("stops at the first .git entry: a normal clone inside a linked worktree is a normal clone", () => {
    const { worktree } = makeCheckouts();
    const nested = join(worktree, "vendor", "clone");
    mkdirSync(join(nested, ".git"), { recursive: true });
    expect(isLinkedGitWorktree(nested)).toBe(false);
    expect(getCheckoutDomain(nested, {})).toBeNull();
    // A folder with no .git of its own still belongs to the enclosing worktree.
    const plain = join(worktree, "packages", "api");
    mkdirSync(plain, { recursive: true });
    expect(isLinkedGitWorktree(plain)).toBe(true);
    expect(getCheckoutDomain(plain, {})).not.toBeNull();
  });
});

describe("exportCheckoutEnv (#4697)", () => {
  it("keeps an incoming FLISK_CHECKOUT_NAME override and defaults to the folder name", () => {
    const { worktree } = makeCheckouts();
    const withOverride: NodeJS.ProcessEnv = { FLISK_CHECKOUT_NAME: "Agent.Worktree 2" };
    expect(exportCheckoutEnv(worktree, withOverride).name).toBe("agent-worktree-2");
    expect(withOverride.FLISK_CHECKOUT_NAME).toBe("agent-worktree-2");
    expect(getCheckoutDomain(worktree, withOverride)).toBe(
      `agent-worktree-2.${BASE_DOMAIN_DEFAULT}`,
    );

    const without: NodeJS.ProcessEnv = {};
    expect(exportCheckoutEnv(worktree, without).name).toBe("feature-login");
  });

  it("does not mistake the name it exported for another checkout for an override", () => {
    const { main, worktree } = makeCheckouts();
    const env: NodeJS.ProcessEnv = {};
    expect(exportCheckoutEnv(main, env).name).toBe("main-checkout");
    expect(exportCheckoutEnv(worktree, env).name).toBe("feature-login");
  });
});

describe("getBaseDomain (#4697)", () => {
  it("keeps the default domain in a main checkout and names a linked worktree", () => {
    const { main, worktree } = makeCheckouts();
    expect(getBaseDomain(main)).toBe(BASE_DOMAIN_DEFAULT);
    expect(getBaseDomain(worktree)).toBe(`feature-login.${BASE_DOMAIN_DEFAULT}`);
  });

  it.each([
    ["FLISK_SERVICE_BASE_URL", "https://override.test:8443/app", "override.test"],
    ["FLISK_PUBLIC_HOST", "public.test", "public.test"],
  ])("%s wins over the worktree checkout host", (name, value, expected) => {
    const { worktree } = makeCheckouts();
    vi.stubEnv(name, value);
    expect(getBaseDomain(worktree)).toBe(expected);
  });

  it("FLISK_SERVICE_BASE_URL wins over FLISK_PUBLIC_HOST", () => {
    const { worktree } = makeCheckouts();
    vi.stubEnv("FLISK_SERVICE_BASE_URL", "http://first.test");
    vi.stubEnv("FLISK_PUBLIC_HOST", "second.test");
    expect(getBaseDomain(worktree)).toBe("first.test");
  });

  it("FLISK_CHECKOUT_HOST=always names a main checkout too", () => {
    const { main } = makeCheckouts();
    vi.stubEnv(CHECKOUT_HOST_ENV, "always");
    expect(getBaseDomain(main)).toBe(`main-checkout.${BASE_DOMAIN_DEFAULT}`);
  });

  it("FLISK_CHECKOUT_NAME and a collision suffix are reflected in the domain", () => {
    const { worktree } = makeCheckouts();
    vi.stubEnv("FLISK_CHECKOUT_NAME", "Agent.Worktree 2");
    vi.stubEnv(CHECKOUT_HOST_SUFFIX_ENV, "-a1b2");
    expect(getCheckoutDomain(worktree)).toBe(`agent-worktree-2-a1b2.${BASE_DOMAIN_DEFAULT}`);
  });
});

describe("checkout-specific URLs and exported routes", () => {
  it("keeps main-checkout URLs byte-identical and names the worktree", () => {
    const { main, worktree } = makeCheckouts();
    expect(resolveSubdomainBases(8080, main)).toEqual({
      appBase: `http://app.${PROJECT_NAME}.localhost:8080`,
      apiBase: `http://api.${PROJECT_NAME}.localhost:8080`,
    });
    expect(resolveSubdomainBases(8080, worktree)).toEqual({
      appBase: `http://app.feature-login.${BASE_DOMAIN_DEFAULT}:8080`,
      apiBase: `http://api.feature-login.${BASE_DOMAIN_DEFAULT}:8080`,
    });
  });

  it("uses the checkout host in resolveServiceUrl for frontends and APIs", () => {
    const { worktree } = makeCheckouts();
    const web = makeResource("storefront", "frontend", { basePath: "/shop" });
    const api = makeResource("orders-api", "backend");
    expect(resolveServiceUrl(web, 8080, undefined, worktree)).toBe(
      `http://app.feature-login.${BASE_DOMAIN_DEFAULT}:8080/shop`,
    );
    expect(resolveServiceUrl(api, 8080, undefined, worktree)).toBe(
      `http://api.feature-login.${BASE_DOMAIN_DEFAULT}:8080/api/orders`,
    );
  });

  it("exports the domain so Starlark builds matching Traefik hosts", () => {
    const { main, worktree } = makeCheckouts();
    const env: NodeJS.ProcessEnv = {};
    expect(exportCheckoutHostEnv(main, env)).toBeNull();
    expect(env[CHECKOUT_DOMAIN_ENV]).toBe("");
    expect(exportCheckoutHostEnv(worktree, env)).toBe(`feature-login.${BASE_DOMAIN_DEFAULT}`);
    expect(env[CHECKOUT_DOMAIN_ENV]).toBe(`feature-login.${BASE_DOMAIN_DEFAULT}`);
  });
});

describe("checkout-name collisions (#4697)", () => {
  it("detects another running checkout with the same name, but not itself", () => {
    const { worktree } = makeCheckouts();
    const otherRoot = join(createTempDir("flisk-other-stack-"), "feature-login");
    mkdirSync(otherRoot, { recursive: true });
    expect(checkoutNameCollides(worktree, [worktree, otherRoot])).toBe(true);
    expect(checkoutNameCollides(worktree, [worktree])).toBe(false);
    expect(
      checkoutNameCollides(worktree, [join(createTempDir("flisk-other-stack-"), "other")]),
    ).toBe(false);
  });

  it("appends the first four checkout-id characters and persists them", () => {
    const { worktree } = makeCheckouts();
    const identity = exportCheckoutEnv(worktree);
    const env: NodeJS.ProcessEnv = { FLISK_CHECKOUT_NAME: "Feature.Login" };
    const otherRoot = join(createTempDir("flisk-other-stack-"), "feature-login");
    mkdirSync(otherRoot, { recursive: true });

    expect(applyCheckoutHostCollisionSuffix(worktree, identity, [otherRoot], env)).toBe(
      `-${identity.id.slice(0, 4)}`,
    );
    expect(env[CHECKOUT_HOST_SUFFIX_ENV]).toBe(`-${identity.id.slice(0, 4)}`);
    expect(readCheckoutHostSuffix(worktree)).toBe(`-${identity.id.slice(0, 4)}`);
    expect(getCheckoutDomain(worktree, env)).toBe(
      `feature-login-${identity.id.slice(0, 4)}.${BASE_DOMAIN_DEFAULT}`,
    );
  });

  it("does not persist the suffix when the caller defers it (attach and refusal paths)", () => {
    const { worktree } = makeCheckouts();
    const identity = exportCheckoutEnv(worktree);
    const env: NodeJS.ProcessEnv = {};
    const otherRoot = join(createTempDir("flisk-other-stack-"), "feature-login");
    mkdirSync(otherRoot, { recursive: true });

    expect(
      applyCheckoutHostCollisionSuffix(worktree, identity, [otherRoot], env, { persist: false }),
    ).toBe(`-${identity.id.slice(0, 4)}`);
    expect(readCheckoutHostSuffix(worktree)).toBeNull();
  });

  it("serializes concurrent starts in different checkouts so the second one sees the first claim", async () => {
    const parent = createTempDir("flisk-claims-");
    const home = join(parent, "home");
    const a = join(parent, "a", "feature-login");
    const b = join(parent, "b", "feature-login");
    for (const dir of [a, b]) {
      mkdirSync(join(dir, ".flisk"), { recursive: true });
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
    }
    const identityA = exportCheckoutEnv(a, {});
    const identityB = exportCheckoutEnv(b, {});
    const envA: NodeJS.ProcessEnv = {};
    const envB: NodeJS.ProcessEnv = {};

    // Neither Tilt is registered yet, so only the claims tell the starts apart.
    const [suffixA, suffixB] = await Promise.all([
      claimCheckoutHost(a, identityA, [], envA, { home }),
      claimCheckoutHost(b, identityB, [], envB, { home }),
    ]);

    expect([suffixA, suffixB].filter((suffix) => suffix !== null)).toHaveLength(1);
    expect(readCheckoutHostSuffix(a)).toBeNull();
    expect(readCheckoutHostSuffix(b)).toBeNull();
  });

  it("ignores the claim of a start that is no longer alive", async () => {
    const parent = createTempDir("flisk-claims-");
    const home = join(parent, "home");
    const a = join(parent, "a", "feature-login");
    const b = join(parent, "b", "feature-login");
    for (const dir of [a, b]) {
      mkdirSync(join(dir, ".flisk"), { recursive: true });
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
    }
    recordCheckoutHostClaim(a, { home, pid: 2_147_483_646 });
    const identityB = exportCheckoutEnv(b, {});
    expect(await claimCheckoutHost(b, identityB, [], {}, { home })).toBeNull();
  });

  it("keeps an explicit suffix and respects a persisted one in later commands", () => {
    const { worktree } = makeCheckouts();
    const identity = exportCheckoutEnv(worktree);
    setCheckoutHostSuffix(worktree, "-a1b2");
    expect(getCheckoutDomain(worktree, {})).toBe(`feature-login-a1b2.${BASE_DOMAIN_DEFAULT}`);

    const explicit: NodeJS.ProcessEnv = { [CHECKOUT_HOST_SUFFIX_ENV]: "-beef" };
    expect(applyCheckoutHostCollisionSuffix(worktree, identity, [], explicit)).toBe("-beef");
    expect(getCheckoutDomain(worktree, explicit)).toBe(`feature-login-beef.${BASE_DOMAIN_DEFAULT}`);
  });
});

describe("generated Traefik host rules (golden)", () => {
  const constants = engineFile("topologies", "platform", "docker", "constants.star");
  const helpers = engineFile(
    "topologies",
    "platform",
    "docker",
    "networking",
    "traefik_helpers.star",
  );

  it("keeps the main-checkout host expression and route rule unchanged", () => {
    const source = readFileSync(constants, "utf-8");
    const ruleSource = readFileSync(helpers, "utf-8");
    expect(source).toContain("return project_name + '.localhost'");
    expect(ruleSource).toContain("host=TRAEFIK_PROJECT_APP_HOST");
    expect(ruleSource).toContain('"(Host(`{host}`) && PathPrefix(`{base_path}`))"');
  });

  it("reads the exported checkout domain before falling back to the project domain", () => {
    const source = readFileSync(constants, "utf-8");
    expect(source).toContain("os.environ.get('FLISK_CHECKOUT_DOMAIN', '')");
    expect(source).toContain("'.flisk-project.localhost'");
    expect(source.indexOf("FLISK_CHECKOUT_DOMAIN")).toBeLessThan(
      source.indexOf("return project_name + '.localhost'"),
    );
  });

  describe.skipIf(!tiltAvailable())("Starlark evaluation", () => {
    function localDomain(projectRoot: string, env: NodeJS.ProcessEnv): string {
      const constantsPath = engineFile("topologies", "platform", "docker", "constants.star");
      const result = evaluateStarlark(constantsPath, {
        args: `load(${JSON.stringify(constantsPath)}, "PlatformDockerConstants")
fail('RESULT' + PlatformDockerConstants.LOCAL_DOMAIN)
`,
        env: {
          FLISK_PROJECT_ROOT: projectRoot,
          FLISK_SERVICE_BASE_URL: "",
          FLISK_PUBLIC_HOST: "",
          FLISK_CHECKOUT_NAME: "",
          FLISK_CHECKOUT_HOST: "",
          FLISK_CHECKOUT_DOMAIN: "",
          ...env,
        },
      });
      const output = `${result.stdout}${result.stderr}`;
      const marker = "Error in fail: RESULT";
      if (!output.includes(marker)) throw new Error(output);
      return output.split(marker, 2)[1]?.trim() ?? "";
    }

    it("uses the project domain in a main checkout and the exported domain in a worktree", () => {
      const { main } = makeCheckouts();
      expect(localDomain(main, {})).toBe(`${PROJECT_NAME}.localhost`);
      expect(
        localDomain(main, { FLISK_CHECKOUT_DOMAIN: "feature-login.flisk-project.localhost" }),
      ).toBe("feature-login.flisk-project.localhost");
    });
  });
});
