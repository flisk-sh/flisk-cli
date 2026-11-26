/** Writes `services/<dir>/service.json` under the project root, as `flisk resource` would. */
export declare function writeService(root: string, name: string, extra?: Record<string, unknown>, dir?: string): void;
/** A fresh project root per test, removed afterwards; `service` writes service.json files into it. */
export declare function tempProject(prefix: string): {
    root: string;
    service: (name: string, extra?: Record<string, unknown>, dir?: string) => void;
};
