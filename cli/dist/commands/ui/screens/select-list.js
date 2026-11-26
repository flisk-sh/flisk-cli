import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import { ResourceSelectInput } from "../../../components/index.js";
import { useTUITheme } from "../../../components/ui-theme.js";
/** The picker state every list screen shares: a muted prompt line above the shared select input. */
export const ScreenSelectList = ({ prompt, items, onSelect, highlightedIndex, isActive, pageSize, width, onLayout, }) => {
    const theme = useTUITheme();
    return (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.muted, children: prompt }), _jsx(Box, { marginTop: 1, children: _jsx(ResourceSelectInput, { items: items, onSelect: onSelect, highlightedIndex: highlightedIndex, isActive: isActive, maxVisibleItems: pageSize, width: width, onLayout: onLayout }) })] }));
};
