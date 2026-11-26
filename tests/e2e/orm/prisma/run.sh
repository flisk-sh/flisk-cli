#!/usr/bin/env bash
# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# The prisma feature on a live stack (#1487, tracker #1279). Prisma is the only ORM the CLI supports: `flisk resource --feature prisma`
# writes prisma/schema.prisma and prisma.config.ts, adds DATABASE_URL, and registers a <name>-migrator service that runs
# `prisma migrate deploy` before the API starts. One leg; the suite is not split by language.
#
#   tests/e2e/orm/prisma/run.sh all          every case in order, then cleanup
#   tests/e2e/orm/prisma/run.sh P1 P2        single cases (later cases need the earlier ones)
# P5 measures the migrator image against a budget (MIGRATOR_UNIQUE_MAX_MB, default 100, the target in #4070).
#
# The scaffolded API keeps the template's /health and gets a /health/db route that queries Postgres through DATABASE_URL, so
# P4 proves the API reaches the database and not only that the container is up.
# Needs: flisk on PATH, Docker, Tilt, Node 22+, jq, curl.
set -euo pipefail

SUITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../lib/lib.sh
source "$SUITE_DIR/../../lib/lib.sh"
# shellcheck source=../../resource-types/common.sh
source "$SUITE_DIR/../../resource-types/common.sh"
e2e_init prisma prisma
STACK=shop
API=api
MIGRATOR="$API-migrator"
# Read by e2e_diagnostics in tests/e2e/lib/lib.sh (container logs to collect).
# shellcheck disable=SC2034
RESOURCES=("$API" "$MIGRATOR")

api_container() { running_container "$API"; }
api_running() { [[ -n "$(api_container)" ]]; }
db_healthy() { # the routed /health/db answers 200 with ok: 1 from Postgres
  [[ "$(traefik_request "$API" /health/db -o "$OUT/health-db.json" -w '%{http_code}')" = "200" ]] && jq -e '.ok == 1 and (.database | length > 0)' "$OUT/health-db.json" >/dev/null
}

# write_api_index <file>: the API answers /health/db by running `select 1` through Bun's built-in Postgres client on DATABASE_URL.
write_api_index() {
  cat >"$1" <<'TS'
import { Hono } from "hono";
import { SQL } from "bun";

const app = new Hono();
// Prisma's ?schema= parameter is not a Postgres setting; Postgres rejects it as a startup parameter, so drop it.
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.delete("schema");
const db = new SQL(url.toString());

app.get("/health", (c) => c.json({ status: "ok", service: "api" }));

// Reaches Postgres through DATABASE_URL (the prisma e2e leg, #1487).
app.get("/health/db", async (c) => {
  const [row] = await db`select current_database() as database, 1 as ok`;
  return c.json({ status: "ok", database: row.database, ok: row.ok });
});

Bun.serve({ port: Number(process.env.PORT || 3000), fetch: app.fetch });
TS
}

P1() { # scaffold a backend with the prisma feature and give it a /health/db route that queries Postgres
  log "P1 scaffold $API with --feature prisma"
  common_scaffold backend "$API" --feature prisma --stack "$STACK" --yes
  local res="$DIR/services/$STACK/$API"
  [[ -f "$res/prisma/schema.prisma" ]] || die "scaffold did not write prisma/schema.prisma"
  [[ -f "$res/prisma.config.ts" ]] || die "scaffold did not write prisma.config.ts"
  jq -e '.dependencies.prisma and .dependencies["@prisma/client"]' "$res/package.json" >/dev/null || die "package.json has no prisma dependencies"
  jq -e --arg m "$MIGRATOR" '.appType == "migrator" and .name == $m' "$DIR/services/$STACK/$MIGRATOR/service.json" >/dev/null \
    || die "scaffold did not register the $MIGRATOR service"
  write_api_index "$res/src/index.ts"
}

P2() { # flisk up, the API is routed and listed as a backend in flisk status
  log "P2 flisk up; $API is routed and listed as a backend"
  : >"$DIR/up.log"
  start_stack "$STACK"
  wait_status_url "$API"
  common_wait_status "$API" backend
}

P3() { # DATABASE_URL is in the API container's environment
  log "P3 DATABASE_URL is set in the $API container"
  # P2 proves flisk status lists the API, not that Tilt has started its container yet, so wait for the running container first.
  poll_until "a running $API container" "$READY_TIMEOUT" api_running
  local c; c="$(api_container)"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$c" >"$OUT/api-env.txt"
  grep -q '^DATABASE_URL=postgres' "$OUT/api-env.txt" || die "DATABASE_URL is not in the $API container environment"
  echo "DATABASE_URL is set in $c (value not printed)"
}

P4() { # the routed /health/db queries Postgres through DATABASE_URL
  log "P4 $API queries Postgres through /health/db"
  poll_until "$API answers /health/db with ok 1 from Postgres" "$READY_TIMEOUT" db_healthy
  timing_serving cold_start || true
  echo "$(cat "$OUT/health-db.json")"
}

P5() { # the migrator image adds no more than its budget over the layers it shares with the service (#4070)
  log "P5 $MIGRATOR image stays within its size budget"
  local img; img="$(docker ps -a --filter "name=$MIGRATOR" --format '{{.Image}}' | head -n 1)"
  [[ -n "$img" ]] || die "no $MIGRATOR container, so there is no image to measure"
  local base="" candidate n
  # The migrator builds on the same *-l4-backend golden base as the service, whose layers are the
  # first layers of the migrator image.
  while read -r candidate; do
    n="$(docker image inspect "$candidate" -f '{{len .RootFS.Layers}}')"
    if [[ "$(docker image inspect "$img" -f "{{json .RootFS.Layers}}" | jq -c ".[0:$n]")" = "$(docker image inspect "$candidate" -f '{{json .RootFS.Layers}}' | jq -c .)" ]]; then base="$candidate"; break; fi
  done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -- '-l4-backend:')
  [[ -n "$base" ]] || die "$img is not built on the golden l4-backend image the service runs on"
  local api_cid api_img; api_cid="$(api_container)"
  [[ -n "$api_cid" ]] || die "no running $API container, so the layers the migrator shares with the service cannot be measured"
  api_img="$(docker inspect "$api_cid" -f '{{.Image}}')"
  # Unique size = the migrator's layers no other image stores, the number `docker system df` calls
  # UNIQUE SIZE and the metric behind the 570-960 MB in #4070. The migrator emits the service's own
  # dependency stage and COPYs, so its base, node_modules, pinned Prisma CLI and package.json
  # layers are already in the api image's layer set and are not counted twice.
  docker image inspect "$api_img" -f '{{json .RootFS.Layers}}' | jq -r '.[]' >"$OUT/api-layers.txt"
  docker image inspect "$img" -f '{{json .RootFS.Layers}}' | jq -r '.[]' >"$OUT/migrator-layers.txt"
  # docker history lists steps newest-first; the nonzero ones are the filesystem layers in the
  # reverse order of RootFS.Layers, so pairing them after reversing maps size to diff id.
  docker history --human=false --format '{{.Size}}' "$img" | awk '$1+0 > 0' | awk '{a[NR]=$0} END {for (i = NR; i > 0; i--) print a[i]}' >"$OUT/migrator-sizes.txt"
  [[ "$(wc -l <"$OUT/migrator-layers.txt" | tr -d ' ')" -eq "$(wc -l <"$OUT/migrator-sizes.txt" | tr -d ' ')" ]] \
    || die "cannot map $img layers to their sizes; report the output of docker history $img"
  paste -d' ' "$OUT/migrator-layers.txt" "$OUT/migrator-sizes.txt" >"$OUT/migrator-layer-sizes.txt"
  local total unique
  total="$(awk '{s+=$2} END {print s+0}' "$OUT/migrator-layer-sizes.txt")"
  unique="$(grep -vF -f "$OUT/api-layers.txt" "$OUT/migrator-layer-sizes.txt" | awk '{s+=$2} END {print s+0}')"
  local unique_mb=$((unique / 1000000))
  echo "$img is $((total / 1000000)) MB reported, $unique_mb MB unique to it over $api_img (budget ${MIGRATOR_UNIQUE_MAX_MB:-100} MB)"
  [[ "$unique_mb" -le "${MIGRATOR_UNIQUE_MAX_MB:-100}" ]] || die "the $MIGRATOR image holds $unique_mb MB of layers the service image does not already have, over the ${MIGRATOR_UNIQUE_MAX_MB:-100} MB budget; look at docker history $img for a layer that stores node_modules a second time"
}

e2e_main "$@"
