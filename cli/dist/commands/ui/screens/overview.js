import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import { ResourceSelectInput } from "../../../components/index.js";
import { useTUITheme } from "../../../components/ui-theme.js";
const EmptyState = ({ message }) => {
    const theme = useTUITheme();
    return (_jsxs(Box, { flexDirection: "column", padding: 2, alignItems: "center", children: [_jsx(Text, { bold: true, color: theme.warning, children: "No Services Found" }), _jsx(Box, { marginY: 1 }), _jsxs(Text, { color: theme.muted, children: [theme.ascii ? "[*]" : "◉", " No service.json files found"] }), _jsx(Box, { marginY: 1 }), _jsx(Text, { color: theme.foreground, children: "To get started:" }), _jsx(Text, { color: theme.foreground, children: " 1. Run: flisk project" }), _jsx(Text, { color: theme.foreground, children: " 2. Run: flisk resource api --type backend" }), _jsx(Box, { marginY: 1 }), _jsx(Text, { color: theme.accent, children: "Press [r] to refresh or [q] to quit" }), message && (_jsx(Box, { paddingX: 1, height: 1, children: _jsxs(Text, { color: theme.accent, children: [theme.bannerStart, " ", message, " ", theme.bannerEnd] }) }))] }));
};
const OverviewScreen = ({ services, message, items, onSelect, highlightedIndex, isActive, pageSize, width, onLayout, }) => {
    const theme = useTUITheme();
    if (services.length === 0) {
        return _jsx(EmptyState, { message: message });
    }
    return (_jsxs(_Fragment, { children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { bold: true, color: theme.muted, children: "Stacks" }) }), _jsx(Box, { marginTop: 1, flexGrow: 1, children: _jsx(ResourceSelectInput, { items: items, onSelect: onSelect, highlightedIndex: highlightedIndex, isActive: isActive, maxVisibleItems: pageSize, width: width, onLayout: onLayout }) })] }));
};
export const overviewScreen = {
    name: "overview",
    deps: [
        "services",
        "message",
        "items",
        "onSelect",
        "highlightedIndex",
        "isActive",
        "pageSize",
        "width",
        "onLayout",
    ],
    Component: OverviewScreen,
};
