// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { RUST_DEV_COMMAND, rustBackendProvider } from "./rust.js";

function generatedFile(name: string, filename: string): string {
  const file = (rustBackendProvider.createFiles?.(name) ?? []).find(
    (entry) => entry.filename === filename,
  );
  if (!file) throw new Error(`missing generated file ${filename}`);
  return file.content;
}

describe("Rust backend language module", () => {
  it("exposes the provider id, label and dev command", () => {
    expect(rustBackendProvider.id).toBe("rust");
    expect(rustBackendProvider.label).toBe("Rust (axum)");
    expect(rustBackendProvider.devCommand).toBe(RUST_DEV_COMMAND);
  });

  it("pins the dev command contract to a plain cargo run", () => {
    expect(RUST_DEV_COMMAND).toBe("cargo run");
  });

  it("generates exactly the Cargo manifest and the entrypoint source", () => {
    const files = rustBackendProvider.createFiles?.("test-app") ?? [];
    expect(files.map((file) => file.filename)).toEqual(["Cargo.toml", "src/main.rs"]);
  });

  it("interpolates the supplied project name where the templates use it", () => {
    const manifest = generatedFile("test-app", "Cargo.toml");
    expect(manifest).toContain('name = "test-app"');
    const main = generatedFile("test-app", "src/main.rs");
    expect(main).toContain('"service": "test-app"');
    expect(main).toContain("test-app listening on 0.0.0.0:{port}");
  });

  it("generates no empty files", () => {
    const files = rustBackendProvider.createFiles?.("test-app") ?? [];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.content.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("Rust backend port handling", () => {
  it("validates PORT as a nonzero u16 before binding, otherwise choosing 3000", () => {
    const main = generatedFile("test-app", "src/main.rs");
    expect(main).toContain("fn parse_port(value: &str) -> u16 {");
    expect(main).toContain("value.parse::<u16>()");
    expect(main).toContain(".filter(|port| *port != 0)");
    expect(main).toContain(".unwrap_or(3000)");
    expect(main).toContain('parse_port(&std::env::var("PORT").unwrap_or_default())');
  });

  it("generates regression cases for invalid and valid values", () => {
    const main = generatedFile("test-app", "src/main.rs");
    expect(main).toContain("fn port_validation()");
    for (const value of ['"abc"', '"70000"', '"0"', '"-1"', '"3000.5"']) {
      expect(main).toContain(value);
    }
    expect(main).toContain('assert_eq!(parse_port("3001"), 3001);');
  });
});

describe("Rust backend build outputs", () => {
  it("ignores Cargo's target directory in the generated service", () => {
    expect(rustBackendProvider.gitignore).toEqual(["target/"]);
  });
});

describe("Rust backend HTTP route tests", () => {
  it("adds tower util under [dev-dependencies] in Cargo.toml", () => {
    const manifest = generatedFile("rust-api", "Cargo.toml");
    expect(manifest).toContain("[dev-dependencies]");
    expect(manifest).toContain('tower = { version = "0.5", features = ["util"] }');
  });

  it("tests GET /health and GET / through the Axum router with status, headers, and service name", () => {
    const main = generatedFile("rust-api", "src/main.rs");
    expect(main).toContain("use tower::ServiceExt;");
    expect(main).toContain("app().oneshot(request)");
    expect(main).toContain("StatusCode::OK");
    expect(main).toContain("CONTENT_TYPE");
    expect(main).toContain('get_json("/health").await');
    expect(main).toContain('get_json("/").await');
    expect(main).toContain('assert_eq!(body["status"], "ok");');
    expect(main).toContain('assert_eq!(body["service"], "rust-api");');
    expect(main).toContain("async fn root_reports_service_metadata()");
    expect(main).toContain('assert_eq!(body["endpoints"], json!(["/health"]));');
  });
});
