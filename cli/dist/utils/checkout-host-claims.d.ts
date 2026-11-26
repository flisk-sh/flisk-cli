/** Runs `fn` while holding the one lock shared by every checkout of this user. */
export declare function withCheckoutHostLock<T>(fn: () => Promise<T> | T, home?: string): Promise<T>;
/** Records that `root` is starting a stack, so a concurrent start in another checkout sees it. Best effort. */
export declare function recordCheckoutHostClaim(root: string, options?: {
    home?: string;
    pid?: number;
}): void;
/** Roots of other checkouts whose `flisk up` process is still alive. Claims of dead processes are dropped. */
export declare function liveCheckoutHostClaims(ownRoot: string, options?: {
    home?: string;
    isPidAlive?: (pid: number) => boolean;
}): string[];
