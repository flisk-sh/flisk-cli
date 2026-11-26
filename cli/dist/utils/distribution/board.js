import { CHANNELS, DISTRIBUTION_FILE, } from "./channels.js";
import { isMcpResource, readToolsAndPrompts } from "./tools.js";
/** Zachman's six perspectives, top to bottom, each with the lifecycle stage it answers for. */
export const BOARD_ROWS = [
    { perspective: "Planner", view: "Scope", stage: "Idea" },
    { perspective: "Owner", view: "Business", stage: "Promise" },
    { perspective: "Designer", view: "System", stage: "Shape" },
    { perspective: "Builder", view: "Technology", stage: "Ship" },
    { perspective: "Subcontractor", view: "Component", stage: "Listed" },
    { perspective: "User", view: "Operations", stage: "Proof" },
];
export const BOARD_COLUMNS = ["What", "How", "Where", "Who", "When", "Why"];
const filled = (text) => ({ text, isMissing: false });
const missing = (text) => ({ text: `Missing: ${text}`, isMissing: true });
const orMissing = (value, hint) => value?.trim() ? filled(value.trim()) : missing(hint);
function listOr(values, hint) {
    return values.length > 0 ? filled(values.join(", ")) : missing(hint);
}
function channelName(id) {
    return CHANNELS.find((c) => c.id === id)?.name ?? id;
}
/**
 * The Zachman board. Rows are the six perspectives, columns the six questions. Every cell is read
 * from service.json or distribution.json; a cell with no data says what to add.
 */
export function buildBoard(resources, dist) {
    const sorted = [...resources].sort((a, b) => a.name.localeCompare(b.name));
    const apps = dist?.apps ?? {};
    const appOf = (name) => apps[name] ?? {};
    const mcp = sorted.filter(isMcpResource);
    const noDist = `no ${DISTRIBUTION_FILE}; run flisk distribute status --init`;
    const distHint = (field) => (dist ? `add "${field}" to ${DISTRIBUTION_FILE}` : noDist);
    const appHint = (field) => dist ? `add "${field}" to each app in ${DISTRIBUTION_FILE}` : noDist;
    const svcHint = (field) => `no resource sets "${field}" in service.json`;
    /** "app / channel" entries, sorted, with their channel entry. */
    const entries = Object.keys(apps)
        .sort((a, b) => a.localeCompare(b))
        .flatMap((app) => Object.keys(apps[app]?.channels ?? {})
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ app, id, entry: apps[app]?.channels?.[id] })));
    const withStatus = (...statuses) => entries.filter((e) => statuses.includes(e.entry.status));
    const perApp = (pick) => sorted.flatMap((r) => {
        const value = pick(appOf(r.name))?.trim();
        return value ? [`${r.name}: ${value}`] : [];
    });
    const perResource = (pick) => sorted.flatMap((r) => {
        const value = pick(r);
        return value ? [`${r.name}: ${value}`] : [];
    });
    const latest = (list) => list
        .flatMap((e) => (e.entry.date ? [e.entry.date] : []))
        .sort((a, b) => a.localeCompare(b))
        .at(-1);
    const countCell = (list, label, hint) => list.length > 0 ? filled(`${list.length} ${label}`) : missing(hint);
    const planned = [
        ...new Set(withStatus("live", "review", "draft", "blocked").map((e) => channelName(e.id))),
    ].sort((a, b) => a.localeCompare(b));
    const listedWhere = [...new Set(withStatus("live", "review").map((e) => channelName(e.id)))].sort((a, b) => a.localeCompare(b));
    const clients = [
        ...(mcp.length > 0 ? ["AI clients over MCP"] : []),
        ...(sorted.some((r) => r.config?.appType === "frontend") ? ["people in a browser"] : []),
        ...(sorted.some((r) => r.config?.appType === "backend") ? ["other services over HTTP"] : []),
        ...(sorted.some((r) => r.config?.appType === "agent") ? ["callers of an agent"] : []),
    ];
    const tools = mcp.flatMap((r) => readToolsAndPrompts(r.path).tools.map((t) => `${r.name}/${t}`));
    const prompts = mcp.flatMap((r) => readToolsAndPrompts(r.path).prompts.map((p) => `${r.name}/${p}`));
    const noted = (list) => list.flatMap((e) => (e.entry.note ? [`${e.app}/${e.id}: ${e.entry.note}`] : []));
    const rows = [
        // Planner / Scope
        [
            sorted.length > 0
                ? filled(`${sorted.length} ${sorted.length === 1 ? "resource" : "resources"}: ${sorted
                    .map((r) => `${r.name} (${r.config?.appType ?? "unknown"})`)
                    .join(", ")}`)
                : missing("no service.json found; create one with flisk resource <name>"),
            orMissing(dist?.promise, distHint("promise")),
            listOr(planned, dist ? "no channel is planned for any app" : noDist),
            orMissing(dist?.audience, distHint("audience")),
            orMissing(dist?.launch, distHint("launch")),
            orMissing(dist?.why, distHint("why")),
        ],
        // Owner / Business
        [
            listOr(perApp((a) => a.tagline), appHint("tagline")),
            listOr(perApp((a) => a.description), appHint("description")),
            listOr(perApp((a) => a.url ?? a.homepage), appHint("url")),
            orMissing(dist?.owner, distHint("owner")),
            listOr(perApp((a) => a.version), appHint("version")),
            listOr(perApp((a) => (a.bestFor ?? []).join("; ")), appHint("bestFor")),
        ],
        // Designer / System
        [
            listOr([...new Set(sorted.flatMap((r) => (r.config?.appType ? [r.config.appType] : [])))].sort((a, b) => a.localeCompare(b)), svcHint("appType")),
            mcp.length > 0
                ? filled(`MCP routes: ${mcp.map((r) => `${r.name} ${r.config?.basePath ?? ""}/mcp`).join(", ")}`)
                : missing("no MCP resource; tools reach AI clients through one"),
            listOr(sorted.flatMap((r) => {
                const port = r.port ?? r.config?.port;
                return port ? [`${r.name}:${port}`] : [];
            }), svcHint("port")),
            listOr(clients, "no resource people or AI clients can reach"),
            listOr(perResource((r) => r.config?.dependsOn?.length ? `after ${r.config.dependsOn.join(", ")}` : undefined), svcHint("dependsOn")),
            listOr(perResource((r) => r.config?.healthCheckPath), svcHint("healthCheckPath")),
        ],
        // Builder / Technology
        [
            listOr(perResource((r) => r.config?.image ?? r.config?.dockerfile ?? r.config?.runtime), 'no resource sets "image", "dockerfile" or "runtime" in service.json'),
            listOr(perResource((r) => r.config?.command ?? r.config?.dev?.command), 'no resource sets "command" in service.json'),
            listOr(perApp((a) => a.repository), appHint("repository")),
            orMissing(dist?.githubOwner, distHint("githubOwner")),
            orMissing(dist?.release, distHint("release")),
            orMissing(dist?.license, distHint("license")),
        ],
        // Subcontractor / Component
        [
            listOr(tools, mcp.length > 0 ? "no tools found in the MCP source" : "no MCP resource"),
            listOr(prompts, mcp.length > 0 ? "no prompts found in the MCP source" : "no MCP resource"),
            listOr(listedWhere, dist ? "no channel is live or in review" : noDist),
            listOr(perApp((a) => a.reviewerNotes), appHint("reviewerNotes")),
            orMissing(latest(entries), dist ? "no dates in the channel entries" : noDist),
            listOr(noted(withStatus("blocked")), dist ? "no blocked channel with a note" : noDist),
        ],
        // User / Operations
        [
            countCell(withStatus("live"), "live listings", dist ? "no live listing yet" : noDist),
            countCell(withStatus("review"), "in review", dist ? "no listing in review" : noDist),
            listOr(withStatus("live").flatMap((e) => (e.entry.url ? [e.entry.url] : [])), dist ? "no url on a live channel entry" : noDist),
            orMissing(dist?.support, distHint("support")),
            orMissing(latest(withStatus("live")), dist ? "no date on a live channel entry" : noDist),
            listOr(noted(withStatus("live")), dist ? "no note on a live channel entry" : noDist),
        ],
    ];
    return {
        rows: BOARD_ROWS.map((r, i) => ({
            ...r,
            cells: Object.fromEntries(BOARD_COLUMNS.map((c, j) => [c, rows[i][j]])),
        })),
    };
}
export function formatBoard(board) {
    const lines = [
        "Zachman board: rows are the six perspectives, columns the six questions",
        "",
    ];
    for (const { perspective, view, stage, cells } of board.rows) {
        lines.push(`${perspective} / ${view}  (stage: ${stage})`);
        for (const column of BOARD_COLUMNS) {
            const cell = cells[column];
            lines.push(`  ${column.padEnd(6)} ${cell.isMissing ? "⬜" : "✅"} ${cell.text}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}
