// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import type React from "react";
import { ResourceSelectInput } from "../../../components/index.js";
import { useTUITheme } from "../../../components/ui-theme.js";
import type { TuiScreen, TuiScreenProps } from "./types.js";

const EmptyState: React.FC<{ message?: string }> = ({ message }) => {
  const theme = useTUITheme();
  return (
    <Box flexDirection="column" padding={2} alignItems="center">
      <Text bold color={theme.warning}>
        No Services Found
      </Text>
      <Box marginY={1} />
      <Text color={theme.muted}>{theme.ascii ? "[*]" : "◉"} No service.json files found</Text>
      <Box marginY={1} />
      <Text color={theme.foreground}>To get started:</Text>
      <Text color={theme.foreground}> 1. Run: flisk project</Text>
      <Text color={theme.foreground}> 2. Run: flisk resource api --type backend</Text>
      <Box marginY={1} />
      <Text color={theme.accent}>Press [r] to refresh or [q] to quit</Text>
      {/* The top-level Esc hint has to be visible here too - with no services this is the
        whole screen, and without this line the hint was set but never drawn. */}
      {message && (
        <Box paddingX={1} height={1}>
          <Text color={theme.accent}>
            {theme.bannerStart} {message} {theme.bannerEnd}
          </Text>
        </Box>
      )}
    </Box>
  );
};

const OverviewScreen: React.FC<TuiScreenProps> = ({
  services,
  message,
  items,
  onSelect,
  highlightedIndex,
  isActive,
  pageSize,
  width,
  onLayout,
}) => {
  const theme = useTUITheme();
  if (services.length === 0) {
    return <EmptyState message={message} />;
  }
  return (
    <>
      <Box marginBottom={1}>
        <Text bold color={theme.muted}>
          Stacks
        </Text>
      </Box>
      <Box marginTop={1} flexGrow={1}>
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

export const overviewScreen: TuiScreen = {
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
