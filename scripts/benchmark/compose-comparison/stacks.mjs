// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * Stack fixtures for the compose-comparison benchmark.
 *
 * Each stack is pure data: name, description, probe URLs, ports, and a `files`
 * map of project-relative paths to file contents. `writeStackFiles`
 * materialises a fixture into a directory; each stack also carries a bound
 * `setup(dir)` for callers of the previous fixture shape.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Writes every entry of a `{ "relative/path": content }` map into dir. */
export function writeStackFiles(dir, files) {
	for (const [relativePath, content] of Object.entries(files)) {
		const target = join(dir, relativePath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
}

export const STACKS = {
	demo: {
		name: "Demo (Web + API)",
		description: "Two-tier web frontend and API backend services",
		urls: ["http://localhost:13001/health", "http://localhost:14001/health"],
		ports: [13001, 14001],
		files: {
			".flisk/project.json": JSON.stringify(
				{
					project: { name: "flisk-bench-demo", version: "1.0.0" },
					discovery: { paths: ["services/*/*"] },
				},
				null,
				2,
			),
			"services/demo/web/package.json": JSON.stringify(
				{ name: "demo-web", version: "1.0.0" },
				null,
				2,
			),
			"services/demo/web/server.js": `import { createServer } from "node:http";
const server = createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<h1>Demo Web OK</h1>");
  }
  res.writeHead(404);
  res.end();
});
server.listen(Number(process.env.PORT || 13001), "0.0.0.0");
`,
			"services/demo/web/service.json": JSON.stringify(
				{
					$schema: "https://flisk.sh/schema.service.json",
					schemaVersion: 1,
					appName: "demo-web",
					appType: "frontend",
					command: "node server.js",
					port: 13001,
					healthCheckPath: "/health",
					dependsOn: ["demo-api"],
				},
				null,
				2,
			),
			"services/demo/api/package.json": JSON.stringify(
				{ name: "demo-api", version: "1.0.0" },
				null,
				2,
			),
			"services/demo/api/server.js": `import { createServer } from "node:http";
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ status: "ok", service: "demo-api" }));
  }
  if (req.url === "/api/menu") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ items: ["Espresso", "Croissant"] }));
  }
  res.writeHead(404);
  res.end();
});
server.listen(Number(process.env.PORT || 14001), "0.0.0.0");
`,
			"services/demo/api/service.json": JSON.stringify(
				{
					$schema: "https://flisk.sh/schema.service.json",
					schemaVersion: 1,
					appName: "demo-api",
					appType: "backend",
					command: "node server.js",
					port: 14001,
					healthCheckPath: "/health",
					dependsOn: [],
				},
				null,
				2,
			),
			// Docker Compose file for the exact same services
			"docker-compose.yml": `services:
  web:
    image: node:22-alpine
    working_dir: /app
    volumes:
      - ./services/demo/web:/app
    command: node server.js
    ports:
      - "13001:13001"
    environment:
      - PORT=13001
    depends_on:
      - api
  api:
    image: node:22-alpine
    working_dir: /app
    volumes:
      - ./services/demo/api:/app
    command: node server.js
    ports:
      - "14001:14001"
    environment:
      - PORT=14001
`,
		},
	},

	"backend-postgres": {
		name: "Backend + Postgres",
		description: "Node.js REST API service connected to a PostgreSQL database",
		urls: ["http://localhost:14002/health"],
		ports: [14002, 15432],
		files: {
			".flisk/project.json": JSON.stringify(
				{
					project: { name: "flisk-bench-postgres", version: "1.0.0" },
					discovery: { paths: ["services/*/*"] },
				},
				null,
				2,
			),
			// Postgres service definition for Flisk
			"services/shop/db/service.json": JSON.stringify(
				{
					$schema: "https://flisk.sh/schema.service.json",
					schemaVersion: 1,
					appName: "shop-db",
					appType: "database",
					image: "postgres:16-alpine",
					port: 15432,
					env: {
						POSTGRES_USER: "flisk",
						POSTGRES_PASSWORD: "fliskpassword",
						POSTGRES_DB: "fliskdb",
					},
				},
				null,
				2,
			),
			"services/shop/api/package.json": JSON.stringify(
				{ name: "shop-api", version: "1.0.0" },
				null,
				2,
			),
			// Server attempts TCP socket connection to PostgreSQL port to verify DB readiness before answering 200
			"services/shop/api/server.js": `import { createServer } from "node:http";
import { connect } from "node:net";

const PG_HOST = process.env.POSTGRES_HOST || "127.0.0.1";
const PG_PORT = Number(process.env.POSTGRES_PORT || 15432);

function checkPostgres() {
  return new Promise((resolve) => {
    const socket = connect({ host: PG_HOST, port: PG_PORT }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(250, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.url === "/health") {
    const isReady = await checkPostgres();
    if (isReady) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status: "ok", postgres: "connected" }));
    }
    res.writeHead(503, { "content-type": "application/json" });
    return res.end(JSON.stringify({ status: "starting", postgres: "waiting" }));
  }
  res.writeHead(404);
  res.end();
});

server.listen(Number(process.env.PORT || 14002), "0.0.0.0");
`,
			"services/shop/api/service.json": JSON.stringify(
				{
					$schema: "https://flisk.sh/schema.service.json",
					schemaVersion: 1,
					appName: "shop-api",
					appType: "backend",
					command: "node server.js",
					port: 14002,
					healthCheckPath: "/health",
					dependsOn: ["shop-db"],
					env: {
						POSTGRES_HOST: "127.0.0.1",
						POSTGRES_PORT: "15432",
					},
				},
				null,
				2,
			),
			// Docker Compose configuration with postgres:16-alpine and api
			"docker-compose.yml": `services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: flisk
      POSTGRES_PASSWORD: fliskpassword
      POSTGRES_DB: fliskdb
    ports:
      - "15432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U flisk -d fliskdb"]
      interval: 1s
      timeout: 1s
      retries: 10
  api:
    image: node:22-alpine
    working_dir: /app
    volumes:
      - ./services/shop/api:/app
    command: node server.js
    ports:
      - "14002:14002"
    environment:
      - PORT=14002
      - POSTGRES_HOST=db
      - POSTGRES_PORT=5432
    depends_on:
      db:
        condition: service_healthy
`,
		},
	},

	"agent-stack": {
		name: "Agent Stack",
		description: "AI Agent worker service + Mock LLM Model / Tools server",
		urls: ["http://localhost:14500/health", "http://localhost:14501/health"],
		ports: [14500, 14501],
		files: {
			".flisk/project.json": JSON.stringify(
				{
					project: { name: "flisk-bench-agent", version: "1.0.0" },
					discovery: { paths: ["services/*/*"] },
				},
				null,
				2,
			),
			// Mock Model server
			"services/agent/model/package.json": JSON.stringify(
				{ name: "mock-model", version: "1.0.0" },
				null,
				2,
			),
			"services/agent/model/server.js": `import { createServer } from "node:http";
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ status: "ok", model: "mock-claude" }));
  }
  if (req.url === "/v1/messages" && req.method === "POST") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ content: [{ type: "text", text: "Task completed successfully" }] }));
  }
  res.writeHead(404);
  res.end();
});
server.listen(Number(process.env.PORT || 14501), "0.0.0.0");
`,
			"services/agent/model/service.json": JSON.stringify(
				{
					$schema: "https://flisk.sh/schema.service.json",
					schemaVersion: 1,
					appName: "mock-model",
					appType: "backend",
					command: "node server.js",
					port: 14501,
					healthCheckPath: "/health",
					dependsOn: [],
				},
				null,
				2,
			),
			// Agent Worker service
			"services/agent/worker/package.json": JSON.stringify(
				{ name: "agent-worker", version: "1.0.0" },
				null,
				2,
			),
			"services/agent/worker/server.js": `import { createServer } from "node:http";
const MODEL_URL = process.env.MODEL_URL || "http://127.0.0.1:14501";
const server = createServer(async (req, res) => {
  if (req.url === "/health") {
    try {
      const modelRes = await fetch(MODEL_URL + "/health");
      if (modelRes.ok) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", agent: "ready", model: "connected" }));
      }
    } catch {}
    res.writeHead(503, { "content-type": "application/json" });
    return res.end(JSON.stringify({ status: "starting", model: "waiting" }));
  }
  if (req.url === "/ask" && req.method === "POST") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ answer: "Agent response" }));
  }
  res.writeHead(404);
  res.end();
});
server.listen(Number(process.env.PORT || 14500), "0.0.0.0");
`,
			"services/agent/worker/service.json": JSON.stringify(
				{
					$schema: "https://flisk.sh/schema.service.json",
					schemaVersion: 1,
					appName: "agent-worker",
					appType: "backend",
					command: "node server.js",
					port: 14500,
					healthCheckPath: "/health",
					dependsOn: ["mock-model"],
					env: {
						MODEL_URL: "http://127.0.0.1:14501",
					},
				},
				null,
				2,
			),
			// Docker Compose configuration
			"docker-compose.yml": `services:
  model:
    image: node:22-alpine
    working_dir: /app
    volumes:
      - ./services/agent/model:/app
    command: node server.js
    ports:
      - "14501:14501"
    environment:
      - PORT=14501
  agent:
    image: node:22-alpine
    working_dir: /app
    volumes:
      - ./services/agent/worker:/app
    command: node server.js
    ports:
      - "14500:14500"
    environment:
      - PORT=14500
      - MODEL_URL=http://model:14501
    depends_on:
      - model
`,
		},
	},
};

for (const stack of Object.values(STACKS)) {
	const files = stack.files;
	stack.setup = (dir) => writeStackFiles(dir, files);
}
