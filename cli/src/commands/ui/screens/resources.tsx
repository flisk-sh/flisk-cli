// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import type React from "react";
import { ResourceTable, ServiceIssues } from "../../../components/index.js";
import { sectionTitle, useTUITheme } from "../../../components/ui-theme.js";
import { ScreenSelectList } from "./select-list.js";
import type { TuiScreen, TuiScreenProps } from "./types.js";

const ResourcesScreen: React.FC<TuiScreenProps> = ({
  selectedStackData,
  terminalWidth,
  showSidebar,
  ...listProps
}) => {
  const theme = useTUITheme();
  return (
    <>
      <Box marginBottom={1}>
        <Text bold color={theme.muted}>
          {sectionTitle(theme, "Resources")}
        </Text>
      </Box>
      {selectedStackData ? (
        <>
          <Text color={theme.muted}>Stack: {selectedStackData.stack.name}</Text>
          <Box marginTop={1} flexDirection="column">
            <ResourceTable
              resources={selectedStackData.metadata.resources}
              maxWidth={terminalWidth - (showSidebar ? 50 : 10)}
            />
            <ServiceIssues resources={selectedStackData.metadata.resources} />
          </Box>
        </>
      ) : (
        <ScreenSelectList prompt="Select a stack to view resources" {...listProps} />
      )}
    </>
  );
};

export const resourcesScreen: TuiScreen = {
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
