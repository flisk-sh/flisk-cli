// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import type React from "react";
import { useTUITheme } from "./ui-theme.js";

const TRUNCATE = "truncate-end" as const;

interface TUIHeaderProps {
  projectRoot: string;
  resourceCount: number;
  terminalWidth: number;
  version: string;
  /** Whether Tilt is answering. Omitted when the caller does not report it. */
  tiltStatus?: "running" | "stopped";
}

export const TUIHeader: React.FC<TUIHeaderProps> = ({
  projectRoot,
  resourceCount,
  terminalWidth,
  version,
  tiltStatus,
}) => {
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
  const tiltLine = tiltLabel ? (
    <Box width={contentWidth}>
      <Text color={tiltColor} wrap={TRUNCATE}>
        {tiltLabel}
      </Text>
    </Box>
  ) : null;
  const separator = " | ";

  if (compact) {
    const headingParts = [title, resourceLabel, ...(tiltLabel ? [tiltLabel] : [])];
    const headingWidth =
      headingParts.reduce((total, part) => total + part.length, 0) +
      separator.length * (headingParts.length - 1);
    const splitHeading = headingWidth > contentWidth;

    return (
      <Box flexDirection="column" paddingX={paddingX} width={terminalWidth}>
        {splitHeading ? (
          <>
            <Box width={contentWidth}>
              <Text color={theme.accent} bold wrap={TRUNCATE}>
                {title}
              </Text>
            </Box>
            <Box width={contentWidth}>
              <Text color={theme.success} wrap={TRUNCATE}>
                {resourceLabel}
              </Text>
            </Box>
            {tiltLine}
          </>
        ) : (
          <Box width={contentWidth}>
            <Text wrap={TRUNCATE}>
              <Text color={theme.accent} bold>
                {title}
              </Text>
              <Text color={theme.muted}> | </Text>
              <Text color={theme.success}>{resourceLabel}</Text>
              {tiltLabel ? (
                <>
                  <Text color={theme.muted}> | </Text>
                  <Text color={tiltColor}>{tiltLabel}</Text>
                </>
              ) : null}
            </Text>
          </Box>
        )}
        <Box width={contentWidth}>
          <Text color={theme.foreground} wrap={TRUNCATE}>
            {projectRoot}
          </Text>
        </Box>
      </Box>
    );
  }

  const headingParts = [title, resourceLabel, ...(tiltLabel ? [tiltLabel] : [])];
  // The row has separators around the project root plus one before an optional Tilt label.
  const separatorCount = 2 + (tiltLabel ? 1 : 0);
  const headingWidth =
    headingParts.reduce((total, part) => total + part.length, 0) +
    separator.length * separatorCount;

  if (headingWidth >= contentWidth) {
    return (
      <Box flexDirection="column" paddingX={paddingX} width={terminalWidth}>
        <Box width={contentWidth}>
          <Text color={theme.accent} bold wrap={TRUNCATE}>
            {title}
          </Text>
        </Box>
        <Box width={contentWidth}>
          <Text color={theme.success} wrap={TRUNCATE}>
            {resourceLabel}
          </Text>
        </Box>
        {tiltLine}
        <Box width={contentWidth}>
          <Text color={theme.foreground} wrap={TRUNCATE}>
            {projectRoot}
          </Text>
        </Box>
      </Box>
    );
  }

  const rootWidth = contentWidth - headingWidth;

  return (
    <Box flexDirection="row" paddingX={paddingX} width={terminalWidth}>
      <Text color={theme.accent} bold>
        {title}
      </Text>
      <Text color={theme.muted}> | </Text>
      <Box flexShrink={0} width={rootWidth}>
        <Text color={theme.foreground} wrap={TRUNCATE}>
          {projectRoot}
        </Text>
      </Box>
      <Text color={theme.muted}> | </Text>
      <Text color={theme.success}>{resourceLabel}</Text>
      {tiltLabel ? (
        <>
          <Text color={theme.muted}> | </Text>
          <Text color={tiltColor}>{tiltLabel}</Text>
        </>
      ) : null}
    </Box>
  );
};
