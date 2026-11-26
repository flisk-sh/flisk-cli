#!/usr/bin/env bash
# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# A backend resource in one language on a live stack (openspec task 3.5, #1290; restart and error envelope, #1294). The matrix runs this suite once per language,
# with LANGUAGE set to that language:
#
#   LANGUAGE=python tests/e2e/resource-types/backend/run.sh all      every case in order, then cleanup
#   tests/e2e/resource-types/backend/run.sh B1 B2 B3 B4 B5        single cases (LANGUAGE defaults to bun)
#
# Needs: flisk on PATH, Docker, Tilt, Node 22+, jq, curl.
set -euo pipefail

SUITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LANGUAGE="${LANGUAGE:-bun}"
FRAMEWORK="${FRAMEWORK:-}" # empty keeps the language's default framework
# shellcheck source=../../../lib/lib.sh
source "$SUITE_DIR/../../lib/lib.sh"
# shellcheck source=../common.sh
source "$SUITE_DIR/../common.sh"
e2e_init backend "backend-$LANGUAGE${FRAMEWORK:+-$FRAMEWORK}"
STACK=shop
API=api
# Read by e2e_diagnostics in tests/e2e/lib/lib.sh (container logs to collect).
# shellcheck disable=SC2034
RESOURCES=("$API")
# B1b/B2b: the directory name is literal (single quotes) and runs `touch` on the first unquoted Tilt local() call that uses it.
# The marker name is relative and holds no variable: Compose and Tilt expand $VAR inside the paths they are given, which would point the
# env file at a directory that was never created and fail the stack (rc-1.3.208). Tilt runs local() below $DIR (.flisk/.flisk-out), so find
# under $DIR sees the marker wherever it lands.
PROBE_MARK=pwned_by_b1b
PROBE_DIR='svc$(touch pwned_by_b1b)x'

api_healthy() { [[ "$(traefik_request "$API" /health -o /dev/null -w '%{http_code}')" = "200" ]]; }
api_container() { running_container "$API"; }

B1() { # scaffold a backend in the language under test
  log "B1 scaffold a $LANGUAGE backend${FRAMEWORK:+ with $FRAMEWORK}"
  common_scaffold backend "$API" --language "$LANGUAGE" ${FRAMEWORK:+--framework "$FRAMEWORK"} --stack "$STACK" --yes
  [ -d "$DIR/services/$STACK/$API" ] || die "scaffolded backend directory missing under services/$STACK/$API"
}

B1b() { # regression for the unquoted Tilt local() path (manifest_resource.star): a service directory named with command substitution
  log "B1b add a service directory whose name runs a command if the generator does not quote it"
  mkdir -p "$DIR/services/$STACK/$PROBE_DIR"
  # A copy of the api service.json keeps api's appName, and flisk refuses to start two resources with one appName.
  jq '.name = "probe" | .appName = "probe"' "$DIR/services/$STACK/$API/service.json" >"$DIR/services/$STACK/$PROBE_DIR/service.json"
  # Discovery runs without a stack. The probe is removed before `flisk up`: Compose interpolates the `$(` in its path and fails the whole stack.
  poll_until "probe listed in flisk status" "$READY_TIMEOUT" probe_listed
  rm -rf "$DIR/services/$STACK/$PROBE_DIR"
}

probe_listed() { status_json | jq -e '.data.resources[] | select(.name=="probe")' >/dev/null; }

B2() { # flisk up, then the backend is listed as a backend in flisk status
  log "B2 flisk up and status lists $API as a $LANGUAGE backend"
  : >"$DIR/up.log"
  start_stack "$STACK"
  wait_status_url "$API"
  common_wait_status "$API" backend
}

B2b() { # the command in the probe directory name did not run, during discovery or during `flisk up`
  log "B2b probe directory name ran no command"
  local found; found="$(find "$DIR" -name "$PROBE_MARK" -print -quit 2>/dev/null)"
  [ -z "$found" ] || die "a command in a service directory name ran; marker found at: $found"
}

B3() { # the routed health check answers 200 through Traefik
  log "B3 $API answers /health through Traefik"
  poll_until "$API answers /health 200 through Traefik" "$READY_TIMEOUT" api_healthy
  timing_serving cold_start || true
}

B3b() { # flisk down, then flisk up again with the images cached: /health answers 200 (the warm start, stacklytics)
  log "B3b warm start: flisk down, flisk up, $API answers /health"
  common_warm_start "$STACK" "$API answers /health 200 through Traefik" api_healthy
}

B4() { # flisk restart, then the API answers /health again through Traefik
  log "B4 flisk restart $API"
  local before; before="$(api_container)"
  common_restart "$API" "$before" "$API answers /health 200 through Traefik" api_healthy
}

B5() { # restart with Tilt unreachable prints one TILT_NOT_RUNNING error envelope and exits 1
  log "B5 flisk restart with no Tilt on the port: one error envelope"
  common_error_envelope TILT_NOT_RUNNING restart "$API" --port 1 --json
}

N1() { # a local-process Bun backend: `flisk resource --local` keeps `bun run dev`, `flisk up` with no Docker answers /health (#5403)
  if [ "$LANGUAGE" != "bun" ]; then
    log "N1 skipped: the local Bun command is only checked on the bun leg (LANGUAGE=$LANGUAGE)"
    return 0
  fi
  log "N1 local-process Bun backend: --local, flisk up with no Docker, /health"
  # This case owns $DIR and runs last, after B5. It starts with a clean project so no Tilt or Compose file is left over.
  rm -rf "$DIR"; mkdir -p "$DIR"; (cd "$DIR" && git init -q .)
  run n1-project project --yes
  [[ "$RC" -eq 0 ]] || die "flisk project --yes exited $RC"
  run n1-resource resource nbun --type backend --language bun --local --yes
  [[ "$RC" -eq 0 ]] || die "flisk resource nbun --type backend --language bun --local exited $RC"
  local svc_dir="$DIR/services/main/nbun"
  # The scaffold's own dev script runs Bun, so the host command must too: `npm run dev` fails on a Bun-first machine with no npm.
  jq -e '.command == "bun run dev"' "$svc_dir/service.json" >/dev/null \
    || die "service.json command is not 'bun run dev': $(jq -c .command "$svc_dir/service.json")"
  [[ ! -f "$svc_dir/Dockerfile" ]] || die "--local backend still has a Dockerfile"
  (cd "$svc_dir" && bun install >"$DIR/n1-install.log" 2>&1) || die "bun install failed: $(tail -5 "$DIR/n1-install.log")"
  local port; port="$(jq -r .port "$svc_dir/service.json")"
  echo "nbun port: $port"
  : >"$DIR/up.log"
  (cd "$DIR" && nohup flisk up >>"$DIR/up.log" 2>&1 &)
  nbun_ready() {
    [[ "$(direct "http://localhost:$port/health" -o /dev/null -w '%{http_code}' 2>/dev/null || true)" = "200" ]]
  }
  poll_until "nbun answers /health as a local process" 120 nbun_ready
  run n1-status status --json
  assert check "$OUT/n1-status.out" "j.data.runtime === 'native'" "flisk status reports a native run"
  [[ -z "$(docker ps -q --filter "name=${PROJECT}-.*-nbun-" 2>/dev/null || true)" ]] || die "a container exists for the local-process backend"
}

e2e_main "$@"
