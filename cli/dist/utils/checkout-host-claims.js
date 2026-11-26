// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalCheckoutPath } from "./checkout-id.js";
import { isProcessAlive, withProjectLock } from "./project-lock.js";
/**
 * Cross-checkout registry for checkout hosts (#4697).
 *
 * `flisk up` picks a host suffix from the Tilt instances it can see, but a second `flisk up`
 * in another worktree can run before the first one's Tilt registers. Every checkout therefore
 * records a short-lived claim (its root and `flisk up` pid) under the user's home while it
 * holds a lock shared by all checkouts, so the second start observes the first claim.
 */
function claimsDir(home) {
    return join(home, ".flisk", "checkout-hosts");
}
/** Runs `fn` while holding the one lock shared by every checkout of this user. */
export async function withCheckoutHostLock(fn, home = homedir()) {
    return withProjectLock(claimsDir(home), fn);
}
function claimPath(root, home) {
    const key = createHash("sha256").update(canonicalCheckoutPath(root)).digest("hex").slice(0, 16);
    return join(claimsDir(home), "claims", `${key}.json`);
}
/** Records that `root` is starting a stack, so a concurrent start in another checkout sees it. Best effort. */
export function recordCheckoutHostClaim(root, options = {}) {
    const home = options.home ?? homedir();
    try {
        const path = claimPath(root, home);
        mkdirSync(join(claimsDir(home), "claims"), { recursive: true });
        writeFileSync(path, `${JSON.stringify({ root: canonicalCheckoutPath(root), pid: options.pid ?? process.pid })}\n`);
    }
    catch {
        // Without the claim the check falls back to the running Tilt instances alone.
    }
}
/** Roots of other checkouts whose `flisk up` process is still alive. Claims of dead processes are dropped. */
export function liveCheckoutHostClaims(ownRoot, options = {}) {
    const home = options.home ?? homedir();
    const isAlive = options.isPidAlive ?? isProcessAlive;
    const dir = join(claimsDir(home), "claims");
    const own = canonicalCheckoutPath(ownRoot);
    let files;
    try {
        files = readdirSync(dir).filter((file) => file.endsWith(".json"));
    }
    catch {
        return [];
    }
    const roots = [];
    for (const file of files) {
        const path = join(dir, file);
        try {
            const claim = JSON.parse(readFileSync(path, "utf-8"));
            if (typeof claim.root !== "string" || typeof claim.pid !== "number")
                continue;
            if (!isAlive(claim.pid)) {
                rmSync(path, { force: true });
                continue;
            }
            if (claim.root !== own)
                roots.push(claim.root);
        }
        catch {
            // Unreadable claim: ignore it.
        }
    }
    return roots;
}
