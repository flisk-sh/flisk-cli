// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { expect } from "vitest";

interface BackendScaffoldExpectation {
  language: string;
  files: string[];
}

const SCAFFOLD_EXPECTATIONS: Record<string, BackendScaffoldExpectation> = {
  "py-api": {
    language: "python",
    files: [".gitignore", "pyproject.toml", "service.json", "src/main.py", "tests/test_health.py"],
  },
  "go-api": {
    language: "go",
    files: [".gitignore", "go.mod", "main.go", "main_test.go", "service.json"],
  },
  "rust-api": {
    language: "rust",
    files: [".gitignore", "Cargo.toml", "service.json", "src/main.rs"],
  },
  "node-api": {
    language: "node",
    files: [
      ".gitignore",
      "package-lock.json",
      "package.json",
      "service.json",
      "src/index.js",
      "tests/health.test.js",
    ],
  },
};

const GITIGNORE_EXPECTATIONS: Record<string, string> = {
  "py-api": "__pycache__/\n.venv/\n.pytest_cache/\n*.egg-info/\n.ruff_cache/\n",
  "go-api": "/go-api\n/go-api.exe\n",
  "rust-api": "target/\n",
  "node-api": "dist/\ncoverage/\n*.tsbuildinfo\n",
  "bun-api": "dist/\ncoverage/\n*.tsbuildinfo\n",
};

export function expectBackendScaffold(
  name: string,
  serviceConfig: unknown,
  files: string[],
  gitignore: string,
): void {
  const expected = SCAFFOLD_EXPECTATIONS[name];
  expect(serviceConfig).toMatchObject({
    language: expected.language,
    appType: "backend",
    healthCheckPath: "/health",
  });
  expect(files).toEqual(expected.files);
  expectServiceGitignore(name, gitignore);
}

export function expectServiceGitignore(name: string, gitignore: string): void {
  expect(gitignore).toBe(GITIGNORE_EXPECTATIONS[name]);
}
