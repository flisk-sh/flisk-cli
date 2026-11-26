// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import type React from "react";
import { ResourceSelectInput } from "../../../components/index.js";
import { useTUITheme } from "../../../components/ui-theme.js";
import type { ScreenListProps } from "./types.js";

/** The picker state every list screen shares: a muted prompt line above the shared select input. */
export const ScreenSelectList: React.FC<ScreenListProps & { prompt: string }> = ({
  prompt,
  items,
  onSelect,
  highlightedIndex,
  isActive,
  pageSize,
  width,
  onLayout,
}) => {
  const theme = useTUITheme();
  return (
    <>
      <Text color={theme.muted}>{prompt}</Text>
      <Box marginTop={1}>
        <ResourceSelectInput
          items={items}
          onSelect={onSelect}
          highlightedIndex={highlightedIndex}
          isActive={isActive}
          maxVisibleItems={pageSize}
          width={width}
          onLayout={onLayout}
        />
      </Box>
    </>
  );
};
