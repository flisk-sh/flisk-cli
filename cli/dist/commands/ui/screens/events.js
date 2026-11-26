import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import { sectionTitle, useTUITheme } from "../../../components/ui-theme.js";
import { stripTerminalControls } from "../../../utils/tilt-events.js";
function formatResourceStatus(resource) {
    const statuses = [];
    if (resource.runtimeStatus)
        statuses.push(`Runtime ${resource.runtimeStatus}`);
    if (resource.updateStatus)
        statuses.push(`Update ${resource.updateStatus}`);
    if (resource.hasPendingChanges)
        statuses.push("Changes pending");
    return statuses.join("; ") || "No status reported";
}
function formatEventTime(value) {
    if (!value)
        return "Current";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? value.slice(0, 20)
        : date
            .toISOString()
            .replace("T", " ")
            .replace(/\.\d{3}Z$/, "Z");
}
function formatEventDetails(value, width) {
    const normalized = stripTerminalControls(value).replace(/\s+/g, " ").trim();
    const suffix = "...";
    const maxLength = Math.max(suffix.length + 8, Math.floor(width) - 2);
    return normalized.length > maxLength
        ? normalized.slice(0, maxLength - suffix.length).trimEnd() + suffix
        : normalized;
}
const EventsScreen = ({ eventLoadState, eventLoadError, eventSnapshot, width, }) => {
    const theme = useTUITheme();
    return (_jsxs(Box, { flexDirection: "column", flexGrow: 1, children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { bold: true, color: theme.muted, children: sectionTitle(theme, "Event Timeline") }) }), (eventLoadState === "idle" || eventLoadState === "loading") && (_jsx(Text, { color: theme.muted, children: "Loading Tilt events..." })), eventLoadState === "unavailable" && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: theme.warning, children: "Tilt is not running or its UI is unreachable." }), _jsx(Text, { color: theme.muted, children: "Start the stack with flisk up, then press [r] to retry." })] })), eventLoadState === "error" && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: theme.error, children: "Could not load Tilt events." }), _jsx(Text, { color: theme.muted, children: formatEventDetails(eventLoadError ?? "Unknown Tilt error", width) }), _jsx(Text, { color: theme.muted, children: "Press [r] to retry." })] })), eventLoadState === "ready" && (_jsxs(_Fragment, { children: [eventSnapshot && eventSnapshot.resources.length > 0 && (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Text, { bold: true, color: theme.muted, children: "Current resources" }), eventSnapshot.resources.slice(0, 12).map((resource) => {
                                const resIcon = resource.runtimeStatus === "ok"
                                    ? theme.ascii
                                        ? "[+] "
                                        : "✓ "
                                    : resource.runtimeStatus === "error"
                                        ? theme.ascii
                                            ? "[x] "
                                            : "✗ "
                                        : theme.ascii
                                            ? "[~] "
                                            : "○ ";
                                return (_jsxs(Text, { color: theme.accent, children: [resIcon, resource.name, ": ", formatResourceStatus(resource)] }, resource.name));
                            }), eventSnapshot.resources.length > 12 && (_jsx(Text, { color: theme.muted, children: "Showing first 12 resources" }))] })), _jsx(Text, { bold: true, color: theme.muted, children: "Recent events" }), eventSnapshot && eventSnapshot.events.length > 20 && (_jsx(Text, { color: theme.muted, children: "Showing first 20 events" })), eventSnapshot?.events.length ? (_jsx(Box, { flexDirection: "column", marginTop: 1, children: eventSnapshot.events.slice(0, 20).map((event) => {
                            const eventBadge = event.kind === "failed"
                                ? theme.ascii
                                    ? "[x] FAIL "
                                    : "✗ FAIL "
                                : event.kind === "warning"
                                    ? theme.ascii
                                        ? "[~] WARN "
                                        : "○ WARN "
                                    : event.kind === "running"
                                        ? theme.ascii
                                            ? "[>] RUN  "
                                            : "▶ RUN  "
                                        : theme.ascii
                                            ? "[+] OK   "
                                            : "✓ OK   ";
                            return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Text, { color: event.kind === "failed"
                                            ? theme.error
                                            : event.kind === "warning"
                                                ? theme.warning
                                                : event.kind === "running"
                                                    ? theme.info
                                                    : theme.success, children: [eventBadge, formatEventTime(event.occurredAt), " ", event.resourceName, " ", event.title] }), event.details && (_jsx(Text, { color: theme.muted, children: formatEventDetails(event.details, width) }))] }, event.id));
                        }) })) : (_jsx(Text, { color: theme.muted, children: "No recent build events are available from Tilt yet." }))] }))] }));
};
export const eventsScreen = {
    name: "events",
    deps: ["eventLoadState", "eventLoadError", "eventSnapshot", "width"],
    Component: EventsScreen,
};
