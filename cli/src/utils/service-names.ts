// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * Parse a CLI list of service names. Variadic options such as `up --only` and `logs --service`
 * accept repeated flags and space-separated values; callers also type a comma-separated list, the
 * same form `flisk stack --resources` accepts (#5313).
 *
 * Empty entries are dropped so a trailing comma or stray spaces do not become a service name.
 * An absent option stays absent, so the callers' `if (option)` checks keep their meaning.
 */
export function parseServiceNames(names: readonly string[] | undefined): string[] | undefined {
  if (names === undefined) return undefined;
  const parsed = names
    .flatMap((name) => name.split(","))
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return [...new Set(parsed)];
}
