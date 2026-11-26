export declare function tiltGetUiResources(port: number): Promise<string | null>;
/** Raw `tilt get session -o json` answer, or null when Tilt cannot be read. Its `spec.tiltfilePath` names the loaded Tiltfile. */
export declare function tiltGetSession(port: number): Promise<string | null>;
export declare function tiltResourceLogs(port: number, name: string): Promise<string | null>;
export declare function formatTail(text: string, maxLines?: number): string;
