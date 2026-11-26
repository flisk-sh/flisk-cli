import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import { useTUITheme } from "./ui-theme.js";
const TRUNCATE = "truncate-end";
export const TUIHeader = ({ projectRoot, resourceCount, terminalWidth, version, tiltStatus, }) => {
    const theme = useTUITheme();
    const compact = terminalWidth < 80;
    const title = compact
        ? `Flisk v${version}`
        : `${theme.bannerStart} Flisk NEON EDITION v${version} ${theme.bannerEnd}`;
    const resourceLabel = `${resourceCount} resource${resourceCount === 1 ? "" : "s"} discovered`;
    const tiltLabel = tiltStatus ? `Tilt: ${tiltStatus}` : null;
    const tiltColor = tiltStatus === "running" ? theme.success : theme.warning;
    const paddingX = terminalWidth >= 28 ? 1 : 0;
    const contentWidth = Math.max(1, terminalWidth - paddingX * 2);
    const tiltLine = tiltLabel ? (_jsx(Box, { width: contentWidth, children: _jsx(Text, { color: tiltColor, wrap: TRUNCATE, children: tiltLabel }) })) : null;
    const separator = " | ";
    if (compact) {
        const headingParts = [title, resourceLabel, ...(tiltLabel ? [tiltLabel] : [])];
        const headingWidth = headingParts.reduce((total, part) => total + part.length, 0) +
            separator.length * (headingParts.length - 1);
        const splitHeading = headingWidth > contentWidth;
        return (_jsxs(Box, { flexDirection: "column", paddingX: paddingX, width: terminalWidth, children: [splitHeading ? (_jsxs(_Fragment, { children: [_jsx(Box, { width: contentWidth, children: _jsx(Text, { color: theme.accent, bold: true, wrap: TRUNCATE, children: title }) }), _jsx(Box, { width: contentWidth, children: _jsx(Text, { color: theme.success, wrap: TRUNCATE, children: resourceLabel }) }), tiltLine] })) : (_jsx(Box, { width: contentWidth, children: _jsxs(Text, { wrap: TRUNCATE, children: [_jsx(Text, { color: theme.accent, bold: true, children: title }), _jsx(Text, { color: theme.muted, children: " | " }), _jsx(Text, { color: theme.success, children: resourceLabel }), tiltLabel ? (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.muted, children: " | " }), _jsx(Text, { color: tiltColor, children: tiltLabel })] })) : null] }) })), _jsx(Box, { width: contentWidth, children: _jsx(Text, { color: theme.foreground, wrap: TRUNCATE, children: projectRoot }) })] }));
    }
    const headingParts = [title, resourceLabel, ...(tiltLabel ? [tiltLabel] : [])];
    // The row has separators around the project root plus one before an optional Tilt label.
    const separatorCount = 2 + (tiltLabel ? 1 : 0);
    const headingWidth = headingParts.reduce((total, part) => total + part.length, 0) +
        separator.length * separatorCount;
    if (headingWidth >= contentWidth) {
        return (_jsxs(Box, { flexDirection: "column", paddingX: paddingX, width: terminalWidth, children: [_jsx(Box, { width: contentWidth, children: _jsx(Text, { color: theme.accent, bold: true, wrap: TRUNCATE, children: title }) }), _jsx(Box, { width: contentWidth, children: _jsx(Text, { color: theme.success, wrap: TRUNCATE, children: resourceLabel }) }), tiltLine, _jsx(Box, { width: contentWidth, children: _jsx(Text, { color: theme.foreground, wrap: TRUNCATE, children: projectRoot }) })] }));
    }
    const rootWidth = contentWidth - headingWidth;
    return (_jsxs(Box, { flexDirection: "row", paddingX: paddingX, width: terminalWidth, children: [_jsx(Text, { color: theme.accent, bold: true, children: title }), _jsx(Text, { color: theme.muted, children: " | " }), _jsx(Box, { flexShrink: 0, width: rootWidth, children: _jsx(Text, { color: theme.foreground, wrap: TRUNCATE, children: projectRoot }) }), _jsx(Text, { color: theme.muted, children: " | " }), _jsx(Text, { color: theme.success, children: resourceLabel }), tiltLabel ? (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.muted, children: " | " }), _jsx(Text, { color: tiltColor, children: tiltLabel })] })) : null] }));
};
