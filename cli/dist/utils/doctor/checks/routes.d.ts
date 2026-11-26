import type { CheckResult } from "../../../types/index.js";
/**
 * Two API backends in one stack used to share the stack-scoped Traefik routers (`/api/<stack>-management`), so the same rule
 * matched both and Traefik chose between them arbitrarily. The engine now counts the routable backends of a stack inside one
 * service directory (the same grouping as here: resources in one directory that name the same stack). When there are two or more,
 * it drops the stack routers for all of them. A backend that sets its own `traefik.host` / `traefik.pathPrefix` keeps a router
 * for just that route; the others are left with `/api/<name>` only. This check warns about the backends that lose the stack path
 * and about two backends that set the same explicit route.
 */
export declare function checkSharedStackRoutes(projectRoot?: string): CheckResult;
