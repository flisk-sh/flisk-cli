// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * The channel grid behind `flisk distribute status`: one row per channel, one column per app,
 * each cell the status icon for that listing.
 */
import {
  CHANNEL_STATUSES,
  CHANNELS,
  type ChannelEntry,
  type DistributionFile,
  STATUS_ICONS,
} from "./channels.js";

export interface StatusGrid {
  apps: string[];
  channels: { id: string; name: string; cells: Record<string, ChannelEntry> }[];
}

export function buildStatusGrid(dist: DistributionFile): StatusGrid {
  const apps = Object.keys(dist.apps).sort((a, b) => a.localeCompare(b));
  const extraIds = [
    ...new Set(Object.values(dist.apps).flatMap((app) => Object.keys(app.channels ?? {}))),
  ]
    .filter((id) => !CHANNELS.some((c) => c.id === id))
    .sort((a, b) => a.localeCompare(b));
  const channelList = [
    ...CHANNELS.map((c) => ({ id: c.id, name: c.name })),
    ...extraIds.map((id) => ({ id, name: id })),
  ];
  return {
    apps,
    channels: channelList.map((channel) => ({
      ...channel,
      cells: Object.fromEntries(
        apps.map((app) => [
          app,
          dist.apps[app]?.channels?.[channel.id] ?? ({ status: "todo" } as ChannelEntry),
        ]),
      ),
    })),
  };
}

export function formatStatusGrid(grid: StatusGrid): string {
  const legend = CHANNEL_STATUSES.map((s) => `${STATUS_ICONS[s]} ${s}`).join(" · ");
  const header = ["Channel", ...grid.apps];
  const rows = grid.channels.map((c) => [
    c.name,
    ...grid.apps.map((app) => STATUS_ICONS[(c.cells[app] as ChannelEntry).status]),
  ]);
  const lines = [
    legend,
    "",
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const r of rows) lines.push(`| ${r.join(" | ")} |`);
  return lines.join("\n");
}
