// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  BASE_TEMPLATE,
  createServiceJson,
  describe,
  dirname,
  expect,
  FRONTEND_FRAMEWORKS,
  fileURLToPath,
  it,
  join,
  readFileSync,
  TYPE_SPECIFIC,
} from "./test-support.js";

describe("service.json template", () => {
  it("should create valid backend service.json using createServiceJson", () => {
    const name = "test-backend";
    const type = "backend";
    const stack = "main";
    const port = 3001;

    const serviceJson = createServiceJson(name, type, stack, port);

    expect(serviceJson).toHaveProperty("name", name);
    expect(serviceJson).toHaveProperty("type", type);
    expect(serviceJson).toHaveProperty("port", port);
    expect(serviceJson).toHaveProperty("stack", stack);
    expect(serviceJson).toHaveProperty("healthCheckPath", "/health");
    expect(serviceJson).not.toHaveProperty("framework");
    expect(serviceJson).toHaveProperty("dependsOn");
    expect(serviceJson).toHaveProperty("build");
    expect(serviceJson).toHaveProperty("dev");
    expect(serviceJson.$schema).toBe("https://flisk.sh/schema.service.json");
  });

  it("adds the Prisma feature to the service manifest when requested", () => {
    const serviceJson = createServiceJson("orders-api", "backend", "main", 3001, ["prisma"]);
    expect(serviceJson.featuresEnabled).toContain("prisma");
    expect(serviceJson.dependsOn).toEqual([]);
  });

  it("adds the Drizzle feature to the service manifest when requested", () => {
    const serviceJson = createServiceJson("orders-api", "backend", "main", 3001, ["drizzle"]);
    expect(serviceJson.featuresEnabled).toContain("drizzle");
    expect(serviceJson.featuresEnabled).not.toContain("prisma");
  });

  it("should create valid frontend service.json using createServiceJson", () => {
    const name = "test-frontend";
    const type = "frontend";
    const stack = "main";
    const port = 3002;

    const serviceJson = createServiceJson(name, type, stack, port);

    expect(serviceJson).toHaveProperty("name", name);
    expect(serviceJson).toHaveProperty("type", type);
    expect(serviceJson).toHaveProperty("port", port);
    expect(serviceJson.dev.watch).toContain("public/**/*");
    expect(serviceJson).toHaveProperty("framework", "react");

    const explicitlySelected = createServiceJson(name, type, stack, port, [], "react");
    expect(explicitlySelected).toHaveProperty("framework", "react");
  });

  it("should create valid worker service.json using createServiceJson", () => {
    const name = "test-worker";
    const type = "worker";
    const stack = "main";
    const port = 0;

    const serviceJson = createServiceJson(name, type, stack, port);

    expect(serviceJson).toHaveProperty("name", name);
    expect(serviceJson).toHaveProperty("type", type);
    expect(serviceJson.port).toBe(0); // Workers may not need ports
    expect(serviceJson.dev.command).toBe("bun run dev");
  });

  it("creates agent service.json with durability and custom runtime", () => {
    const serviceJson = createServiceJson(
      "research-agent",
      "agent",
      "ai",
      4200,
      [],
      undefined,
      undefined,
      { runtime: "custom", durability: "postgres" },
    );
    expect(serviceJson.appName).toBe("research-agent");
    expect(serviceJson.appType).toBe("agent");
    expect(serviceJson.agent).toEqual({ runtime: "custom", durability: "postgres" });
    expect(serviceJson.healthCheckPath).toBe("/health");
    expect(serviceJson.port).toBe(4200);
  });

  it("creates mcp service.json without backend framework pollution", () => {
    const serviceJson = createServiceJson("tools-server", "mcp", "ai", 4300);
    expect(serviceJson.appName).toBe("tools-server");
    expect(serviceJson.appType).toBe("mcp");
    expect(serviceJson).not.toHaveProperty("framework");
    expect(serviceJson.healthCheckPath).toBe("/health");
  });

  it("omits Prisma feature when non-Bun backend language is selected", () => {
    const serviceJson = createServiceJson(
      "py-api",
      "backend",
      "main",
      4100,
      [],
      undefined,
      "python",
    );
    expect(serviceJson.language).toBe("python");
    expect(serviceJson.featuresEnabled).not.toContain("prisma");
  });

  it("should have correct TYPE_SPECIFIC extensions for each resource type", () => {
    expect(TYPE_SPECIFIC.backend).toHaveProperty("healthCheckPath", "/health");
    expect(TYPE_SPECIFIC.frontend.dev?.watch).toContain("public/**/*");
    expect(TYPE_SPECIFIC.worker.dev?.command).toBe("bun run dev");
  });

  it("should have correct BASE_TEMPLATE structure", () => {
    expect(BASE_TEMPLATE).toHaveProperty("port", 0);
    expect(BASE_TEMPLATE).toHaveProperty("dependsOn");
    expect(BASE_TEMPLATE).toHaveProperty("build");
    expect(BASE_TEMPLATE).toHaveProperty("dev");
    expect(BASE_TEMPLATE.build).toHaveProperty("dockerfile", "Dockerfile");
  });
});

describe("service.json schema", () => {
  it("keeps framework open to every registered frontend provider", () => {
    const schemaPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../runtime/engine/schemas/service-schema.json",
    );
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

    // Unknown user fields are preserved and warned about rather than rejected.
    expect(schema.additionalProperties).toBe(true);
    expect(schema.required).toContain("schemaVersion");
    expect(schema.properties.schemaVersion).toMatchObject({ const: 1, type: "integer" });
    expect(schema.properties.appType.enum).toContain("bring-your-own");
    expect(schema.properties.appType.enum).toContain("database");
    expect(schema.properties.type.enum).toContain("database");
    // A database names its engine in framework (only postgres) and has no port, command, image or Dockerfile.
    const databaseRule = schema.allOf.find(
      (rule: { if?: { properties?: { appType?: { const?: string } } } }) =>
        rule.if?.properties?.appType?.const === "database",
    );
    expect(databaseRule.then.properties.framework).toEqual({ const: "postgres" });
    expect(databaseRule.then.required).toEqual(["framework"]);
    expect(databaseRule.then.not.anyOf).toEqual([
      { required: ["port"] },
      { required: ["command"] },
      { required: ["image"] },
      { required: ["dockerfile"] },
    ]);
    expect(schema.properties.stack.type).toBe("string");
    expect(schema.properties.stack.enum).toBeUndefined();
    expect(schema.properties.image.type).toBe("string");
    expect(schema.properties.exposeViaProxy.type).toBe("boolean");
    // The provider registry is the contract, so the schema stays open and every registered id fits.
    expect(schema.properties.framework.enum).toBeUndefined();
    const idPattern = new RegExp(schema.properties.framework.pattern);
    for (const id of Object.keys(FRONTEND_FRAMEWORKS)) expect(id).toMatch(idPattern);
    expect("Not_A_Provider").not.toMatch(idPattern);
    expect(schema.properties.sablier.properties.deferStart).toMatchObject({
      default: false,
      type: "boolean",
    });
    expect(createServiceJson("web", "frontend", "app", 3000, [], "vue").framework).toBe("vue");
    expect(createServiceJson("web", "frontend", "app", 3000).schemaVersion).toBe(1);
    expect(createServiceJson("web", "frontend", "app", 3000).$schema).toContain(
      "schema.service.json",
    );
  });
});
