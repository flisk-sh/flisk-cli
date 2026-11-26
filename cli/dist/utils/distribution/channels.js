// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * The channel catalog behind `flisk distribute`: where a listing can go, the status vocabulary a
 * channel entry uses, and the field limits a listing has to meet.
 */
export const DISTRIBUTION_FILE = "distribution.json";
export const CHANNEL_STATUSES = ["live", "review", "draft", "blocked", "todo", "n/a"];
export const STATUS_ICONS = {
    live: "✅",
    review: "⏳",
    draft: "🟡",
    blocked: "⛔",
    todo: "⬜",
    "n/a": "—",
};
/**
 * One JSON object per channel, one row each so a new listing is a single line. The catalog is
 * parsed into Channel objects at module load; a malformed row throws there, not mid-command.
 */
const CHANNEL_DATA = `\
{"id":"claude-directory","name":"Claude directory (connector)","isMcpOnly":true,"submit":"Form at claude.ai/directory/manage (10 steps); the owner ticks the checks and presses Submit.","limits":["Remote https MCP servers only; a local stdio server cannot be a connector.","The slug is permanent: it cannot change after you submit.","One-liner at most 200 characters.","Pick at most 5 categories (Development tools first).","Every tool needs a title and read-only or destructive hints.","Needs docs, support and privacy URLs and a square icon.","Editing an approved listing sends it back to review."]}
{"id":"claude-plugin","name":"Claude plugin directory","isMcpOnly":false,"submit":"Submit the GitHub folder that holds .claude-plugin/plugin.json; link it to its connector once that is approved.","limits":["A folder in a public GitHub repo with .claude-plugin/plugin.json.","plugin.json name is the slug (lowercase, dashes).","Its .mcp.json and skills must match the connector it links to."]}
{"id":"toolradar","name":"Toolradar","isMcpOnly":false,"submit":"Submit at toolradar.com/company/submit, or claim an existing profile at toolradar.com/claim?tool=<slug>.","limits":["At most 2 submissions per hour.","Tagline at most 60 characters.","Needs a public website, category, pricing and a logo.","A personal email triggers a domain confirmation; use a company address."]}
{"id":"product-hunt","name":"Product Hunt","isMcpOnly":false,"submit":"Post by hand at producthunt.com/posts/new, in the owner's browser.","limits":["Tagline at most 60 characters.","Description at most 260 characters.","Gallery images 1270x760 (up to 8); thumbnail at least 240x240.","Video must be a YouTube or Loom link."]}
{"id":"mcp-registry","name":"Official MCP Registry","isMcpOnly":true,"submit":"Publish server.json with mcp-publisher, signed in with GitHub; updates need a new version.","limits":["Name io.github.<githubOwner>/<slug>; the GitHub login must own it.","Description at most 100 characters.","Every update needs a new version."]}
{"id":"glama","name":"Glama","isMcpOnly":true,"submit":"Add glama.json to the repo root, claim the server on glama.ai, then make a release from a passing build test.","limits":["Needs a public GitHub repository with a license.","Glama builds a Dockerfile and checks the server answers the MCP handshake.","Re-release after server changes so the score refreshes."]}
{"id":"smithery","name":"Smithery","isMcpOnly":true,"submit":"Sign in at smithery.ai/new and point it at the repo; it reads smithery.yaml.","limits":["Needs smithery.yaml in the repo.","Needs a login; the owner signs in."]}
{"id":"mcp-so","name":"mcp.so","isMcpOnly":true,"submit":"Submit the GitHub URL at mcp.so/submit (form only; its repo takes no PRs).","limits":["Submit by link: the public GitHub URL.","Needs a login."]}
{"id":"pulsemcp","name":"PulseMCP","isMcpOnly":true,"submit":"Submit by link at pulsemcp.com; it also ingests the official MCP Registry.","limits":["Submit by link.","Submissions were paused on 2026-10-07; list on the MCP Registry instead."]}
{"id":"cursor-directory","name":"Cursor Directory","isMcpOnly":true,"submit":"Submit the MCP server entry at cursor.directory, signed in.","limits":["Needs a login.","One entry per MCP server, with its install config."]}
{"id":"skills-sh","name":"skills.sh","isMcpOnly":false,"submit":"Push a public GitHub repo of skills/<name>/SKILL.md; people install it with npx skills add <owner>/<repo>.","limits":["Each skill is a SKILL.md with name and description front matter.","Installs straight from GitHub; check npx skills add works."]}
{"id":"apify","name":"Apify Store","isMcpOnly":false,"submit":"apify push from the Actor folder (apify login first), then set icon, SEO fields and categories and make it public.","limits":["Needs an Actor (.actor/actor.json and a Dockerfile).","Set icon, SEO title, SEO description and categories in the console.","Store search lags about a day."]}
{"id":"docker-hub","name":"Docker Hub","isMcpOnly":false,"submit":"docker push to the organization namespace; the owner creates the organization and picks the plan.","limits":["Needs a container image.","Push to the organization namespace, never a personal one."]}
{"id":"github-actions","name":"GitHub Actions Marketplace","isMcpOnly":false,"submit":"Edit the release, tick \\"Publish this Action to the GitHub Marketplace\\", pick two categories.","limits":["One action.yml at the repository root.","description under 125 characters, a unique name, and branding (icon and color)."]}
{"id":"npm","name":"npm","isMcpOnly":false,"submit":"npm publish from the package folder.","limits":["Package name lowercase, at most 214 characters.","Needs a README and a license."]}
{"id":"openai","name":"OpenAI (ChatGPT, Codex)","isMcpOnly":true,"submit":"Upload a plugin ZIP (.codex-plugin/plugin.json, .mcp.json, skills, assets), verify the domain, fill the review details.","limits":["Exactly one remote MCP server per plugin.","displayName at most 30 characters.","shortDescription at most 30 characters.","longDescription at most 4000 characters.","All URLs https; images square, at least 48 px, at most 5 MiB.","No credentials, hooks or apps in the package."]}
{"id":"awesome-lists","name":"Awesome lists","isMcpOnly":false,"submit":"One pull request per list, one at a time, disclosed as your own project.","limits":["Submit by link: one list line per PR.","Read and meet each list's own rules (stars, focus, activity) first."]}
`;
export const CHANNELS = CHANNEL_DATA.trim()
    .split("\n")
    .map((line) => JSON.parse(line));
export const TAGLINE_LIMIT = 60;
export const REGISTRY_DESCRIPTION_LIMIT = 100;
export const OPENAI_NAME_LIMIT = 30;
export const OPENAI_SHORT_DESCRIPTION_LIMIT = 30;
export const OPENAI_LONG_DESCRIPTION_LIMIT = 4000;
export const PRODUCT_HUNT_DESCRIPTION_LIMIT = 260;
