import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import { ResourceTable, ServiceIssues } from "../../../components/index.js";
import { sectionTitle, useTUITheme } from "../../../components/ui-theme.js";
import { ScreenSelectList } from "./select-list.js";
const ResourcesScreen = ({ selectedStackData, terminalWidth, showSidebar, ...listProps }) => {
    const theme = useTUITheme();
    return (_jsxs(_Fragment, { children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { bold: true, color: theme.muted, children: sectionTitle(theme, "Resources") }) }), selectedStackData ? (_jsxs(_Fragment, { children: [_jsxs(Text, { color: theme.muted, children: ["Stack: ", selectedStackData.stack.name] }), _jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(ResourceTable, { resources: selectedStackData.metadata.resources, maxWidth: terminalWidth - (showSidebar ? 50 : 10) }), _jsx(ServiceIssues, { resources: selectedStackData.metadata.resources })] })] })) : (_jsx(ScreenSelectList, { prompt: "Select a stack to view resources", ...listProps }))] }));
};
export const resourcesScreen = {
    name: "resources",
    deps: [
        "selectedStackData",
        "terminalWidth",
        "showSidebar",
        "items",
        "onSelect",
        "highlightedIndex",
        "isActive",
        "pageSize",
        "width",
        "onLayout",
    ],
    Component: ResourcesScreen,
};
