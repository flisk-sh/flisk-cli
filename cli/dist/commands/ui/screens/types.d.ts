import type React from "react";
import type { DiscoveredResource, DiscoveredStack, ResourceMetadata, SelectItem, StackMetadata, TabId } from "../../../types/index.js";
import type { TiltEventSnapshot, TiltEventsFailureKind } from "../../../utils/tilt-events.js";
/**
 * The picker contract every list screen shares: the shell owns the items,
 * the highlight and the selection, the screen only draws them.
 */
export interface ScreenListProps {
    items: SelectItem[];
    onSelect: (item: SelectItem) => void;
    highlightedIndex: number;
    isActive: boolean;
    pageSize: number;
    width: number;
    onLayout: (top: number, firstVisible?: number) => void;
}
/** Everything the shell hands a screen: the shared picker contract plus the route state it keeps. */
export interface TuiScreenProps extends ScreenListProps {
    services: readonly DiscoveredResource[];
    message: string;
    selectedFile: string | null;
    selectedStackData: {
        stack: DiscoveredStack;
        metadata: StackMetadata;
    } | null;
    selectedServiceData: {
        service: DiscoveredResource;
        metadata: ResourceMetadata;
    } | null;
    terminalWidth: number;
    showSidebar: boolean;
    eventLoadState: "idle" | "loading" | "ready" | TiltEventsFailureKind;
    eventLoadError: string | null;
    eventSnapshot: TiltEventSnapshot | null;
}
/** One registered TUI screen: its route, the shell props it reads, and the component that draws it. */
export interface TuiScreen {
    name: TabId;
    deps: readonly (keyof TuiScreenProps)[];
    Component: React.FC<TuiScreenProps>;
}
