#!/usr/bin/env bash
# Verify every channel of a published Flisk release: npm, GitHub Packages,
# the binaries release, the checksums release and the tag.
# Usage: scripts/verify-release.sh <version>   (for example 1.4.74)
# Needs: gh (authenticated), curl. GitHub Packages is checked from the release
# workflow's job result (no read:packages scope needed); with npm and a token in
# GITHUB_PACKAGES_TOKEN it also reads the package from npm.pkg.github.com.
set -uo pipefail

V="${1:-}"
if [[ ! "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 <version>   e.g. $0 1.4.74" >&2
  exit 2
fi

FAIL=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAIL=1; }

echo "Verifying Flisk $V"

# npm (scoped; the unscoped name is not published, see docs/releasing.md)
if curl -fsS "https://registry.npmjs.org/@flisk-sh%2fflisk/$V" | grep -q "\"version\":\"$V\""; then
  ok "npm @flisk-sh/flisk@$V"
else
  bad "npm @flisk-sh/flisk@$V missing"
fi

# binaries release: not a draft, 5 binaries + engine + zip + checksums + signature
if out=$(gh release view "v$V" -R flisk-sh/releases --json isDraft,assets --jq '[.isDraft,(.assets|length)]|@tsv' 2>/dev/null); then
  read -r draft n <<<"$out"
  if [[ "$draft" == "false" && "$n" -ge 9 ]]; then ok "flisk-sh/releases v$V ($n assets)"; else bad "flisk-sh/releases v$V draft=$draft assets=$n (want not draft, >=9)"; fi
else
  bad "flisk-sh/releases v$V not found"
fi

# checksums release: not a draft, signed, with provenance
if out=$(gh release view "v$V" -R flisk-sh/flisk --json isDraft,assets --jq '[.isDraft,([.assets[].name]|join(","))]|@tsv' 2>/dev/null); then
  draft="${out%%$'\t'*}"; names="${out#*$'\t'}"
  [[ "$draft" == "false" ]] && ok "flisk-sh/flisk v$V published" || bad "flisk-sh/flisk v$V is a draft (see repair in docs/releasing.md)"
  for a in checksums.txt checksums.txt.sigstore.json checksums.txt.intoto.jsonl; do
    [[ ",$names," == *",$a,"* ]] && ok "asset $a" || bad "asset $a missing"
  done
else
  bad "flisk-sh/flisk v$V not found"
fi

# tag
if sha=$(gh api "repos/flisk-sh/flisk/git/refs/tags/v$V" --jq .object.sha 2>/dev/null); then ok "tag v$V -> ${sha:0:7}"; else bad "tag v$V missing"; fi

# GitHub Packages: the release workflow's job, newest run that has it
run=$(gh run list -R flisk-sh/flisk -w release-binaries.yml -s completed -L 30 --json databaseId,displayTitle,conclusion --jq '.[]|select(.conclusion=="success")|.databaseId' 2>/dev/null | while read -r id; do
  if gh run view "$id" -R flisk-sh/flisk --json jobs --jq '.jobs[]|select(.name|test("GitHub Packages"))|.conclusion' 2>/dev/null | grep -q success; then echo "$id"; break; fi
done)
if [[ -n "$run" ]]; then ok "GitHub Packages publish job succeeded in the latest release run ($run); set GITHUB_PACKAGES_TOKEN for a per-version check"; else bad "no successful GitHub Packages job found; run publish-existing-npm-to-github-packages.yml -f version=$V"; fi
if command -v npm >/dev/null 2>&1 && [[ -n "${GITHUB_PACKAGES_TOKEN:-}" ]]; then
  if env "npm_config_//npm.pkg.github.com/:_authToken=$GITHUB_PACKAGES_TOKEN" npm view "@flisk-sh/flisk@$V" version --registry=https://npm.pkg.github.com 2>/dev/null | grep -q "$V"; then
    ok "npm.pkg.github.com @flisk-sh/flisk@$V"
  else
    bad "npm.pkg.github.com @flisk-sh/flisk@$V missing"
  fi
fi

[[ "$FAIL" -eq 0 ]] && echo "All channels OK" || echo "Some channels failed"
exit "$FAIL"
