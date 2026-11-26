import type { TabId } from "../../types/index.js";
/** Compose footer guidance for the current tab and terminal character set. */
export declare function createHelpHint(activeTab: TabId, selectedStack: string | null, selectedService: string | null, showEnabledOnly: boolean, ascii: boolean): string;
