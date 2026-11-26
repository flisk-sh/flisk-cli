// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  describe,
  expect,
  generateDatabaseManagementCompose,
  it,
  projectConfig,
} from "./test-support.js";

describe("generateDatabaseManagementCompose", () => {
  it("warns that the committed compose file is not standalone (#5442)", () => {
    const compose = generateDatabaseManagementCompose(projectConfig());

    expect(compose).toContain("Not a standalone Compose file");
    expect(compose).toContain("DB_PASSWORD come from flisk up");
    expect(compose).toContain("flisk export compose");
  });

  it("turns dashes in the project name into valid compose identifiers", () => {
    const compose = generateDatabaseManagementCompose(
      projectConfig({ project: { name: "my-shop", version: "1.0.0" } }),
    );
    expect(compose).toContain("container_name: my_shop_postgres");
    expect(compose).toContain("my_shop_postgres_data:/var/lib/postgresql/data");
    expect(compose).toContain("name: my_shop_database");
  });

  it("writes an uppercase project name in lowercase, so Compose accepts it (#1519, #2993)", () => {
    const compose = generateDatabaseManagementCompose(
      projectConfig({ project: { name: "Lychee", version: "1.0.0" } }),
    );
    expect(compose).toContain("container_name: lychee_postgres");
    expect(compose).toContain("name: lychee_database");
    expect(compose).not.toContain("Lychee");
  });

  it("falls back to flisk_project when the project name is empty", () => {
    const compose = generateDatabaseManagementCompose(
      projectConfig({ project: { name: "", version: "1.0.0" } }),
    );
    expect(compose).toContain("container_name: flisk_project_postgres");
  });
});
