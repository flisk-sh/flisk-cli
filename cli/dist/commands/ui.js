import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Command } from "commander";
import { Box, render, Text, useApp, useInput, useStdin, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DetailPanel, HelpPanel, TabBar, TUIHeader } from "../components/index.js";
import { TABS } from "../components/TabBar.js";
import { createTUITheme, TUIThemeContext, useTUITheme } from "../components/ui-theme.js";
import { fetchAgentOverview } from "../utils/agent-sessions.js";
import { clearDiscoveryCache } from "../utils/discovery-context.js";
import { errorFactories, requireProjectRoot } from "../utils/errors.js";
import { formatCount } from "../utils/formatting.js";
import { readSavedHostPortPlan } from "../utils/host-port-config.js";
import { findProjectRoot, getPackageVersion } from "../utils/paths.js";
import { isApiServiceType } from "../utils/resource-kind.js";
import { describeSearch } from "../utils/search-status.js";
import { buildAdvertisedTargets } from "../utils/service-urls.js";
import { clearMetadataCache, discoverResources, discoverStacks, getResourceMetadata, getStackMetadata, } from "../utils/services.js";
import { singleFlight } from "../utils/single-flight.js";
import { createStatusMessageController } from "../utils/status-message.js";
import { getListRowFromMouseY, getTerminalRuleWidth } from "../utils/terminal-layout.js";
import { isTiltAvailable } from "../utils/tilt.js";
import { loadTiltEvents, TiltEventsLoadError } from "../utils/tilt-events.js";
import { getTiltPollingPort } from "../utils/tilt-startup.js";
import { formatUiKeyHint } from "../utils/ui-keymap.js";
import { applyServiceStates, fetchTiltSnapshot, } from "../utils/ui-service-state.js";
import { copyToClipboard, openUrl } from "../utils/url-actions.js";
import { agentRouteOf } from "./ui/agent-route.js";
import { createHelpHint } from "./ui/help-hint.js";
import { TUI_SCREENS } from "./ui/screens/index.js";
export { agentRouteOf, createHelpHint };
function searchListForTab(activeTab, selectedStackData, selectedServiceData, stackCount, serviceCount) {
    if (activeTab === "overview" || (activeTab === "resources" && !selectedStackData)) {
        return { total: stackCount };
    }
    if ((activeTab === "files" && !selectedServiceData) || activeTab === "config") {
        return { total: serviceCount };
    }
    return null;
}
function resolveAgentDetail(agentRoute, selectedServiceData, agentOverview) {
    if (!agentRoute || !selectedServiceData)
        return undefined;
    return agentOverview?.name === agentRoute.name ? agentOverview.overview : null;
}
/** Footer filter badge text in ASCII or Unicode mode. */
export function enabledFilterLabel(showEnabledOnly, ascii) {
    if (showEnabledOnly)
        return ascii ? "[+] enabled" : "✓ enabled";
    return ascii ? "[*] all" : "○ all";
}
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ASCII_SPINNER_FRAMES = ["-", "/", "|", "\\"];
export const LoadingScreen = ({ message = "Discovering resources...", animated = true, }) => {
    const theme = useTUITheme();
    const spinnerFrames = theme.ascii ? ASCII_SPINNER_FRAMES : SPINNER_FRAMES;
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        if (!animated)
            return;
        const timer = setInterval(() => setFrame((f) => (f + 1) % spinnerFrames.length), 80);
        return () => clearInterval(timer);
    }, [animated, spinnerFrames.length]);
    return (_jsxs(Box, { flexDirection: "column", padding: 2, children: [_jsxs(Text, { bold: true, color: theme.accent, children: [theme.bannerStart, " Flisk NEON EDITION ", theme.bannerEnd] }), _jsx(Box, { marginY: 1 }), _jsxs(Text, { color: theme.foreground, children: [animated && _jsxs(Text, { color: theme.accent, children: [spinnerFrames[frame], " "] }), message] })] }));
};
// biome-ignore lint/correctness/noUnusedFunctionParameters: reserved callback prop kept in the component API
const ErrorScreen = ({ error, onRetry }) => {
    const theme = useTUITheme();
    return (_jsxs(Box, { flexDirection: "column", padding: 2, alignItems: "center", children: [_jsx(Text, { bold: true, color: theme.error, children: "Could Not Load Services" }), _jsx(Box, { marginY: 1 }), _jsxs(Text, { color: theme.error, children: [theme.ascii ? "[x]" : "✗", " ", error] }), _jsx(Box, { marginY: 1 }), _jsx(Text, { color: theme.muted, children: "Troubleshooting:" }), _jsx(Text, { color: theme.muted, children: " 1. Check that every service.json is valid JSON" }), _jsxs(Text, { color: theme.muted, children: [" ", "2. Run flisk from your project (the folder with the Tiltfile)"] }), _jsx(Text, { color: theme.muted, children: " 3. Try: flisk status --verbose" }), _jsx(Box, { marginY: 1 }), _jsx(Text, { color: theme.accent, children: "Press [r] to retry or [q] to quit" })] }));
};
export const TUIApp = ({ animated = true }) => {
    const theme = useTUITheme();
    const { exit } = useApp();
    const { stdout } = useStdout();
    const ttyStdout = stdout;
    const { stdin, setRawMode } = useStdin();
    const [activeTab, setActiveTab] = useState("overview");
    const [selectedStack, setSelectedStack] = useState(null);
    const [selectedService, setSelectedService] = useState(null);
    const [message, setMessage] = useState("");
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [showHelp, setShowHelp] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [isSearching, setIsSearching] = useState(false);
    const [terminalWidth, setTerminalWidth] = useState(ttyStdout.columns || 120);
    const [terminalRows, setTerminalRows] = useState(ttyStdout.rows || 24);
    const [selectedFile, setSelectedFile] = useState(null);
    const [mouseEnabled, setMouseEnabled] = useState(true);
    const [listTop, setListTop] = useState(null);
    const [listStart, setListStart] = useState(0);
    // Reserve the header, tab bar, hints and footer; keep the cursor visible.
    const pageSize = Math.max(1, terminalRows - 14);
    const handleListLayout = useCallback((top, firstVisible = 0) => {
        setListTop(top);
        setListStart(firstVisible);
    }, []);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showTooltips, setShowTooltips] = useState(true);
    const [showEnabledOnly, setShowEnabledOnly] = useState(true);
    const [eventSnapshot, setEventSnapshot] = useState(null);
    const [eventLoadState, setEventLoadState] = useState("idle");
    const [eventLoadError, setEventLoadError] = useState(null);
    const eventRequestRef = useRef(0);
    const statusMessage = useMemo(() => createStatusMessageController(setMessage), []);
    useEffect(() => () => statusMessage.dispose(), [statusMessage]);
    const projectRoot = findProjectRoot() || "unknown";
    const ingressPort = projectRoot === "unknown"
        ? undefined
        : (readSavedHostPortPlan(projectRoot)?.ingressHttp ?? undefined);
    const [{ stacks, services }, setDiscovered] = useState({ stacks: [], services: [] });
    // What the running Tilt says about each service: the same answer `flisk status` gives. Empty while no Tilt answers.
    const [serviceStates, setServiceStates] = useState({});
    const [tiltRunning, setTiltRunning] = useState(false);
    useEffect(() => {
        let cancelled = false;
        const tiltPort = getTiltPollingPort(process.env.TILT_PORT);
        // A Tilt call can outlast the 5 s interval; never start a poll while the last one is still running.
        const run = singleFlight((next) => {
            if (cancelled)
                return;
            setServiceStates((previous) => JSON.stringify(previous) === JSON.stringify(next.states) ? previous : next.states);
            setTiltRunning(next.running);
        });
        const poll = () => run(() => fetchTiltSnapshot(services, tiltPort));
        void poll();
        // The agent panel rides on this same timer: the selected agent is read once per tick, never one loop per agent.
        const timer = setInterval(() => {
            void poll();
            void agentPollRef.current();
        }, 5000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [services]);
    // Readiness and sessions of the selected agent resource, read from the agent itself through its ingress route.
    const [agentOverview, setAgentOverview] = useState(null);
    const agentRoute = useMemo(() => agentRouteOf(services, selectedService, ingressPort), [services, selectedService, ingressPort]);
    const agentPollRef = useRef(async () => { });
    useEffect(() => {
        if (!agentRoute) {
            agentPollRef.current = async () => { };
            setAgentOverview(null);
            return;
        }
        let cancelled = false;
        const run = singleFlight((overview) => {
            if (!cancelled)
                setAgentOverview({ name: agentRoute.name, overview });
        });
        agentPollRef.current = () => run(() => fetchAgentOverview(agentRoute.url));
        setAgentOverview(null);
        void agentPollRef.current();
        return () => {
            cancelled = true;
            agentPollRef.current = async () => { };
        };
    }, [agentRoute]);
    // Re-read service.json files from disk. An empty project is not an error:
    // it renders EmptyState. Only a failed discovery shows ErrorScreen.
    const refresh = useCallback(() => {
        clearMetadataCache();
        // A manual refresh promises fresh disk state, so the per-process discovery cache goes too.
        clearDiscoveryCache();
        try {
            setDiscovered({ stacks: discoverStacks(), services: discoverResources() });
            setError(null);
            return true;
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            return false;
        }
        finally {
            setLoading(false);
        }
    }, []);
    const refreshEvents = useCallback(async () => {
        const requestId = ++eventRequestRef.current;
        setEventLoadState("loading");
        setEventLoadError(null);
        try {
            const snapshot = await loadTiltEvents();
            if (requestId !== eventRequestRef.current)
                return;
            setEventSnapshot(snapshot);
            setEventLoadState("ready");
        }
        catch (error) {
            if (requestId !== eventRequestRef.current)
                return;
            setEventSnapshot(null);
            if (error instanceof TiltEventsLoadError && error.kind === "unavailable") {
                setEventLoadState("unavailable");
                return;
            }
            setEventLoadError(error instanceof Error ? error.message : String(error));
            setEventLoadState("error");
        }
    }, []);
    useEffect(() => {
        refresh();
    }, [refresh]);
    useEffect(() => {
        if (activeTab !== "events")
            return;
        void refreshEvents();
        return () => {
            eventRequestRef.current += 1;
        };
    }, [activeTab, refreshEvents]);
    const selectedStackData = useMemo(() => {
        if (!selectedStack)
            return null;
        const stack = stacks.find((s) => s.name === selectedStack);
        if (!stack)
            return null;
        return {
            stack,
            metadata: applyServiceStates(getStackMetadata(stack), serviceStates),
        };
    }, [selectedStack, stacks, serviceStates]);
    const selectedServiceData = useMemo(() => {
        if (!selectedService)
            return null;
        const service = services.find((s) => s.name === selectedService);
        if (!service)
            return null;
        return {
            service,
            metadata: getResourceMetadata(service),
        };
    }, [selectedService, services]);
    const filteredStacks = useMemo(() => {
        if (!searchQuery)
            return stacks;
        return stacks.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.resources.some((svc) => svc.name.toLowerCase().includes(searchQuery.toLowerCase())));
    }, [stacks, searchQuery]);
    const filteredServices = useMemo(() => {
        let filtered = services;
        if (showEnabledOnly) {
            filtered = filtered.filter((s) => s.config?.enabled !== false);
        }
        if (searchQuery) {
            filtered = filtered.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (s.stack || "").toLowerCase().includes(searchQuery.toLowerCase()));
        }
        return filtered;
    }, [services, searchQuery, showEnabledOnly]);
    const getItems = useCallback(() => {
        if (activeTab === "overview") {
            return filteredStacks.map((stack) => ({
                label: `${stack.name} (${formatCount(stack.resources.length, "resource")})`,
                value: stack.name,
            }));
        }
        if (activeTab === "resources") {
            if (selectedStackData) {
                return selectedStackData.stack.resources.map((s) => {
                    const stackLabel = s.stack && s.stack !== "unknown" ? ` [${s.stack}]` : "";
                    const enabledLabel = s.config?.enabled === false ? " [DISABLED]" : "";
                    return {
                        label: `${s.name}${stackLabel}${enabledLabel}`,
                        value: s.name,
                    };
                });
            }
            return filteredStacks.map((stack) => ({
                label: `${stack.name} (${formatCount(stack.resources.length, "resource")})`,
                value: stack.name,
            }));
        }
        if (activeTab === "files") {
            if (selectedServiceData) {
                return selectedServiceData.metadata.autogeneratedFiles.map((f) => ({
                    label: `${f.name} (${f.type})`,
                    value: f.path,
                }));
            }
            return filteredServices.map((s) => {
                const stackPrefix = s.stack && s.stack !== "unknown" ? `${s.stack}/` : "";
                const enabledLabel = s.config?.enabled === false ? " [DISABLED]" : "";
                return {
                    label: `${stackPrefix}${s.name}${enabledLabel}`,
                    value: s.name,
                };
            });
        }
        if (activeTab === "config") {
            return filteredServices.map((s) => {
                const stackPrefix = s.stack && s.stack !== "unknown" ? `${s.stack}/` : "";
                const stackLabel = s.stack ? ` [${s.stack}]` : "";
                const enabledLabel = s.config?.enabled === false ? " [DISABLED]" : "";
                return {
                    label: `${stackPrefix}${s.name}${stackLabel}${enabledLabel}`,
                    value: s.name,
                };
            });
        }
        return [];
    }, [activeTab, filteredStacks, filteredServices, selectedStackData, selectedServiceData]);
    const items = useMemo(getItems, [getItems]);
    const selectableListVisible = !loading &&
        !error &&
        !showHelp &&
        (activeTab === "overview" ||
            (activeTab === "resources" && !selectedStackData) ||
            (activeTab === "files" && !selectedServiceData) ||
            (activeTab === "config" && !selectedServiceData));
    // Only the stack and service lists are filtered by the query; drilled-in views are not.
    const searchList = searchListForTab(activeTab, selectedStackData, selectedServiceData, stacks.length, services.length);
    const searchStatus = searchList
        ? describeSearch(searchQuery, items.length, searchList.total)
        : null;
    useEffect(() => {
        if (highlightedIndex >= items.length && items.length > 0) {
            setHighlightedIndex(items.length - 1);
        }
        else if (items.length === 0) {
            setHighlightedIndex(0);
        }
    }, [highlightedIndex, items.length]);
    const handleSelect = useCallback((item) => {
        if (activeTab === "overview") {
            setSelectedStack(item.value);
            setSelectedService(null);
            statusMessage.show(`Selected stack: ${item.value}`, 2000);
        }
        else if (activeTab === "resources") {
            if (selectedStack && !selectedService) {
                setSelectedService(item.value);
                statusMessage.show(`Selected service: ${item.value}`, 2000);
            }
            else {
                setSelectedStack(item.value);
                setSelectedService(null);
            }
        }
        else if (activeTab === "files") {
            if (selectedService) {
                setSelectedFile(item.value);
                statusMessage.show(`Selected file: ${item.label}`, 2000);
            }
            else {
                setSelectedService(item.value);
                statusMessage.show(`Selected service: ${item.value}`, 2000);
            }
        }
        else if (activeTab === "config") {
            setSelectedService(item.value);
            statusMessage.show(`Viewing config for: ${item.value}`, 2000);
        }
    }, [activeTab, selectedStack, selectedService, statusMessage]);
    const resolveCurrentResource = useCallback(() => {
        if (selectedService) {
            return services.find((s) => s.name === selectedService) ?? null;
        }
        const currentItem = items[highlightedIndex];
        if (currentItem) {
            const directService = services.find((s) => s.name === currentItem.value);
            if (directService) {
                return directService;
            }
            const stack = stacks.find((st) => st.name === currentItem.value);
            if (stack && stack.resources.length > 0) {
                const frontend = stack.resources.find((s) => s.config?.appType === "frontend");
                if (frontend)
                    return frontend;
                const api = stack.resources.find((s) => isApiServiceType(s.config?.appType));
                if (api)
                    return api;
                return stack.resources[0] ?? null;
            }
        }
        if (selectedStackData && selectedStackData.stack.resources.length > 0) {
            const frontend = selectedStackData.stack.resources.find((s) => s.config?.appType === "frontend");
            if (frontend)
                return frontend;
            const api = selectedStackData.stack.resources.find((s) => isApiServiceType(s.config?.appType));
            if (api)
                return api;
            return selectedStackData.stack.resources[0] ?? null;
        }
        return null;
    }, [selectedService, items, highlightedIndex, services, stacks, selectedStackData]);
    useEffect(() => {
        setRawMode(true);
        stdout.write("\x1b[?1000h");
        stdout.write("\x1b[?1006h");
        return () => {
            setRawMode(false);
            stdout.write("\x1b[?1000l");
            stdout.write("\x1b[?1006l");
        };
    }, [setRawMode, stdout]);
    useEffect(() => {
        if (!mouseEnabled)
            return;
        const handleMouseData = (data) => {
            const str = data.toString();
            // Parse SGR 1006 mouse protocol: ESC[<btn;x;yM or ESC[<btn;x;ym
            // biome-ignore lint/suspicious/noControlCharactersInRegex: \\x1b ESC is intentional (ANSI SGR/CSI sequence parsing)
            const sgrMatch = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
            const btnText = sgrMatch?.[1];
            const yText = sgrMatch?.[3];
            const action = sgrMatch?.[4];
            if (btnText !== undefined && yText !== undefined && action !== undefined) {
                const btn = parseInt(btnText, 10);
                const y = parseInt(yText, 10);
                const release = action === "m";
                // Check if it's a left click (btn & 0b11 == 0 means left button)
                const isLeftClick = (btn & 0b11) === 0;
                if (isLeftClick && !release) {
                    const listRow = selectableListVisible && listTop !== null ? getListRowFromMouseY(y, listTop) : -1;
                    const itemIndex = listStart + listRow;
                    if (listRow >= 0 && listRow < pageSize && itemIndex < items.length) {
                        setHighlightedIndex(itemIndex);
                        const item = items[itemIndex];
                        if (item) {
                            handleSelect(item);
                        }
                    }
                }
                return;
            }
        };
        stdin.on("data", handleMouseData);
        return () => {
            stdin.off("data", handleMouseData);
            stdin.removeAllListeners("data");
        };
    }, [
        stdin,
        items,
        listTop,
        listStart,
        pageSize,
        selectableListVisible,
        mouseEnabled,
        handleSelect,
    ]);
    const handleResize = useCallback(() => {
        const tty = stdout;
        setTerminalWidth(tty.columns || 120);
        setTerminalRows(tty.rows || 24);
    }, [stdout]);
    useEffect(() => {
        stdout.on("resize", handleResize);
        return () => {
            stdout.off("resize", handleResize);
        };
    }, [stdout, handleResize]);
    // Keep this dispatcher in sync with UI_KEYMAP; the shared map drives the help panel and footer.
    useInput((input, key) => {
        if (error) {
            if (input === "r" || input === "R") {
                refresh();
                return;
            }
            if (input === "q" || key.escape) {
                exit();
                return;
            }
            return;
        }
        if (showHelp) {
            setShowHelp(false);
            return;
        }
        if (isSearching) {
            if (key.return) {
                setIsSearching(false);
                return;
            }
            if (key.escape) {
                setIsSearching(false);
                setSearchQuery("");
                return;
            }
            if (key.backspace || key.delete) {
                setSearchQuery((prev) => prev.slice(0, -1));
                return;
            }
            if (input && !key.ctrl && !key.meta) {
                setSearchQuery((prev) => prev + input);
                return;
            }
            return;
        }
        if (input === "q" && !key.ctrl && !key.meta) {
            exit();
            return;
        }
        if (key.escape) {
            if (selectedFile) {
                setSelectedFile(null);
                return;
            }
            if (selectedService) {
                setSelectedService(null);
                return;
            }
            if (selectedStack) {
                setSelectedStack(null);
                return;
            }
            statusMessage.show("Press q to quit", 2000);
            return;
        }
        if (input === "?") {
            setShowHelp(true);
            return;
        }
        if (input === "r") {
            if (activeTab === "events") {
                void refreshEvents();
            }
            else if (refresh()) {
                statusMessage.show("Data refreshed", 1500);
            }
            return;
        }
        if (input === "/") {
            setIsSearching(true);
            setSearchQuery("");
            setMessage("Search: ");
            return;
        }
        if (input === "m") {
            setMouseEnabled((prev) => {
                const newState = !prev;
                statusMessage.show(newState ? "Mouse support enabled" : "Mouse support disabled");
                return newState;
            });
            return;
        }
        if (input === "t") {
            setShowTooltips((prev) => {
                const newState = !prev;
                statusMessage.show(newState ? "Tooltips enabled" : "Tooltips disabled");
                return newState;
            });
            return;
        }
        if (input === "e") {
            setShowEnabledOnly((prev) => {
                const newState = !prev;
                statusMessage.show(newState ? "Showing enabled services only" : "Showing all services (including disabled)", 1500);
                return newState;
            });
            return;
        }
        if (input === "o") {
            const resource = resolveCurrentResource();
            const target = resource ? buildAdvertisedTargets([resource], ingressPort)[0] : undefined;
            if (!target?.url) {
                statusMessage.show("No URL for this resource", 2000);
            }
            else {
                void openUrl(target.url).then((opened) => {
                    statusMessage.show(opened ? `Opening ${target.url}` : `Failed to open ${target.url}`, 2000);
                });
            }
            return;
        }
        if (input === "y") {
            const resource = resolveCurrentResource();
            const target = resource ? buildAdvertisedTargets([resource], ingressPort)[0] : undefined;
            if (!target?.url) {
                statusMessage.show("No URL for this resource", 2000);
            }
            else {
                void copyToClipboard(target.url).then((copied) => {
                    if (copied) {
                        statusMessage.show(`Copied ${target.url}`, 2000);
                    }
                    else {
                        statusMessage.show(`Failed to copy ${target.url}`, 2000);
                    }
                });
            }
            return;
        }
        if (key.tab) {
            const tabs = TABS.map((tab) => tab.id);
            const currentIdx = tabs.indexOf(activeTab);
            const nextIdx = key.shift
                ? (currentIdx - 1 + tabs.length) % tabs.length
                : (currentIdx + 1) % tabs.length;
            setActiveTab(tabs[nextIdx]);
            return;
        }
        const shortcutTab = TABS.find((tab) => tab.shortcut === input);
        if (shortcutTab) {
            setActiveTab(shortcutTab.id);
            return;
        }
        const plainKey = !key.ctrl && !key.meta;
        if (items.length > 0 && (key.upArrow || (plainKey && input === "k"))) {
            setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
        }
        if (items.length > 0 && (key.downArrow || (plainKey && input === "j"))) {
            setHighlightedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
        }
        if (key.home || (plainKey && input === "g"))
            setHighlightedIndex(0);
        if (key.end || (plainKey && input === "G"))
            setHighlightedIndex(Math.max(0, items.length - 1));
        if (key.pageUp)
            setHighlightedIndex((prev) => Math.max(0, prev - pageSize));
        if (key.pageDown)
            setHighlightedIndex((prev) => Math.min(Math.max(0, items.length - 1), prev + pageSize));
        if (key.return || input === " ") {
            const currentItem = items[highlightedIndex];
            if (currentItem) {
                handleSelect(currentItem);
            }
            return;
        }
    });
    const showSidebar = terminalWidth > 100;
    const mainPanelWidth = showSidebar ? terminalWidth - 45 : terminalWidth - 4;
    if (loading) {
        return _jsx(LoadingScreen, { message: "Discovering resources...", animated: animated });
    }
    if (error) {
        return _jsx(ErrorScreen, { error: error, onRetry: refresh });
    }
    const header = (_jsxs(_Fragment, { children: [_jsx(TUIHeader, { projectRoot: projectRoot, resourceCount: services.length, terminalWidth: terminalWidth, version: getPackageVersion(), tiltStatus: tiltRunning ? "running" : "stopped" }), _jsx(Box, { paddingX: 1, children: _jsx(Text, { color: theme.muted, children: (theme.ascii ? "-" : "─").repeat(getTerminalRuleWidth(terminalWidth)) }) })] }));
    const ScreenComponent = TUI_SCREENS[activeTab].Component;
    const screenProps = {
        items,
        onSelect: handleSelect,
        highlightedIndex,
        isActive: !isSearching,
        pageSize,
        width: mainPanelWidth,
        onLayout: handleListLayout,
        services,
        message,
        selectedFile,
        selectedStackData,
        selectedServiceData,
        terminalWidth,
        showSidebar,
        eventLoadState,
        eventLoadError,
        eventSnapshot,
    };
    return (_jsxs(Box, { flexDirection: "column", height: ttyStdout.rows || 24, children: [header, isSearching && (_jsxs(Box, { paddingX: 1, height: 1, children: [_jsxs(Text, { color: theme.warning, children: ["Search: ", searchQuery, "_"] }), searchStatus && (_jsx(Text, { color: theme.muted, dimColor: theme.dimMuted, bold: theme.boldMuted, children: `   ${searchStatus.summary}` }))] })), searchStatus?.emptyMessage && (_jsx(Box, { paddingX: 1, height: 1, children: _jsx(Text, { color: theme.muted, children: searchStatus.emptyMessage }) })), !isSearching && message && (_jsx(Box, { paddingX: 1, height: 1, children: _jsxs(Text, { color: theme.accent, children: [theme.bannerStart, " ", message, " ", theme.bannerEnd] }) })), !isSearching && !message && showTooltips && !showHelp && (_jsx(Box, { paddingX: 1, height: 1, children: _jsx(Text, { color: theme.muted, dimColor: theme.dimMuted, bold: theme.boldMuted, children: createHelpHint(activeTab, selectedStack, selectedService, showEnabledOnly, theme.ascii) }) })), showHelp && (_jsx(Box, { paddingX: 1, flexGrow: 1, alignItems: "center", justifyContent: "center", children: _jsx(HelpPanel, { activeTab: activeTab, onClose: () => setShowHelp(false) }) })), !showHelp && (_jsxs(_Fragment, { children: [_jsx(Box, { marginTop: 1, children: _jsx(TabBar, { activeTab: activeTab, onTabChange: setActiveTab, terminalWidth: terminalWidth }) }), _jsxs(Box, { flexDirection: "row", paddingX: 1, flexGrow: 1, children: [_jsx(Box, { flexDirection: "column", flexGrow: 1, width: mainPanelWidth, children: _jsx(ScreenComponent, { ...screenProps }) }), showSidebar && (_jsx(Box, { marginLeft: 2, children: _jsx(DetailPanel, { stack: selectedStackData?.stack || null, service: selectedServiceData?.service || null, stackMetadata: selectedStackData?.metadata || null, agent: resolveAgentDetail(agentRoute, selectedServiceData, agentOverview), visible: !!selectedStack || !!selectedService }) }))] }), _jsxs(Box, { ...(theme.ascii ? {} : { borderStyle: "single", borderColor: theme.border }), paddingX: 1, height: 3, flexDirection: "column", marginTop: 1, children: [_jsxs(Box, { justifyContent: "space-between", children: [_jsxs(Text, { color: theme.accent, bold: true, children: [theme.bannerStart, " ", activeTab] }), _jsxs(Text, { color: theme.success, children: [theme.ascii ? "[+]" : "●", " ", services.filter((s) => s.stack).length, " in stack"] }), _jsxs(Text, { color: theme.warning, children: [theme.ascii ? "[-]" : "○", " ", services.filter((s) => !s.stack).length, " no stack"] })] }), _jsxs(Box, { justifyContent: "space-between", children: [_jsxs(Text, { color: theme.muted, children: ["Stacks: ", stacks.length] }), _jsxs(Text, { color: theme.muted, children: ["Services: ", services.length] }), _jsxs(Text, { color: theme.muted, children: [theme.ascii ? "Mouse" : "🖱️", " ", mouseEnabled ? "ON" : "OFF", theme.separator, theme.ascii ? "Info" : "ℹ️", " ", showTooltips ? "ON" : "OFF", theme.separator, _jsx(Text, { color: showEnabledOnly ? theme.success : theme.warning, children: enabledFilterLabel(showEnabledOnly, theme.ascii) }), theme.separator, formatUiKeyHint("help", "Help", theme.ascii), theme.separator, formatUiKeyHint("quit", "Quit", theme.ascii)] })] })] })] }))] }));
};
const TUIRoot = ({ animated, highContrast, }) => (_jsx(TUIThemeContext.Provider, { value: createTUITheme(Boolean(highContrast)), children: _jsx(TUIApp, { animated: animated }) }));
export const uiCommand = new Command("ui")
    .description("Terminal dashboard to watch and manage your stacks and services")
    .alias("interactive")
    .option("-v, --verbose", "Enable verbose output", false)
    .option("--no-animations", "Disable animations")
    .option("--high-contrast", "Enable high contrast mode")
    .addHelpText("after", "\nExamples:\n  flisk ui\n  flisk ui --high-contrast\n  flisk ui --no-animations")
    .action(async (options) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        errorFactories.interactiveTerminalRequired("flisk ui").exit();
    }
    const tiltAvailable = await isTiltAvailable();
    if (!tiltAvailable) {
        errorFactories.tiltNotInstalled().exit();
    }
    requireProjectRoot();
    // The app has no Static content, so its live layout starts at row 1 in the alternate screen.
    render(_jsx(TUIRoot, { animated: options.animations, highContrast: options.highContrast }), {
        alternateScreen: true,
    });
});
