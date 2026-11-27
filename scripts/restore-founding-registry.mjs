#!/usr/bin/env node
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

// Rebuilds the seat registry issue body from the saved seat numbers and the bot's
// replies in #start-here. It only reads Discord and prints the body to stdout.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BELTS, TIERS } from "./discord-contributor-levels.mjs";
import { announcedSeats, discordClient, renderRegistry } from "./discord-founding-role.mjs";

export function restoreEntries(saved, messages) {
  const bySeat = new Map(saved.map((s) => [s.n, { ...s }]));
  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const claim of announcedSeats(messages)) {
    const entry = bySeat.get(claim.n) ?? { n: claim.n, github: claim.github };
    if (entry.github.toLowerCase() !== claim.github.toLowerCase()) {
      throw new Error(`Seat ${claim.n} is saved for ${entry.github}, but the bot announced ${claim.github}.`);
    }
    const discord = byId.get(claim.replyTo)?.author.id;
    if (discord && entry.discord && entry.discord !== discord) {
      throw new Error(`Seat ${claim.n} matches two Discord accounts.`);
    }
    bySeat.set(claim.n, {
      ...entry,
      ...(discord ? { discord } : {}),
      pr: claim.pr,
      at: byId.get(claim.replyTo)?.timestamp ?? claim.at,
    });
  }
  const entries = [...bySeat.values()].sort((a, b) => a.n - b.n);
  const gaps = entries.flatMap((e, i) => {
    const from = i === 0 ? 1 : entries[i - 1].n + 1;
    return Array.from({ length: e.n - from }, (_, k) => from + k);
  });
  const unlinked = entries.filter((e) => !e.discord).map((e) => e.n);
  if (gaps.length > 0 || unlinked.length > 0) {
    throw new Error(
      `Cannot restore. Missing seats: ${gaps.join(", ") || "none"}. No Discord id: ${unlinked.join(", ") || "none"}.`,
    );
  }
  return entries;
}

// Without the stored levels, the next sync would announce every level again.
export async function withLevels(entries, discord) {
  const guild = await discord.guild();
  const result = [];
  for (const entry of entries) {
    const member = await discord.member(entry.discord);
    const held = new Set(guild.roles.filter((r) => member?.roles.includes(r.id)).map((r) => r.name));
    const tier = TIERS.findLast((level) => held.has(level.role));
    const belt = BELTS.findLast((level) => held.has(level.role));
    result.push({ ...entry, ...(tier ? { tier: tier.name } : {}), ...(belt ? { belt: belt.name } : {}) });
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not set.");
  const discord = discordClient(token);
  const saved = JSON.parse(readFileSync(new URL("data/founding-seats.json", import.meta.url), "utf8"));
  const entries = await withLevels(restoreEntries(saved, await discord.messages()), discord);
  console.log(renderRegistry(entries));
}
