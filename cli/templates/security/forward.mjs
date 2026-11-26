// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Shared helper for the scanner and triage: POST JSON downstream with retries.
// Fire-and-forget forwarding loses findings silently when the downstream is
// not listening yet, so failures are retried with backoff, logged to stderr,
// and reported to the caller instead of swallowed.
const TRIES = Math.max(1, Number(process.env.FORWARD_TRIES ?? 3));
const DELAY_MS = Math.max(0, Number(process.env.FORWARD_DELAY_MS ?? 200));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST `body` as JSON to `url`, retrying with linear backoff.
 * Returns true only when the downstream answered 2xx.
 */
export async function postJson(url, body) {
  const payload = JSON.stringify(body);
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      if (response.ok) return true;
      console.error(
        `forward to ${url} answered HTTP ${response.status} (attempt ${attempt}/${TRIES})`,
      );
    } catch (error) {
      console.error(
        `forward to ${url} failed (attempt ${attempt}/${TRIES}): ${error?.message ?? error}`,
      );
    }
    if (attempt < TRIES) await sleep(DELAY_MS * attempt);
  }
  return false;
}
