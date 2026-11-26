// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * Source inspection for `flisk distribute`: what kind of resource a service is and which tools
 * and prompts an MCP server registers, read from its source files.
 */
import fs from "node:fs";
import path from "node:path";
export function isMcpResource(resource) {
    return resource.config?.appType === "mcp";
}
const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".py", ".go"]);
const SKIP_DIRS = new Set([
    "node_modules",
    "dist",
    ".git",
    ".flisk",
    "build",
    "__pycache__",
    ".venv",
]);
function listSourceFiles(dir, out = [], depth = 0) {
    if (depth > 6 || !fs.existsSync(dir))
        return out;
    for (const entry of fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name))
                listSourceFiles(full, out, depth + 1);
        }
        else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.includes(".test.")) {
            out.push(full);
        }
    }
    return out;
}
/**
 * Tool and prompt names a resource registers, read from its source: registerTool("x"),
 * registerTool({ name: "x" }), server.tool("x") or mcp.tool("x") on an MCP server object, and
 * Python @mcp.tool / @mcp.tool(...) decorators. A .tool("x") call on any other object is not counted.
 */
export function readToolsAndPrompts(resourceDir) {
    const tools = new Set();
    const prompts = new Set();
    const toolPatterns = [
        /\bregisterTool\(\s*["'`]([\w.-]+)["'`]/g,
        /\bregisterTool\(\s*\{[^}]*?\bname\s*:\s*["'`]([\w.-]+)["'`]/g,
        /\b(?:server|mcp|mcpServer|mcp_server)\.tool\(\s*["'`]([\w.-]+)["'`]/g,
        /@\w+\.tool\b[^\n]*\n[^\S\n]*(?:async[^\S\n]+)?def[^\S\n]+(\w+)/g,
    ];
    const promptPatterns = [
        /\bregisterPrompt\(\s*["'`]([\w.-]+)["'`]/g,
        /\bregisterPrompt\(\s*\{[^}]*?\bname\s*:\s*["'`]([\w.-]+)["'`]/g,
        /\b(?:server|mcp|mcpServer|mcp_server)\.prompt\(\s*["'`]([\w.-]+)["'`]/g,
        /@\w+\.prompt\b[^\n]*\n[^\S\n]*(?:async[^\S\n]+)?def[^\S\n]+(\w+)/g,
    ];
    for (const file of listSourceFiles(resourceDir)) {
        const text = fs.readFileSync(file, "utf-8");
        for (const re of toolPatterns)
            for (const m of text.matchAll(re))
                tools.add(m[1]);
        for (const re of promptPatterns)
            for (const m of text.matchAll(re))
                prompts.add(m[1]);
    }
    return {
        tools: [...tools].sort((a, b) => a.localeCompare(b)),
        prompts: [...prompts].sort((a, b) => a.localeCompare(b)),
    };
}
