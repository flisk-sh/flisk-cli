import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import { getTabBarDensity, getTerminalRuleWidth } from "../utils/terminal-layout.js";
import { TABS } from "../utils/ui-keymap.js";
import { useTUITheme } from "./ui-theme.js";
export { TABS };
function getTabRuleWidth(terminalWidth, compact) {
    if (terminalWidth !== undefined)
        return getTerminalRuleWidth(terminalWidth);
    return compact ? 60 : 80;
}
function TabItem({ tab, label, isActive, compactLayout, wide, selectedBorderProps, theme, }) {
    if (compactLayout) {
        return (_jsxs(Text, { color: isActive ? theme.selectedForeground : theme.muted, bold: isActive || theme.highContrast, backgroundColor: isActive ? theme.selectedBackground : undefined, children: [isActive ? `${theme.selectionMarker} ` : "", "[", tab.shortcut, "] ", label] }));
    }
    if (isActive) {
        return (_jsx(Box, { ...selectedBorderProps, paddingX: wide ? 1 : 0, backgroundColor: theme.selectedBackground, children: _jsxs(Text, { children: [wide && _jsx(Text, { color: theme.selectedForeground, children: theme.bannerStart }), _jsxs(Text, { color: theme.selectedForeground, bold: true, children: [" ", "[", tab.shortcut, "] ", label, " "] }), wide && _jsx(Text, { color: theme.selectedForeground, children: theme.bannerEnd })] }) }));
    }
    return (_jsx(Box, { paddingX: wide ? 1 : 0, children: _jsxs(Text, { color: theme.muted, dimColor: theme.dimMuted, bold: theme.boldMuted, children: ["[", tab.shortcut, "] ", label] }) }));
}
export const TabBar = ({ activeTab, compact = false, terminalWidth }) => {
    const theme = useTUITheme();
    const responsive = terminalWidth !== undefined;
    const density = terminalWidth === undefined ? "wide" : getTabBarDensity(terminalWidth);
    const compactLayout = responsive && density === "compact";
    const wide = !responsive || density === "wide";
    const ruleWidth = getTabRuleWidth(terminalWidth, compact);
    const divider = (theme.ascii ? "-" : "\u2500").repeat(ruleWidth);
    const selectedBorderProps = theme.ascii
        ? {}
        : { borderStyle: "single", borderColor: theme.accent };
    return (_jsxs(Box, { flexDirection: "column", paddingX: 1, children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { color: theme.muted, dimColor: theme.dimMuted, bold: theme.boldMuted, children: divider }) }), _jsx(Box, { flexDirection: "row", justifyContent: "space-between", paddingX: 1, children: TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    const label = compactLayout || (!responsive && compact && !isActive)
                        ? tab.label.slice(0, 4)
                        : tab.label;
                    return (_jsx(Box, { children: _jsx(TabItem, { tab: tab, label: label, isActive: isActive, compactLayout: compactLayout, wide: wide, selectedBorderProps: selectedBorderProps, theme: theme }) }, tab.id));
                }) }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: theme.muted, dimColor: theme.dimMuted, bold: theme.boldMuted, children: divider }) })] }));
};
