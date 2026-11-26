/** `webUi` (#2997) is read for bring-your-own resources only: the app serves pages from `/`, so it gets a host name, not a path prefix. */
export declare function webUiErrors(manifest: Record<string, unknown>, displayPath: string): string[];
