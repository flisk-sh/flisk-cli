// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import type React from "react";
import { sectionTitle, useTUITheme } from "../../../components/ui-theme.js";
import { ScreenSelectList } from "./select-list.js";
import type { TuiScreen, TuiScreenProps } from "./types.js";

const ConfigScreen: React.FC<TuiScreenProps> = ({ selectedServiceData, ...listProps }) => {
  const theme = useTUITheme();
  return (
    <>
      <Box marginBottom={1}>
        <Text bold color={theme.muted}>
          {sectionTitle(theme, "Configuration")}
        </Text>
      </Box>
      {selectedServiceData ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent}>{selectedServiceData.service.configPath}</Text>
          <Box
            marginTop={1}
            {...(theme.ascii ? {} : { borderStyle: "single" as const, borderColor: theme.border })}
            paddingX={1}
          >
            <Text color={theme.muted} wrap="wrap">
              {JSON.stringify(selectedServiceData.service.config, null, 2).slice(0, 1000)}
            </Text>
          </Box>
        </Box>
      ) : (
        <ScreenSelectList prompt="Select a service to view configuration" {...listProps} />
      )}
    </>
  );
};

export const configScreen: TuiScreen = {
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
