// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as testSupport from "../../test-support/index.js";
import * as envExpand from "../env-expand.js";
import * as runtime from "../native-runtime.js";
import * as nativeUp from "../native-up.js";
import * as identity from "../process-identity.js";
const { createServer } = net;
const { delimiter, join } = path;
const { makeResource } = testSupport;
const NODE = JSON.stringify(process.execPath);
/** A `${NAME}` (or `${NAME:-fallback}`) reference, written out so it is not mistaken for a template literal. */
const ref = (name, fallback) => ["$", "{", name, fallback === undefined ? "" : `:-${fallback}`, "}"].join("");
/** A port the OS just handed out, so parallel test workers never collide on a guessed one. */
async function freePort() {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();
    await new Promise((resolve) => server.close(() => resolve()));
    return port;
}
const SERVER = `
import { createServer } from "node:http";
const port = Number(process.env.PORT);
createServer((req, res) => {
  res.writeHead(req.url === "/health" ? 200 : 404);
  res.end(process.env.GREETING ?? "");
}).listen(port, () => console.log("listening on " + port));
`;
// A database that stays down (port closed, process alive) while a `down` file exists, like Postgres during an outage.
const DB_SCRIPT = `import { createServer } from "node:http";
import { existsSync } from "node:fs";
const serve = () => existsSync("down")
  ? setTimeout(serve, 50)
  : createServer((_req, res) => { res.writeHead(200); res.end(); }).listen(Number(process.env.PORT));
serve();`;
// An API that exits as soon as it cannot reach the database, at start or later: an app with no reconnect logic.
const API_SCRIPT = `import { createServer } from "node:http";
  import { connect } from "node:net";
  const probe = () => new Promise((resolve) => {
    const socket = connect(Number(process.env.DB_PORT), "127.0.0.1");
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
  if (!(await probe())) process.exit(1);
  createServer((req, res) => { res.writeHead(req.url === "/health" ? 200 : 404); res.end(); }).listen(Number(process.env.PORT));
  setInterval(async () => { if (!(await probe())) process.exit(1); }, 50);`;
function nativeService(dir, name, config) {
    const resource = makeResource(name, "bring-your-own", config);
    return { ...resource, path: dir, configPath: join(dir, "service.json") };
}
const supervisors = [];
function waitFor(condition, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const poll = () => {
            if (condition())
                resolve();
            else if (Date.now() > deadline)
                reject(new Error("condition not met in time"));
            else
                setTimeout(poll, 50);
        };
        poll();
    });
}
function nativeTestContext({ pinPath = false } = {}) {
    afterEach(async () => {
        await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.stop()));
    });
    if (pinPath) {
        const ambientPath = process.env.PATH;
        beforeEach(() => {
            process.env.PATH = ["/usr/local/bin", "/usr/bin", "/bin"].join(delimiter);
        });
        afterEach(() => {
            process.env.PATH = ambientPath;
        });
    }
}
/** One importable handle keeps every split suite's setup in this shared module. */
const native = {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    ...runtime,
    ...fs,
    ...net,
    ...path,
    ...testSupport,
    ...envExpand,
    ...nativeUp,
    ...identity,
    spawn,
    NODE,
    ref,
    freePort,
    SERVER,
    DB_SCRIPT,
    API_SCRIPT,
    nativeService,
    supervisors,
    waitFor,
    nativeTestContext,
};
export { native };
