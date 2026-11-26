// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { TabId } from "../../types/index.js";
import { formatUiKeyHint } from "../../utils/ui-keymap.js";

/** Compose footer guidance for the current tab and terminal character set. */
export function createHelpHint(
  activeTab: TabId,
  selectedStack: string | null,
  selectedService: string | null,
  showEnabledOnly: boolean,
  ascii: boolean,
): string {
  const separator = ascii ? " | " : " │ ";
  const enabledHint = formatUiKeyHint(
    "toggle-enabled",
    showEnabledOnly ? "show all" : "enabled only",
    ascii,
  );
  const common = [enabledHint, formatUiKeyHint("help", "help", ascii)];
  const cycleTabs = formatUiKeyHint("cycle-tabs", "Tabs", ascii);

  if (activeTab === "overview") {
    const introduction = selectedStack
      ? `Stack "${selectedStack}" selected. ${formatUiKeyHint("select", "view", ascii)}`
      : formatUiKeyHint("list-navigation", "Navigate", ascii);
    const controls = selectedStack
      ? [formatUiKeyHint("back", "back", ascii), ...common]
      : [formatUiKeyHint("select", "Select", ascii), ...common];
    return [introduction, ...controls].join(separator);
  }
  if (activeTab === "resources") {
    return [
      cycleTabs,
      formatUiKeyHint("open-url", "open", ascii),
      formatUiKeyHint("copy-url", "copy", ascii),
      formatUiKeyHint("refresh", "Refresh", ascii),
      formatUiKeyHint("search", "Search", ascii),
      ...common,
    ].join(separator);
  }
  if (activeTab === "files" && selectedService) {
    return [`Service "${selectedService}"`, formatUiKeyHint("back", "Back", ascii), ...common].join(
      separator,
    );
  }
  if (activeTab === "files") {
    return ["Select service to view files", ...common].join(separator);
  }
  if (activeTab === "events") {
    return [
      formatUiKeyHint("refresh", "Refresh events", ascii),
      formatUiKeyHint("cycle-tabs", "Tabs", ascii),
      formatUiKeyHint("help", "help", ascii),
      formatUiKeyHint("quit", "Quit", ascii),
    ].join(separator);
  }
  if (activeTab === "config") {
    return ["View configurations", ...common].join(separator);
  }
  return [
    formatUiKeyHint("cycle-tabs", "Tabs", ascii),
    formatUiKeyHint("direct-tabs", "Tabs", ascii),
    ...common,
    formatUiKeyHint("quit", "Quit", ascii),
  ].join(separator);
}
