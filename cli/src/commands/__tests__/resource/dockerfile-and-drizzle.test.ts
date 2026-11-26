// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  createPackageJson,
  createResourceProject,
  DRIZZLE_CONFIG_TEMPLATE,
  DRIZZLE_DB_TEMPLATE,
  DRIZZLE_SCHEMA_TEMPLATE,
  describe,
  existsSync,
  expect,
  getBackendIndexTemplate,
  getDockerfileTemplate,
  getDrizzleBackendIndexTemplate,
  it,
  join,
  readFileSync,
  rmSync,
  runResourceCli,
} from "./test-support.js";

describe("dockerfile template", () => {
  it("follows the service port and health path", () => {
    const dockerfile = getDockerfileTemplate(4123, "/health");
    expect(dockerfile).toContain("FROM oven/bun:1.3");
    expect(dockerfile).toContain("WORKDIR /app");
    expect(dockerfile).toContain("EXPOSE 4123");
    expect(dockerfile).toContain("ENV PORT=4123");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("http://localhost:4123/health");
    expect(dockerfile).not.toContain("3000");
    expect(dockerfile).not.toContain("curl");
  });

  it("does not require a per-service bun.lock", () => {
    expect(getDockerfileTemplate(4000)).toContain("COPY package.json bun.lock* ./");
  });

  it("omits the health check when the service declares no health path", () => {
    expect(getDockerfileTemplate(6000)).not.toContain("HEALTHCHECK");
  });

  it("says that flisk up does not use it", () => {
    expect(getDockerfileTemplate(4000)).toMatch(/flisk up. does NOT build this file/);
  });
});

describe("drizzle feature templates", () => {
  it("adds drizzle-orm and pg to dependencies and drizzle-kit to devDependencies", () => {
    const packageJson = createPackageJson(
      "orders-api",
      "backend",
      undefined,
      false,
      undefined,
      true,
    );

    expect(packageJson.dependencies).toMatchObject({
      "drizzle-orm": "^0.44.7",
      pg: "^8.13.0",
      hono: "^4.0.0",
    });
    expect(packageJson.devDependencies).toMatchObject({
      "drizzle-kit": "^0.31.8",
      "@types/pg": "^8.11.0",
    });
  });

  it("leaves the Drizzle dependencies out unless the feature is enabled", () => {
    const packageJson = createPackageJson("orders-api", "backend");

    expect(packageJson.dependencies).not.toHaveProperty("drizzle-orm");
    expect(packageJson.devDependencies).not.toHaveProperty("drizzle-kit");
    expect(packageJson.dependencies).not.toHaveProperty("pg");
  });

  it("reads DATABASE_URL in the Drizzle client and the drizzle-kit config", () => {
    expect(DRIZZLE_DB_TEMPLATE).toContain("process.env.DATABASE_URL");
    expect(DRIZZLE_DB_TEMPLATE).toContain("drizzle(pool)");
    // A Postgres restart must not stop the API: the pool needs an error listener to drop dead idle connections.
    expect(DRIZZLE_DB_TEMPLATE).toContain("pool.on('error'");
    expect(DRIZZLE_CONFIG_TEMPLATE).toContain("process.env.DATABASE_URL");
    expect(DRIZZLE_CONFIG_TEMPLATE).toContain("dialect: 'postgresql'");
    expect(DRIZZLE_SCHEMA_TEMPLATE).toContain("export {}");
  });

  it("adds /health/db only to the Drizzle variant of the Bun backend template", () => {
    const withDrizzle = getDrizzleBackendIndexTemplate("orders-api");

    expect(withDrizzle).toContain("app.get('/health/db'");
    expect(withDrizzle).toContain("import { db } from './db.js';");
    expect(withDrizzle).toContain("db.execute(sql`select 1`)");
    expect(withDrizzle).toContain("'/health/db'");
    expect(withDrizzle).toContain("service: 'orders-api'");

    const plain = getBackendIndexTemplate("orders-api");
    expect(plain).not.toContain("/health/db");
    expect(plain).not.toContain("drizzle");
  });
});

describe("resource command drizzle feature", () => {
  it("writes the Drizzle client, schema, config and /health/db route for a backend", () => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, [
        "api",
        "--type",
        "backend",
        "--yes",
        "--feature",
        "drizzle",
      ]);
      const serviceDir = join(projectRoot, "services", "main", "api");
      const serviceJson = JSON.parse(readFileSync(join(serviceDir, "service.json"), "utf8"));
      const packageJson = JSON.parse(readFileSync(join(serviceDir, "package.json"), "utf8"));

      expect(result.status).toBe(0);
      expect(serviceJson.featuresEnabled).toContain("drizzle");
      expect(serviceJson.dependsOn ?? []).toEqual([]);
      expect(packageJson.dependencies["drizzle-orm"]).toBe("^0.44.7");
      expect(packageJson.devDependencies["drizzle-kit"]).toBe("^0.31.8");
      expect(readFileSync(join(serviceDir, "src", "db.ts"), "utf8")).toContain("DATABASE_URL");
      expect(readFileSync(join(serviceDir, "src", "schema.ts"), "utf8")).toBe(
        DRIZZLE_SCHEMA_TEMPLATE,
      );
      expect(readFileSync(join(serviceDir, "drizzle.config.ts"), "utf8")).toBe(
        DRIZZLE_CONFIG_TEMPLATE,
      );
      expect(readFileSync(join(serviceDir, "src", "index.ts"), "utf8")).toContain(
        "app.get('/health/db'",
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not write Drizzle files or the /health/db route without the feature", () => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, ["api", "--type", "backend", "--yes"]);
      const serviceDir = join(projectRoot, "services", "main", "api");

      expect(result.status).toBe(0);
      expect(existsSync(join(serviceDir, "src", "db.ts"))).toBe(false);
      expect(existsSync(join(serviceDir, "drizzle.config.ts"))).toBe(false);
      expect(readFileSync(join(serviceDir, "src", "index.ts"), "utf8")).not.toContain("/health/db");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects --feature drizzle for non-backend resources before writing anything", () => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, [
        "jobs",
        "--type",
        "worker",
        "--yes",
        "--feature",
        "drizzle",
      ]);
      const output = result.stdout + result.stderr;

      expect(result.status).toBe(1);
      expect(output).toContain("--feature drizzle is only supported for Bun backends");
      expect(existsSync(join(projectRoot, "services", "main", "jobs"))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
