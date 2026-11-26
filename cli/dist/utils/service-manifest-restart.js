// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
const RESTART_POLICIES = ["no", "on-failure", "unless-stopped", "always"];
/**
 * `restart` on a bring-your-own resource: no, on-failure, on-failure:N (N from 1 to 100), unless-stopped or always. Mirrors
 * byo_restart_policy in engine/.../compose/byo_container.star.
 */
export function restartErrors(manifest, displayPath) {
    const { restart } = manifest;
    if (restart === undefined || restart === null)
        return [];
    if (typeof restart === "string") {
        if (RESTART_POLICIES.includes(restart))
            return [];
        const count = /^on-failure:([1-9][0-9]{0,2})$/.exec(restart);
        if (count && Number(count[1]) <= 100)
            return [];
    }
    return [
        `${displayPath}.restart: expected one of no, on-failure, on-failure:N (N from 1 to 100), unless-stopped, always`,
    ];
}
