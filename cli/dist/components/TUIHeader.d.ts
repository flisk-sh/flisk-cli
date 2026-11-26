import type React from "react";
interface TUIHeaderProps {
    projectRoot: string;
    resourceCount: number;
    terminalWidth: number;
    version: string;
    /** Whether Tilt is answering. Omitted when the caller does not report it. */
    tiltStatus?: "running" | "stopped";
}
export declare const TUIHeader: React.FC<TUIHeaderProps>;
export {};
