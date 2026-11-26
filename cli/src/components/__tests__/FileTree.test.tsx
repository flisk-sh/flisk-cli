// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import type { FileNode } from "../../types/index.js";
import { expandMarker, FileTree } from "../FileTree.js";

const nodes: FileNode[] = [
  {
    name: "orders-api",
    path: "orders-api",
    type: "directory",
    children: [
      {
        name: "Dockerfile",
        path: "orders-api/Dockerfile",
        type: "file",
        fileType: "docker",
        size: 1024,
      },
      {
        name: "Tiltfile",
        path: "orders-api/Tiltfile",
        type: "file",
        fileType: "tilt",
      },
      {
        name: "schema.prisma",
        path: "orders-api/prisma/schema.prisma",
        type: "file",
        fileType: "prisma",
        size: 256,
      },
    ],
  },
  {
    name: "service.json",
    path: "service.json",
    type: "file",
    fileType: "config",
    size: 512,
  },
];

function renderTree(selectedPath?: string): string {
  return renderToString(<FileTree nodes={nodes} selectedPath={selectedPath} />);
}

describe("FileTree", () => {
  it("renders root nodes and leaves nested files collapsed", () => {
    const output = renderTree();

    expect(output).toContain("orders-api");
    expect(output).toContain("service.json");
    expect(output).not.toContain("Dockerfile");
    expect(output).not.toContain("schema.prisma");
  });

  it("renders file metadata when a selected path is supplied", () => {
    const output = renderTree("service.json");

    expect(output).toContain("service.json");
    expect(output).toContain("512 B");
  });
});

describe("expandMarker", () => {
  it("uses arrows in unicode mode and brackets in ascii mode", () => {
    expect(expandMarker(false, false)).toBe("▶");
    expect(expandMarker(false, true)).toBe("▼");
    expect(expandMarker(true, false)).toBe("[+]");
    expect(expandMarker(true, true)).toBe("[-]");
  });
});
