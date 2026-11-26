// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * The listing kit behind `flisk distribute kit`: plugin.json, .mcp.json, server.json and a
 * listing.md checklist written under a folder the owner reviews and submits by hand.
 */
import fs from "node:fs";
import path from "node:path";
import { FliskError } from "../errors.js";
import { trimChar } from "../trim-chars.js";
import { CHANNELS, DISTRIBUTION_FILE, OPENAI_LONG_DESCRIPTION_LIMIT, OPENAI_NAME_LIMIT, OPENAI_SHORT_DESCRIPTION_LIMIT, PRODUCT_HUNT_DESCRIPTION_LIMIT, REGISTRY_DESCRIPTION_LIMIT, STATUS_ICONS, TAGLINE_LIMIT, } from "./channels.js";
import { isMcpResource, readToolsAndPrompts } from "./tools.js";
export const URL_PLACEHOLDER = "https://REPLACE-ME.example.com/mcp";
function healthPath(resource) {
    return resource.config?.healthCheckPath ?? "/health";
}
/** A listing slug: lowercase letters, digits and single dashes. */
export function slugify(name) {
    return trimChar(name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), "-");
}
export function buildKit(resource, dist) {
    const app = dist?.apps[resource.name] ?? {};
    const slug = slugify(resource.name) || "app";
    const name = app.name?.trim() || resource.name;
    const tagline = app.tagline?.trim() ?? "";
    const description = app.description?.trim() ?? "";
    const isMcp = isMcpResource(resource);
    const url = app.url?.trim() || URL_PLACEHOLDER;
    const version = app.version?.trim() || "0.1.0";
    const owner = dist?.owner?.trim() || "REPLACE-ME";
    const githubOwner = dist?.githubOwner?.trim() || "REPLACE-ME";
    const { tools, prompts } = isMcp
        ? readToolsAndPrompts(resource.path)
        : { tools: [], prompts: [] };
    const warnings = [];
    if (!tagline)
        warnings.push(`No tagline: add "tagline" for ${resource.name} in ${DISTRIBUTION_FILE}.`);
    else {
        if (tagline.length > TAGLINE_LIMIT)
            warnings.push(`Tagline is ${tagline.length} characters; Product Hunt and Toolradar allow ${TAGLINE_LIMIT}.`);
        if (isMcp && tagline.length > OPENAI_SHORT_DESCRIPTION_LIMIT)
            warnings.push(`Tagline is ${tagline.length} characters; OpenAI allows ${OPENAI_SHORT_DESCRIPTION_LIMIT} for shortDescription.`);
    }
    if (description.length > PRODUCT_HUNT_DESCRIPTION_LIMIT)
        warnings.push(`Description is ${description.length} characters; Product Hunt allows ${PRODUCT_HUNT_DESCRIPTION_LIMIT}.`);
    if (isMcp && description.length > OPENAI_LONG_DESCRIPTION_LIMIT)
        warnings.push(`Description is ${description.length} characters; OpenAI allows ${OPENAI_LONG_DESCRIPTION_LIMIT} for longDescription.`);
    if (!description)
        warnings.push(`No description: add "description" for ${resource.name} in ${DISTRIBUTION_FILE}.`);
    if (isMcp && url === URL_PLACEHOLDER)
        warnings.push(`No public URL: add "url" for ${resource.name} in ${DISTRIBUTION_FILE}, or replace ${URL_PLACEHOLDER} by hand.`);
    if (isMcp && url !== URL_PLACEHOLDER && !url.startsWith("https://"))
        warnings.push(`The URL ${url} is not https; every channel needs a public https URL.`);
    const registryDescription = description || tagline || name;
    if (isMcp && registryDescription.length > REGISTRY_DESCRIPTION_LIMIT)
        warnings.push(`server.json description is ${registryDescription.length} characters; the MCP Registry allows ${REGISTRY_DESCRIPTION_LIMIT}. It was cut.`);
    if (isMcp && name.length > OPENAI_NAME_LIMIT)
        warnings.push(`Name is ${name.length} characters; OpenAI allows ${OPENAI_NAME_LIMIT} for displayName.`);
    if (githubOwner === "REPLACE-ME" && isMcp)
        warnings.push(`No GitHub owner: add "githubOwner" to ${DISTRIBUTION_FILE}; the MCP Registry name is io.github.<githubOwner>/${slug}.`);
    if (owner === "REPLACE-ME")
        warnings.push(`No owner: add "owner" to ${DISTRIBUTION_FILE} for the plugin author.`);
    const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
    const plugin = {
        name: slug,
        displayName: name,
        version,
        description: description || tagline || `REPLACE-ME: say what ${name} does`,
        author: { name: owner },
        ...(app.homepage ? { homepage: app.homepage } : {}),
        ...(app.repository ? { repository: app.repository } : {}),
        license: dist?.license?.trim() || "MIT",
        keywords: [slug, ...(isMcp ? ["mcp"] : [])],
    };
    const files = [{ path: ".claude-plugin/plugin.json", content: json(plugin) }];
    if (isMcp) {
        files.push({
            path: ".mcp.json",
            content: json({ mcpServers: { [slug]: { type: "http", url } } }),
        });
        files.push({
            path: "server.json",
            content: json({
                $schema: "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json",
                name: `io.github.${githubOwner}/${slug}`,
                description: registryDescription.slice(0, REGISTRY_DESCRIPTION_LIMIT),
                version,
                ...(app.repository ? { repository: { url: app.repository, source: "github" } } : {}),
                remotes: [{ type: "streamable-http", url }],
            }),
        });
    }
    const bullets = (items, empty) => items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : `- ${empty}`;
    const channelSection = CHANNELS.map((channel) => {
        const applies = !channel.isMcpOnly || isMcp;
        const entry = app.channels?.[channel.id];
        const status = entry?.status ?? (applies ? "todo" : "n/a");
        return [
            `### ${STATUS_ICONS[status]} ${channel.name}`,
            "",
            ...(applies ? [`How to submit: ${channel.submit}`, ""] : []),
            ...(applies
                ? channel.limits.map((l) => `- [ ] ${l}`)
                : ["- Not for this resource: it lists MCP servers only."]),
            ...(entry?.url ? [`- Link: ${entry.url}`] : []),
        ].join("\n");
    }).join("\n\n");
    const listing = [
        `# ${name}`,
        "",
        "This kit was written by `flisk distribute kit`. Nothing was submitted; fill in the gaps and submit each listing by hand.",
        "",
        "## Name",
        "",
        name,
        "",
        `## Tagline (at most ${TAGLINE_LIMIT} characters)`,
        "",
        tagline
            ? `${tagline} (${tagline.length} characters)`
            : "REPLACE-ME: one line people would type to find it.",
        "",
        "## Description",
        "",
        description || "REPLACE-ME: what it does, for whom, in two or three plain sentences.",
        "",
        "## Best for",
        "",
        bullets(app.bestFor ?? [], "REPLACE-ME: who gets the most out of it"),
        "",
        "## Tools",
        "",
        bullets(tools.map((t) => `\`${t}\``), isMcp ? "None found in the source; list them by hand." : "Not an MCP resource."),
        "",
        "## Prompts",
        "",
        bullets(prompts.map((p) => `\`${p}\``), isMcp ? "None found in the source; list them by hand." : "Not an MCP resource."),
        "",
        "## Reviewer notes",
        "",
        app.reviewerNotes?.trim() ||
            "REPLACE-ME: how a reviewer tries it (no account needed?), what it stores, and who to contact.",
        "",
        ...(isMcp
            ? ["## Server", "", `- URL: ${url}`, `- Health check: ${healthPath(resource)}`, ""]
            : []),
        "## Warnings",
        "",
        bullets(warnings, "None."),
        "",
        "## Channels",
        "",
        channelSection,
        "",
    ].join("\n");
    files.push({ path: "listing.md", content: listing });
    return { resource: resource.name, files, warnings };
}
/** Writes the kit under outDir. Refuses when any file exists, unless isForced. Returns the written paths. */
export function writeKit(kit, outDir, isForced) {
    const targets = kit.files.map((f) => path.join(outDir, f.path));
    const existing = targets.filter((t) => fs.existsSync(t));
    if (existing.length > 0 && !isForced) {
        throw new FliskError(`The kit already exists: ${existing.join(", ")}`, [
            "Run again with --force to overwrite it",
            "Or pick another folder with --out <dir>",
        ]);
    }
    kit.files.forEach((file, i) => {
        const target = targets[i];
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.content);
    });
    return targets;
}
