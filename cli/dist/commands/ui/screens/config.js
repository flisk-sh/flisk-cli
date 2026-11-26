import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import { sectionTitle, useTUITheme } from "../../../components/ui-theme.js";
import { ScreenSelectList } from "./select-list.js";
const ConfigScreen = ({ selectedServiceData, ...listProps }) => {
    const theme = useTUITheme();
    return (_jsxs(_Fragment, { children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { bold: true, color: theme.muted, children: sectionTitle(theme, "Configuration") }) }), selectedServiceData ? (_jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { color: theme.accent, children: selectedServiceData.service.configPath }), _jsx(Box, { marginTop: 1, ...(theme.ascii ? {} : { borderStyle: "single", borderColor: theme.border }), paddingX: 1, children: _jsx(Text, { color: theme.muted, wrap: "wrap", children: JSON.stringify(selectedServiceData.service.config, null, 2).slice(0, 1000) }) })] })) : (_jsx(ScreenSelectList, { prompt: "Select a service to view configuration", ...listProps }))] }));
};
export const configScreen = {
    name: "config",
    deps: [
        "selectedServiceData",
        "items",
        "onSelect",
        "highlightedIndex",
        "isActive",
        "pageSize",
        "width",
        "onLayout",
    ],
    Component: ConfigScreen,
};
