// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * The Zachman board behind `flisk distribute board`: six perspectives by six questions, every
 * cell read from service.json or distribution.json; a cell with no data says what to add.
 */
import type { DiscoveredResource } from "../../types/index.js";
import {
  CHANNELS,
  type ChannelEntry,
  type ChannelStatus,
  DISTRIBUTION_FILE,
  type DistributionApp,
  type DistributionFile,
} from "./channels.js";
import { isMcpResource, readToolsAndPrompts } from "./tools.js";

/** Zachman's six perspectives, top to bottom, each with the lifecycle stage it answers for. */
export const BOARD_ROWS = [
  { perspective: "Planner", view: "Scope", stage: "Idea" },
  { perspective: "Owner", view: "Business", stage: "Promise" },
  { perspective: "Designer", view: "System", stage: "Shape" },
  { perspective: "Builder", view: "Technology", stage: "Ship" },
  { perspective: "Subcontractor", view: "Component", stage: "Listed" },
  { perspective: "User", view: "Operations", stage: "Proof" },
] as const;
export const BOARD_COLUMNS = ["What", "How", "Where", "Who", "When", "Why"] as const;
export type BoardPerspective = (typeof BOARD_ROWS)[number]["perspective"];
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export interface BoardCell {
  text: string;
  isMissing: boolean;
}

export interface BoardRow {
  perspective: BoardPerspective;
  view: string;
  stage: string;
  cells: Record<BoardColumn, BoardCell>;
}

export interface Board {
  rows: BoardRow[];
}

const filled = (text: string): BoardCell => ({ text, isMissing: false });
const missing = (text: string): BoardCell => ({ text: `Missing: ${text}`, isMissing: true });
const orMissing = (value: string | undefined, hint: string): BoardCell =>
  value?.trim() ? filled(value.trim()) : missing(hint);

function listOr(values: string[], hint: string): BoardCell {
  return values.length > 0 ? filled(values.join(", ")) : missing(hint);
}

function channelName(id: string): string {
  return CHANNELS.find((c) => c.id === id)?.name ?? id;
}

/**
 * The Zachman board. Rows are the six perspectives, columns the six questions. Every cell is read
 * from service.json or distribution.json; a cell with no data says what to add.
 */
export function buildBoard(resources: DiscoveredResource[], dist: DistributionFile | null): Board {
  const sorted = [...resources].sort((a, b) => a.name.localeCompare(b.name));
  const apps = dist?.apps ?? {};
  const appOf = (name: string): DistributionApp => apps[name] ?? {};
  const mcp = sorted.filter(isMcpResource);
  const noDist = `no ${DISTRIBUTION_FILE}; run flisk distribute status --init`;
  const distHint = (field: string) => (dist ? `add "${field}" to ${DISTRIBUTION_FILE}` : noDist);
  const appHint = (field: string) =>
    dist ? `add "${field}" to each app in ${DISTRIBUTION_FILE}` : noDist;
  const svcHint = (field: string) => `no resource sets "${field}" in service.json`;

  /** "app / channel" entries, sorted, with their channel entry. */
  const entries = Object.keys(apps)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((app) =>
      Object.keys(apps[app]?.channels ?? {})
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ app, id, entry: apps[app]?.channels?.[id] as ChannelEntry })),
    );
  const withStatus = (...statuses: ChannelStatus[]) =>
    entries.filter((e) => statuses.includes(e.entry.status));
  const perApp = (pick: (app: DistributionApp) => string | undefined) =>
    sorted.flatMap((r) => {
      const value = pick(appOf(r.name))?.trim();
      return value ? [`${r.name}: ${value}`] : [];
    });
  const perResource = (pick: (r: DiscoveredResource) => string | undefined) =>
    sorted.flatMap((r) => {
      const value = pick(r);
      return value ? [`${r.name}: ${value}`] : [];
    });
  const latest = (list: { entry: ChannelEntry }[]) =>
    list
      .flatMap((e) => (e.entry.date ? [e.entry.date] : []))
      .sort((a, b) => a.localeCompare(b))
      .at(-1);
  const countCell = (list: unknown[], label: string, hint: string) =>
    list.length > 0 ? filled(`${list.length} ${label}`) : missing(hint);

  const planned = [
    ...new Set(withStatus("live", "review", "draft", "blocked").map((e) => channelName(e.id))),
  ].sort((a, b) => a.localeCompare(b));
  const listedWhere = [...new Set(withStatus("live", "review").map((e) => channelName(e.id)))].sort(
    (a, b) => a.localeCompare(b),
  );
  const clients = [
    ...(mcp.length > 0 ? ["AI clients over MCP"] : []),
    ...(sorted.some((r) => r.config?.appType === "frontend") ? ["people in a browser"] : []),
    ...(sorted.some((r) => r.config?.appType === "backend") ? ["other services over HTTP"] : []),
    ...(sorted.some((r) => r.config?.appType === "agent") ? ["callers of an agent"] : []),
  ];
  const tools = mcp.flatMap((r) => readToolsAndPrompts(r.path).tools.map((t) => `${r.name}/${t}`));
  const prompts = mcp.flatMap((r) =>
    readToolsAndPrompts(r.path).prompts.map((p) => `${r.name}/${p}`),
  );
  const noted = (list: { app: string; id: string; entry: ChannelEntry }[]) =>
    list.flatMap((e) => (e.entry.note ? [`${e.app}/${e.id}: ${e.entry.note}`] : []));

  const rows: BoardCell[][] = [
    // Planner / Scope
    [
      sorted.length > 0
        ? filled(
            `${sorted.length} ${sorted.length === 1 ? "resource" : "resources"}: ${sorted
              .map((r) => `${r.name} (${r.config?.appType ?? "unknown"})`)
              .join(", ")}`,
          )
        : missing("no service.json found; create one with flisk resource <name>"),
      orMissing(dist?.promise, distHint("promise")),
      listOr(planned, dist ? "no channel is planned for any app" : noDist),
      orMissing(dist?.audience, distHint("audience")),
      orMissing(dist?.launch, distHint("launch")),
      orMissing(dist?.why, distHint("why")),
    ],
    // Owner / Business
    [
      listOr(
        perApp((a) => a.tagline),
        appHint("tagline"),
      ),
      listOr(
        perApp((a) => a.description),
        appHint("description"),
      ),
      listOr(
        perApp((a) => a.url ?? a.homepage),
        appHint("url"),
      ),
      orMissing(dist?.owner, distHint("owner")),
      listOr(
        perApp((a) => a.version),
        appHint("version"),
      ),
      listOr(
        perApp((a) => (a.bestFor ?? []).join("; ")),
        appHint("bestFor"),
      ),
    ],
    // Designer / System
    [
      listOr(
        [...new Set(sorted.flatMap((r) => (r.config?.appType ? [r.config.appType] : [])))].sort(
          (a, b) => a.localeCompare(b),
        ),
        svcHint("appType"),
      ),
      mcp.length > 0
        ? filled(
            `MCP routes: ${mcp.map((r) => `${r.name} ${r.config?.basePath ?? ""}/mcp`).join(", ")}`,
          )
        : missing("no MCP resource; tools reach AI clients through one"),
      listOr(
        sorted.flatMap((r) => {
          const port = r.port ?? r.config?.port;
          return port ? [`${r.name}:${port}`] : [];
        }),
        svcHint("port"),
      ),
      listOr(clients, "no resource people or AI clients can reach"),
      listOr(
        perResource((r) =>
          r.config?.dependsOn?.length ? `after ${r.config.dependsOn.join(", ")}` : undefined,
        ),
        svcHint("dependsOn"),
      ),
      listOr(
        perResource((r) => r.config?.healthCheckPath),
        svcHint("healthCheckPath"),
      ),
    ],
    // Builder / Technology
    [
      listOr(
        perResource((r) => r.config?.image ?? r.config?.dockerfile ?? r.config?.runtime),
        'no resource sets "image", "dockerfile" or "runtime" in service.json',
      ),
      listOr(
        perResource((r) => r.config?.command ?? r.config?.dev?.command),
        'no resource sets "command" in service.json',
      ),
      listOr(
        perApp((a) => a.repository),
        appHint("repository"),
      ),
      orMissing(dist?.githubOwner, distHint("githubOwner")),
      orMissing(dist?.release, distHint("release")),
      orMissing(dist?.license, distHint("license")),
    ],
    // Subcontractor / Component
    [
      listOr(tools, mcp.length > 0 ? "no tools found in the MCP source" : "no MCP resource"),
      listOr(prompts, mcp.length > 0 ? "no prompts found in the MCP source" : "no MCP resource"),
      listOr(listedWhere, dist ? "no channel is live or in review" : noDist),
      listOr(
        perApp((a) => a.reviewerNotes),
        appHint("reviewerNotes"),
      ),
      orMissing(latest(entries), dist ? "no dates in the channel entries" : noDist),
      listOr(noted(withStatus("blocked")), dist ? "no blocked channel with a note" : noDist),
    ],
    // User / Operations
    [
      countCell(withStatus("live"), "live listings", dist ? "no live listing yet" : noDist),
      countCell(withStatus("review"), "in review", dist ? "no listing in review" : noDist),
      listOr(
        withStatus("live").flatMap((e) => (e.entry.url ? [e.entry.url] : [])),
        dist ? "no url on a live channel entry" : noDist,
      ),
      orMissing(dist?.support, distHint("support")),
      orMissing(latest(withStatus("live")), dist ? "no date on a live channel entry" : noDist),
      listOr(noted(withStatus("live")), dist ? "no note on a live channel entry" : noDist),
    ],
  ];

  return {
    rows: BOARD_ROWS.map((r, i) => ({
      ...r,
      cells: Object.fromEntries(
        BOARD_COLUMNS.map((c, j) => [c, (rows[i] as BoardCell[])[j] as BoardCell]),
      ) as Record<BoardColumn, BoardCell>,
    })),
  };
}

export function formatBoard(board: Board): string {
  const lines: string[] = [
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
