// Behaviour tests for bench/competitors/flisk-kiri/docker-shim.sh (#4427). A fake `docker` stands in for both
// engines the shim talks to: a `ref id`-per-line store for the runner's Docker (calls without DOCKER_HOST) and
// one for Kiri (calls with DOCKER_HOST). Every call is logged, so the tests assert which engine did what.
// No real Docker or Kiri is needed: the shim only ever runs "$SHIM_REAL_DOCKER" with or without DOCKER_HOST set.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const shimPath = join(__dirname, "..", "..", "bench", "competitors", "flisk-kiri", "docker-shim.sh");

function findBin(name) {
	if (process.platform === "win32") {
		for (const c of [
			`C:\\Program Files\\Git\\usr\\bin\\${name}.exe`,
			`C:\\Program Files\\Git\\bin\\${name}.exe`,
			`C:\\Program Files (x86)\\Git\\usr\\bin\\${name}.exe`,
			`C:\\Program Files (x86)\\Git\\bin\\${name}.exe`,
		])
			if (existsSync(c)) return c;
	}
	return name;
}

const posix = (p) => p.replaceAll("\\", "/");

// The fake engine. `build` registers each `-t` tag with a deterministic id; `save` writes `ref id` lines to the
// tar and `load` reads them back — modelling Kiri's quirk of dropping a tag whose image id is already loaded.
const FAKE_DOCKER = `#!/usr/bin/env bash
set -u
engine=host
store=$MOCK_HOST_STORE
if [ -n "\${DOCKER_HOST:-}" ]; then engine=kiri; store=$MOCK_KIRI_STORE; fi
touch "$store"
echo "$engine $*" >> "$MOCK_LOG"

id_of() { # id_of REF_OR_ID -> the stored image id, or nothing
  local k fr fi # the caller's own read-loop variables must survive a call here
  [ -z "\${1:-}" ] && return 1
  k=\${1#sha256:}
  while read -r fr fi; do
    if [ "$fr" = "$1" ] || { [ -n "$k" ] && [ "\${fi#sha256:}" = "$k" ]; }; then echo "$fi"; return 0; fi
  done < "$store"
  return 1
}
has_ref() {
  local fr fi
  [ -z "\${1:-}" ] && return 1
  while read -r fr fi; do [ "$fr" = "$1" ] && return 0; done < "$store"
  return 1
}
put() { # put REF ID -> add the ref, or retag it to the id when it already exists
  local tmp found fr fi
  tmp=$store.tmp; : > "$tmp"; found=0
  while read -r fr fi; do
    if [ "$fr" = "$1" ]; then echo "$1 $2" >> "$tmp"; found=1; else echo "$fr $fi" >> "$tmp"; fi
  done < "$store"
  [ "$found" = 0 ] && echo "$1 $2" >> "$tmp"
  mv "$tmp" "$store"
}

cmd=\${1:-}
[ $# -gt 0 ] && shift
case $cmd in
  build | buildx)
    [ "\${MOCK_FAIL_BUILD:-0}" = 1 ] && { echo "mock: build failed" >&2; exit 1; }
    while [ $# -gt 0 ]; do
      case $1 in
        -t | --tag) put "$2" "sha256:build-$2"; shift 2 ;;
        -t=* | --tag=*) put "\${1#*=}" "sha256:build-\${1#*=}"; shift ;;
        *) shift ;;
      esac
    done
    ;;
  images)
    while read -r r i; do [ -n "$r" ] && echo "$r"; done < "$store"
    ;;
  image)
    sub=\${1:-}; [ $# -gt 0 ] && shift
    [ "$sub" = inspect ] || exit 0
    want_id=0; target=""
    while [ $# -gt 0 ]; do
      case $1 in
        --format) want_id=1; shift 2 ;;
        -*) shift ;;
        *) target=$1; shift ;;
      esac
    done
    id=$(id_of "$target") || exit 1
    [ "$want_id" = 1 ] && echo "$id"
    ;;
  save)
    out=""; refs=""
    while [ $# -gt 0 ]; do
      case $1 in
        -o | --output) out=$2; shift 2 ;;
        -o=* | --output=*) out=\${1#*=}; shift ;;
        *) refs="$refs $1"; shift ;;
      esac
    done
    : > "$out"
    for r in $refs; do
      i=$(id_of "$r") || { echo "mock: no such image $r" >&2; exit 1; }
      echo "$r $i" >> "$out"
    done
    ;;
  load)
    in=""
    while [ $# -gt 0 ]; do
      case $1 in
        -i | --input) in=$2; shift 2 ;;
        -i=* | --input=*) in=\${1#*=}; shift ;;
        *) shift ;;
      esac
    done
    while read -r r i; do
      [ -z "$r" ] && continue
      if has_ref "$r"; then
        put "$r" "$i" # docker semantics: the tag moves to the loaded image id
      elif id_of "$i" >/dev/null; then
        echo "$engine load-drops-tag $r" >> "$MOCK_LOG" # Kiri quirk: id already there, the tag is dropped
      else
        put "$r" "$i"
      fi
    done < "$in"
    ;;
  tag) # docker tag SOURCE TARGET; the source can be a ref or an image id
    id=$(id_of "$1") || { echo "mock: no such image $1" >&2; exit 1; }
    put "$2" "$id"
    ;;
  pull)
    ref=""
    for a in "$@"; do ref=$a; done
    put "$ref" "sha256:pulled-$(echo "$ref" | tr '/:' '--')"
    ;;
  *) ;;
esac
exit 0
`;

// One shim world: temp dir, both image stores, the call log and the fake docker on disk.
function world({ host = [], kiri = [], buildFail = false } = {}) {
	const root = mkdtempSync(join(tmpdir(), "docker-shim-"));
	try {
		const bin = join(root, "bin");
		const tmp = join(root, "tmp");
		mkdirSync(bin, { recursive: true });
		mkdirSync(tmp, { recursive: true });
		const docker = join(bin, "docker");
		writeFileSync(docker, FAKE_DOCKER);
		chmodSync(docker, 0o755);
		const hostStore = join(root, "host.store");
		const kiriStore = join(root, "kiri.store");
		const log = join(root, "calls.log");
		// keep the trailing newline: a `while read` loop skips an unterminated last line
		const seed = (f, rows) =>
			writeFileSync(f, rows.map(([r, i]) => `${r} ${i}`).join("\n") + (rows.length ? "\n" : ""));
		seed(hostStore, host);
		seed(kiriStore, kiri);

		const env = {
			...process.env,
			SHIM_REAL_DOCKER: posix(docker),
			SHIM_KIRI_HOST: "unix:///mock/kiri.sock",
			MOCK_HOST_STORE: posix(hostStore),
			MOCK_KIRI_STORE: posix(kiriStore),
			MOCK_LOG: posix(log),
			MOCK_FAIL_BUILD: buildFail ? "1" : "0",
			TMPDIR: posix(tmp),
			DOCKER_HOST: "",
			DOCKER_CONTEXT: "",
		};
		const store = (f) =>
			existsSync(f)
				? readFileSync(f, "utf8")
						.split("\n")
						.filter(Boolean)
						.map((l) => {
							const [r, i] = l.split(" ");
							return { r, i };
						})
				: [];
		return {
			root,
			run: (args) =>
				spawnSync(findBin("sh"), [posix(shimPath), ...args], { env, encoding: "utf8" }),
			events: () =>
				existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [],
			host: () => store(hostStore),
			kiri: () => store(kiriStore),
			cleanup: () => rmSync(root, { recursive: true, force: true }),
		};
	} catch (e) {
		rmSync(root, { recursive: true, force: true });
		throw e;
	}
}

const count = (events, re) => events.filter((e) => re.test(e)).length;

test("the shim parses as POSIX sh and bash", () => {
	for (const shell of [findBin("sh"), findBin("bash")]) {
		const r = spawnSync(shell, ["-n", posix(shimPath)], { encoding: "utf8" });
		assert.equal(r.status, 0, r.stderr);
	}
});

test("the first sync saves every missing image into one tar and loads it once", () => {
	const w = world({
		host: [
			["flisk-shop-a:latest", "sha256:aaaa"],
			["flisk-shop-b:latest", "sha256:bbbb"],
			["flisk-golden-node:22", "sha256:cccc"],
			["postgres:17-alpine", "sha256:dddd"], // not a stack image: no flisk/golden/bench in the name
			["ghcr.io/oven/bun:1", "sha256:eeee"], // pulled images are pulled on Kiri too
			["docker.io/library/nginx:alpine", "sha256:ffff"],
			["<none>:<none>", "sha256:0o0o"],
		],
	});
	try {
		const r = w.run(["build", "-t", "flisk-shop-new:latest", "."]);
		assert.equal(r.status, 0, r.stderr);
		const saves = w.events().filter((e) => /^host save /.test(e));
		assert.equal(saves.length, 1, w.events().join("\n"));
		for (const ref of ["flisk-shop-a:latest", "flisk-shop-b:latest", "flisk-golden-node:22", "flisk-shop-new:latest"])
			assert.match(saves[0], new RegExp(` ${ref}($| )`));
		assert.doesNotMatch(saves[0], /postgres|ghcr|docker\.io|<none>/);
		assert.equal(count(w.events(), /^kiri load /), 1);
		assert.equal(count(w.events(), /^kiri tag /), 0);
		assert.deepEqual(
			w.kiri().map((e) => e.r).sort(),
			["flisk-golden-node:22", "flisk-shop-a:latest", "flisk-shop-b:latest", "flisk-shop-new:latest"],
		);
	} finally {
		w.cleanup();
	}
});

test("a missing tag on an image id Kiri already has is retagged, not reloaded", () => {
	const w = world({
		host: [
			["flisk-shop-a:latest", "sha256:aaaa"],
			["flisk-shop-a:tilt-1234", "sha256:aaaa"], // same image id under a second tag
			["flisk-shop-b:latest", "sha256:bbbb"],
		],
		kiri: [
			["flisk-shop-a:latest", "sha256:aaaa"],
			["flisk-shop-b:latest", "sha256:bbbb"],
		],
	});
	try {
		const r = w.run(["build", "."]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(count(w.events(), /^host save /), 0, w.events().join("\n"));
		assert.equal(count(w.events(), /^kiri load /), 0);
		assert.equal(count(w.events(), /^kiri tag /), 1);
		assert.match(w.events().join("\n"), /^kiri tag aaaa flisk-shop-a:tilt-1234$/m);
		assert.equal(w.kiri().find((e) => e.r === "flisk-shop-a:tilt-1234").i, "sha256:aaaa");
	} finally {
		w.cleanup();
	}
});

test("an unchanged tag hiding a rebuilt image is reloaded because the id changed", () => {
	const w = world({
		host: [["flisk-shop-a:latest", "sha256:new0"]],
		kiri: [["flisk-shop-a:latest", "sha256:old0"]],
	});
	try {
		const r = w.run(["build", "."]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(count(w.events(), /^host save /), 1);
		assert.equal(count(w.events(), /^kiri load /), 1);
		assert.equal(count(w.events(), /^kiri tag /), 0);
		assert.equal(w.kiri().find((e) => e.r === "flisk-shop-a:latest").i, "sha256:new0");
	} finally {
		w.cleanup();
	}
});

test("a tag Kiri's loader dropped over an existing image id is retagged after the load", () => {
	const w = world({
		host: [
			["flisk-shop-a:latest", "sha256:xxxx"],
			["flisk-shop-a:other", "sha256:xxxx"], // lands in the same tar; Kiri drops the tag (id already there)
		],
	});
	try {
		const r = w.run(["build", "."]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(count(w.events(), /^kiri load /), 1);
		assert.match(w.events().join("\n"), /^kiri load-drops-tag flisk-shop-a:other$/m);
		assert.match(w.events().join("\n"), /^kiri tag xxxx flisk-shop-a:other$/m);
		assert.equal(w.kiri().find((e) => e.r === "flisk-shop-a:other").i, "sha256:xxxx");
	} finally {
		w.cleanup();
	}
});

test("a failed build on the host stops the shim before any sync", () => {
	const w = world({ buildFail: true, host: [["flisk-shop-a:latest", "sha256:aaaa"]] });
	try {
		const r = w.run(["build", "-t", "flisk-shop-b:latest", "."]);
		assert.equal(r.status, 1);
		assert.equal(count(w.events(), /^host save /), 0);
		assert.equal(count(w.events(), /^kiri load /), 0);
		assert.equal(count(w.events(), /^kiri image inspect /), 0);
		assert.equal(w.kiri().length, 0);
	} finally {
		w.cleanup();
	}
});

test("pull runs on both engines, tag syncs first then runs on Kiri, the rest goes to Kiri only", () => {
	const w = world({
		host: [["flisk-shop-a:latest", "sha256:aaaa"]],
		kiri: [["flisk-shop-a:latest", "sha256:aaaa"]],
	});
	try {
		let r = w.run(["pull", "ghcr.io/oven/bun:1-alpine"]);
		assert.equal(r.status, 0, r.stderr);
		assert.match(w.events().join("\n"), /^host pull ghcr\.io\/oven\/bun:1-alpine$/m);
		assert.match(w.events().join("\n"), /^kiri pull ghcr\.io\/oven\/bun:1-alpine$/m);

		r = w.run(["tag", "flisk-shop-a:latest", "flisk-shop-a:tilt-9"]);
		assert.equal(r.status, 0, r.stderr);
		assert.match(w.events().join("\n"), /^host tag flisk-shop-a:latest flisk-shop-a:tilt-9$/m);
		assert.match(w.events().join("\n"), /^kiri tag flisk-shop-a:latest flisk-shop-a:tilt-9$/m);
		assert.equal(w.kiri().find((e) => e.r === "flisk-shop-a:tilt-9").i, "sha256:aaaa");

		r = w.run(["ps", "-a"]);
		assert.equal(r.status, 0, r.stderr);
		assert.match(w.events().join("\n"), /^kiri ps -a$/m);
		assert.equal(count(w.events(), /^host ps /), 0);

		r = w.run(["compose", "-p", "x", "up", "-d"]);
		assert.equal(r.status, 0, r.stderr);
		assert.match(w.events().join("\n"), /^kiri compose -p x up -d$/m);
		assert.equal(count(w.events(), /^host compose /), 0);

		r = w.run(["compose", "-f", "x.yml", "build"]); // compose build builds on the host, then syncs
		assert.equal(r.status, 0, r.stderr);
		assert.match(w.events().join("\n"), /^host compose -f x\.yml build$/m);
		assert.equal(count(w.events(), /^kiri compose /), 1); // only the "up" above
	} finally {
		w.cleanup();
	}
});

test("a second start syncs nothing when every image id is already in Kiri", () => {
	const w = world({
		host: [
			["flisk-shop-a:latest", "sha256:aaaa"],
			["flisk-shop-b:latest", "sha256:bbbb"],
		],
	});
	try {
		let r = w.run(["build", "."]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(count(w.events(), /^kiri load /), 1);

		r = w.run(["build", "."]); // the restart: same image ids, nothing to move
		assert.equal(r.status, 0, r.stderr);
		assert.equal(count(w.events(), /^host save /), 1, w.events().join("\n")); // still the first sync only
		assert.equal(count(w.events(), /^kiri load /), 1);
		assert.equal(count(w.events(), /^kiri tag /), 0);
	} finally {
		w.cleanup();
	}
});
