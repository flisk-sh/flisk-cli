/**
 * Compare two strings by UTF-16 code unit, the same order `Array.prototype.sort()` uses with no argument.
 *
 * Generated files, JSON output and test snapshots need an order that does not change with the machine's locale,
 * so they cannot use `localeCompare`. Passing this function makes that choice explicit.
 */
export declare function byCodeUnit(a: string, b: string): number;
