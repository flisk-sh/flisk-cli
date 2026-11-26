export interface BackendLanguageFile {
    filename: string;
    content: string;
    description: string;
    emoji: string;
}
export interface BackendLanguageProvider {
    id: string;
    label: string;
    /**
     * The web frameworks this language is usually served with (`fastapi` for Python, `gin` for Go), so `--backend fastapi`
     * can point at `--language python`. Hints only: the files are generated from `createFiles`.
     */
    serverFrameworks?: string[];
    /**
     * Language-owned files for a new backend. `undefined` means the provider uses the shared
     * Bun/TypeScript scaffold in `resource.ts`; Bun is the only provider that does.
     */
    createFiles?(name: string): BackendLanguageFile[];
    /** Command Tilt reloads the service with; written to `service.json` `dev.command`. */
    devCommand?: string;
    /** Paths Tilt syncs into the container for live reload. */
    watch?: string[];
    /**
     * Build outputs written into a per-service `.gitignore` when the service is scaffolded.
     * `${name}` is replaced with the resource name (the binary `go build` writes).
     */
    gitignore: string[];
    /** Printed under "Next steps" after scaffolding. */
    installHint: string;
}
