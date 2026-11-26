// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal shell and migrator references are test fixtures
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { native } from "../../test-support/native-runtime.js";

describe("native run missing program detection", () => {
  native.nativeTestContext({ pinPath: true });

  it("names services whose program is not installed", () => {
    const plans = native.planNativeRun([
      native.makeResource("api", "bring-your-own", { command: "node s.js" }),
      native.makeResource("go", "bring-your-own", { command: "PORT=1 nope-runtime run" }),
      native.makeResource("bin", "bring-your-own", { command: "./bin/server" }),
    ]).services;
    expect(
      native.findMissingPrograms(
        plans,
        (program) => (program === "node" ? "/usr/bin/node" : null),
        () => false,
      ),
    ).toEqual([
      { name: "go", program: "nope-runtime" },
      { name: "bin", program: "./bin/server" },
    ]);
  });

  /** One `bring-your-own` service per [name, command] pair, planned the way `flisk up` would plan it. */
  const plansFor = (services: ReadonlyArray<readonly [string, string]>) =>
    native.planNativeRun(
      services.map(([name, command]) => native.makeResource(name, "bring-your-own", { command })),
    ).services;

  /** What `findMissingPrograms` reports, with a lookup that finds nothing unless the case says otherwise. */
  const missingFor = (
    services: ReadonlyArray<readonly [string, string]>,
    find: (program: string) => string | null = () => null,
  ) => native.findMissingPrograms(plansFor(services), find, () => false);

  const cases: ReadonlyArray<{
    title: string;
    services: ReadonlyArray<readonly [string, string]>;
    expected: Array<{ name: string; program: string }>;
    find?: (program: string) => string | null;
  }> = [
    {
      // `./bin/run` is relative to ../agent, so it is left to the shell; `node` is on PATH and a lone `cd` is a builtin.
      title: "names the program after a leading cd, as a generated setup job declares it (#3885)",
      services: [
        ["setup", "cd ../agent && npm install --no-audit --no-fund"],
        ["semicolon", "cd ../agent; npm install"],
        ["installed", "cd ../agent && node server.mjs"],
        ["path", "cd ../agent && ./bin/run"],
        ["alone", "cd ../agent"],
      ],
      find: (program) => (program === "node" ? "/usr/bin/node" : null),
      expected: [
        { name: "setup", program: "npm" },
        { name: "semicolon", program: "npm" },
      ],
    },
    {
      title: "reports nothing when the program after a leading cd is installed",
      services: [["setup", "cd ../agent && npm install"]],
      find: () => "/usr/bin/npm",
      expected: [],
    },
    {
      // `export` and `:` are builtins that run first; the rest is shell grammar this preflight cannot name.
      title: "does not take a builtin or a compound command for the program (#3885 review)",
      services: [
        ["exported", "cd ../agent && export MODE=dev && npm install"],
        ["colon", "cd ../agent && : && npm install"],
        ["compound", "cd ../agent && if true; then npm install; fi"],
        ["piped", "cd ../agent && npm install | tee log"],
        ["sourced", "cd ../agent && source .env && npm install"],
        ["redirected", "cd ../agent && npm install > log"],
      ],
      expected: [
        { name: "exported", program: "npm" },
        { name: "colon", program: "npm" },
      ],
    },
    {
      title: "keeps a separator inside quotes or an escape part of the argument (#3885 review)",
      services: [
        ["quoted", 'cd ../agent && npm install --flag "a && b"'],
        ["escaped", "cd ../agent && npm install --flag a\\;b"],
      ],
      expected: [
        { name: "quoted", program: "npm" },
        { name: "escaped", program: "npm" },
      ],
    },
    {
      // Everything after an unquoted `#` never runs; a PATH the command sets is not the one this preflight reads.
      title: "stops at a shell comment and at a PATH the command sets itself (#3885 review)",
      services: [
        ["commented", "cd ../agent && echo ready # optional setup; npm install"],
        ["quoted-hash", 'cd ../agent && npm install --tag "#dev"'],
        ["path-assignment", "cd ../agent && PATH=/opt/node/bin && npm install"],
        ["exported-path", "cd ../agent && export PATH=/opt/node/bin && npm install"],
      ],
      expected: [{ name: "quoted-hash", program: "npm" }],
    },
    {
      // `-i`, `-u HOME` and `--chdir=app` belong to env; the word after them is the program it runs. An option this
      // preflight does not know is left to env rather than reported as a missing program.
      title: "reads env's own options before naming the program it runs (#4676 review)",
      services: [
        ["plain", "env npm install"],
        ["ignored", "env -i node server.js"],
        ["after-cd", "cd ../agent && env -i /usr/bin/node server.js"],
        ["unset", "env -u HOME npm ci"],
        ["inline", "env -uHOME npm ci"],
        ["chdir", "env --chdir=app npm ci"],
        ["assign", "env NODE_ENV=production npm ci"],
        ["unknown", "env -Z nope-runtime run"],
        ["missing", "env -i nope-runtime run"],
      ],
      find: (program) => (program === "npm" || program === "node" ? `/usr/bin/${program}` : null),
      expected: [{ name: "missing", program: "nope-runtime" }],
    },
  ];

  for (const { title, services, expected, find } of cases) {
    it(title, () => {
      expect(missingFor(services, find)).toEqual(expected);
    });
  }

  it("leaves a bare program to the shell when PATH has a relative entry after a cd", () => {
    const previous = process.env.PATH;
    process.env.PATH = ["bin", previous ?? ""].filter(Boolean).join(native.delimiter);
    try {
      expect(missingFor([["setup", "cd ../agent && npm install"]])).toEqual([]);
    } finally {
      process.env.PATH = previous;
    }
  });
});
