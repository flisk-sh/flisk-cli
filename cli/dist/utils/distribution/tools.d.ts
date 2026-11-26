import type { DiscoveredResource } from "../../types/index.js";
export declare function isMcpResource(resource: DiscoveredResource): boolean;
/**
 * Tool and prompt names a resource registers, read from its source: registerTool("x"),
 * registerTool({ name: "x" }), server.tool("x") or mcp.tool("x") on an MCP server object, and
 * Python @mcp.tool / @mcp.tool(...) decorators. A .tool("x") call on any other object is not counted.
 */
export declare function readToolsAndPrompts(resourceDir: string): {
    tools: string[];
    prompts: string[];
};
