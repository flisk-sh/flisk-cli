// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type {
  BaseTooltipProps,
  DetailPanelProps,
  ErrorScreenProps,
  FileTreeProps,
  HelpPanelProps,
  LoadingScreenProps,
  ResourceSelectInputProps,
  ResourceTableProps,
  SelectItem,
  Tab,
  TabBarProps,
  TabId,
  TooltipProps,
} from "../ui.js";

describe("TUI prop types", () => {
  it("types a tab and its bar", () => {
    const id: TabId = "resources";
    const tab: Tab = { id, label: "Resources", shortcut: "2" };
    const bar: TabBarProps = {
      activeTab: tab.id,
      onTabChange: (next: TabId) => next,
      terminalWidth: 120,
    };
    expect(bar.activeTab).toBe("resources");
    expect(tab.shortcut).toBe("2");
  });

  it("aliases TooltipProps to BaseTooltipProps", () => {
    const tooltip: TooltipProps = {
      content: "help",
      visible: true,
      wrapText: true,
    } satisfies BaseTooltipProps;
    expect(tooltip.visible).toBe(true);
  });

  it("shapes the detail panel's nullable selections", () => {
    const panel: DetailPanelProps = {
      stack: null,
      service: null,
      stackMetadata: null,
      agent: undefined,
      visible: false,
    };
    expect(panel.service).toBeNull();
  });

  it("shapes the table, select input and remaining screens", () => {
    const item: SelectItem = { label: "api", value: "api" };
    const select: ResourceSelectInputProps = {
      items: [item],
      onSelect: (picked: SelectItem) => picked,
      highlightedIndex: 0,
      width: 40,
    };
    const table: ResourceTableProps = { resources: [], maxWidth: 80 };
    const tree: FileTreeProps = { nodes: [] };
    const loading: LoadingScreenProps = { message: "loading", animated: false };
    const error: ErrorScreenProps = { error: "boom", onRetry: () => {} };
    const help: HelpPanelProps = { onClose: () => {}, activeTab: "overview" };
    expect(select.items).toEqual([item]);
    expect(table.resources).toHaveLength(0);
    expect(tree.nodes).toHaveLength(0);
    expect(loading.animated).toBe(false);
    expect(error.error).toBe("boom");
    expect(help.activeTab).toBe("overview");
  });
});
