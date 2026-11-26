// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { AgentOverview } from "../utils/agent-sessions.js";
import type { DiscoveredResource, DiscoveredStack } from "./discovery.js";
import type { FileNode } from "./files.js";
import type { ResourceMetadata, StackMetadata } from "./status.js";

export type TabId = "overview" | "resources" | "events" | "files" | "config";

export interface Tab {
  id: TabId;
  label: string;
  shortcut: string;
}

export interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  /** Retained for callers using the original fixed-width layout. */
  compact?: boolean;
  /** Enables the responsive layout when provided. */
  terminalWidth?: number;
}

export interface BaseTooltipProps {
  content: string;
  shortcut?: string;
  visible: boolean;
  maxWidth?: number;
  wrapText?: boolean;
  prefix?: string;
  marginTop?: number;
}

// Reuse BaseTooltipProps instead of duplicating
export type TooltipProps = BaseTooltipProps;

export interface DetailPanelProps {
  stack: DiscoveredStack | null;
  service: DiscoveredResource | null;
  stackMetadata?: StackMetadata | null;
  /** Live readiness and sessions of the selected service when it is an agent; undefined for other services. */
  agent?: AgentOverview | null;
  visible: boolean;
}

export interface ResourceTableProps {
  resources: ResourceMetadata[];
  maxWidth?: number;
}

export interface SelectItem {
  label: string;
  value: string;
}

export interface ResourceSelectInputProps {
  isActive?: boolean;
  maxVisibleItems?: number;
  items: SelectItem[];
  onSelect: (item: SelectItem) => void;
  highlightedIndex: number;
  width: number;
  onLayout?: (listTop: number, firstVisibleItem?: number) => void;
}

export interface FileTreeProps {
  nodes: FileNode[];
  onSelect?: (node: FileNode) => void;
  selectedPath?: string;
}

export interface LoadingScreenProps {
  message?: string;
  /** Show the spinner; false renders static text (`--no-animations`). */
  animated?: boolean;
}

export interface ErrorScreenProps {
  error: string;
  onRetry: () => void;
}

export interface HelpPanelProps {
  onClose: () => void;
  activeTab?: TabId;
}
