// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Box, Text } from "ink";
import type React from "react";
import { sectionTitle, useTUITheme } from "../../../components/ui-theme.js";
import type { TiltResourceSummary } from "../../../utils/tilt-events.js";
import { stripTerminalControls } from "../../../utils/tilt-events.js";
import type { TuiScreen, TuiScreenProps } from "./types.js";

function formatResourceStatus(resource: TiltResourceSummary): string {
  const statuses: string[] = [];
  if (resource.runtimeStatus) statuses.push(`Runtime ${resource.runtimeStatus}`);
  if (resource.updateStatus) statuses.push(`Update ${resource.updateStatus}`);
  if (resource.hasPendingChanges) statuses.push("Changes pending");
  return statuses.join("; ") || "No status reported";
}

function formatEventTime(value?: string): string {
  if (!value) return "Current";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value.slice(0, 20)
    : date
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, "Z");
}

function formatEventDetails(value: string, width: number): string {
  const normalized = stripTerminalControls(value).replace(/\s+/g, " ").trim();
  const suffix = "...";
  const maxLength = Math.max(suffix.length + 8, Math.floor(width) - 2);
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength - suffix.length).trimEnd() + suffix
    : normalized;
}

const EventsScreen: React.FC<TuiScreenProps> = ({
  eventLoadState,
  eventLoadError,
  eventSnapshot,
  width,
}) => {
  const theme = useTUITheme();
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.muted}>
          {sectionTitle(theme, "Event Timeline")}
        </Text>
      </Box>
      {(eventLoadState === "idle" || eventLoadState === "loading") && (
        <Text color={theme.muted}>Loading Tilt events...</Text>
      )}
      {eventLoadState === "unavailable" && (
        <Box flexDirection="column">
          <Text color={theme.warning}>Tilt is not running or its UI is unreachable.</Text>
          <Text color={theme.muted}>Start the stack with flisk up, then press [r] to retry.</Text>
        </Box>
      )}
      {eventLoadState === "error" && (
        <Box flexDirection="column">
          <Text color={theme.error}>Could not load Tilt events.</Text>
          <Text color={theme.muted}>
            {formatEventDetails(eventLoadError ?? "Unknown Tilt error", width)}
          </Text>
          <Text color={theme.muted}>Press [r] to retry.</Text>
        </Box>
      )}
      {eventLoadState === "ready" && (
        <>
          {eventSnapshot && eventSnapshot.resources.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color={theme.muted}>
                Current resources
              </Text>
              {eventSnapshot.resources.slice(0, 12).map((resource) => {
                const resIcon =
                  resource.runtimeStatus === "ok"
                    ? theme.ascii
                      ? "[+] "
                      : "✓ "
                    : resource.runtimeStatus === "error"
                      ? theme.ascii
                        ? "[x] "
                        : "✗ "
                      : theme.ascii
                        ? "[~] "
                        : "○ ";
                return (
                  <Text key={resource.name} color={theme.accent}>
                    {resIcon}
                    {resource.name}: {formatResourceStatus(resource)}
                  </Text>
                );
              })}
              {eventSnapshot.resources.length > 12 && (
                <Text color={theme.muted}>Showing first 12 resources</Text>
              )}
            </Box>
          )}
          <Text bold color={theme.muted}>
            Recent events
          </Text>
          {eventSnapshot && eventSnapshot.events.length > 20 && (
            <Text color={theme.muted}>Showing first 20 events</Text>
          )}
          {eventSnapshot?.events.length ? (
            <Box flexDirection="column" marginTop={1}>
              {eventSnapshot.events.slice(0, 20).map((event) => {
                const eventBadge =
                  event.kind === "failed"
                    ? theme.ascii
                      ? "[x] FAIL "
                      : "✗ FAIL "
                    : event.kind === "warning"
                      ? theme.ascii
                        ? "[~] WARN "
                        : "○ WARN "
                      : event.kind === "running"
                        ? theme.ascii
                          ? "[>] RUN  "
                          : "▶ RUN  "
                        : theme.ascii
                          ? "[+] OK   "
                          : "✓ OK   ";
                return (
                  <Box key={event.id} flexDirection="column" marginBottom={1}>
                    <Text
                      color={
                        event.kind === "failed"
                          ? theme.error
                          : event.kind === "warning"
                            ? theme.warning
                            : event.kind === "running"
                              ? theme.info
                              : theme.success
                      }
                    >
                      {eventBadge}
                      {formatEventTime(event.occurredAt)} {event.resourceName} {event.title}
                    </Text>
                    {event.details && (
                      <Text color={theme.muted}>{formatEventDetails(event.details, width)}</Text>
                    )}
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Text color={theme.muted}>No recent build events are available from Tilt yet.</Text>
          )}
        </>
      )}
    </Box>
  );
};

export const eventsScreen: TuiScreen = {
  name: "events",
  deps: ["eventLoadState", "eventLoadError", "eventSnapshot", "width"],
  Component: EventsScreen,
};
