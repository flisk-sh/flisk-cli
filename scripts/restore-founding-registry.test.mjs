// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { githubClient, run } from "./discord-founding-role.mjs";
import { restoreEntries, withLevels } from "./restore-founding-registry.mjs";

const claim = (id, author) => ({ id, type: 0, author: { id: author }, content: "my PR", timestamp: "2026-11-09" });
const reply = (to, n, login) => ({
  id: `r${n}`,
  type: 19,
  author: { id: "bot", bot: true },
  message_reference: { message_id: to },
  content: `🎖️ **You are Founding Contributor #${n} of 100!** chat#${n} by \`${login}\` merged.`,
});

test("restore links saved seats and adds later claims", () => {
  const entries = restoreEntries(
    [{ n: 1, github: "Ann-gh" }],
    [claim("m1", "ann"), reply("m1", 1, "ann-gh"), claim("m2", "bob"), reply("m2", 2, "bob-gh")],
  );
  assert.deepEqual(
    entries.map((e) => [e.n, e.github, e.discord]),
    [
      [1, "Ann-gh", "ann"],
      [2, "bob-gh", "bob"],
    ],
  );
});

test("restore fails on unmatched, missing or conflicting seats", () => {
  assert.throws(() => restoreEntries([{ n: 1, github: "ann-gh" }], []), /No Discord id: 1/);
  assert.throws(() => restoreEntries([], [claim("m2", "bob"), reply("m2", 2, "bob-gh")]), /Missing seats: 1/);
  assert.throws(() => restoreEntries([{ n: 1, github: "ann-gh" }], [reply("m1", 1, "eve")]), /announced eve/);
});

test("restore keeps the highest tier and belt a holder already has", async () => {
  const discord = {
    guild: async () => ({
      roles: [
        { id: "t", name: "Flisk Core" },
        { id: "b", name: "Green Belt" },
      ],
    }),
    member: async () => ({ roles: ["t", "b"] }),
  };
  const [entry] = await withLevels([{ n: 1, discord: "ann" }], discord);
  assert.equal(entry.tier, "Core");
  assert.equal(entry.belt, "Green");
});

for (const [name, entries, messages, error] of [
  ["a seat has no Discord id", [{ n: 1, github: "ann-gh" }], [], /without a Discord id: 1/],
  ["an announced seat is not listed", [], [reply("m1", 31, "new-gh")], /announced seat 31/],
]) {
  test(`the bot posts nothing when ${name}`, async () => {
    const discord = {
      guild: async () => ({
        roles: [
          { id: "f", name: "Founding Contributor" },
          { id: "c", name: "Flisk Contributor" },
        ],
      }),
      messages: async () => messages,
    };
    await assert.rejects(run({ discord, github: { readRegistry: async () => entries }, log: () => {} }), error);
  });
}

test("a missing registry issue stops the bot instead of restarting at seat 1", async () => {
  const client = githubClient("t", { fetchImpl: async () => new Response("[]", { status: 200 }) });
  await assert.rejects(client.readRegistry(), /No seat registry issue in flisk-sh\/flisk-cli/);
});

test("the saved seats are numbered 1 to 30, one per account", () => {
  const saved = JSON.parse(readFileSync(new URL("data/founding-seats.json", import.meta.url), "utf8"));
  assert.deepEqual(
    saved.map((s) => s.n),
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
  assert.equal(new Set(saved.map((s) => s.github.toLowerCase())).size, 30);
});
