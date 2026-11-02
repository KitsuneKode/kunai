import type { Container } from "@/container";
import type { ProviderLane } from "@/domain/types";
import { Box, Text, useInput } from "ink";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { MouseTarget } from "../mouse/MouseRegions";
import { palette } from "../shell-theme";
import {
  buildProviderStatusMatrix,
  probeSingleProvider,
  type ProviderStatusEntry,
  type ProviderStatusMatrix,
  type ProviderStatusTab,
} from "./provider-status-model";

const TAB_ORDER: readonly { id: ProviderStatusTab; label: string; shortcut: string }[] = [
  { id: "all", label: "All Providers", shortcut: "1" },
  { id: "movie", label: "Movies & Series", shortcut: "2" },
  { id: "anime", label: "Anime", shortcut: "3" },
  { id: "youtube", label: "YouTube", shortcut: "4" },
];

export interface ProviderStatusSheetProps {
  readonly container: Container;
  readonly initialLane?: ProviderLane;
  readonly onClose: () => void;
  readonly width?: number;
}

export function ProviderStatusSheet({
  container,
  initialLane,
  onClose,
  width = 96,
}: ProviderStatusSheetProps) {
  const initialTab: ProviderStatusTab =
    initialLane === "anime"
      ? "anime"
      : initialLane === "youtube"
        ? "youtube"
        : initialLane === "series"
          ? "movie"
          : "all";

  const [activeTab, setActiveTab] = useState<ProviderStatusTab>(initialTab);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [probingIds, setProbingIds] = useState<ReadonlySet<string>>(new Set());
  const [liveOverrides, setLiveOverrides] = useState<Map<string, Partial<ProviderStatusEntry>>>(
    new Map(),
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const matrix: ProviderStatusMatrix = useMemo(() => {
    return buildProviderStatusMatrix(container, liveOverrides);
  }, [container, liveOverrides]);

  const filteredEntries = useMemo(() => {
    if (activeTab === "all") return matrix.entries;
    if (activeTab === "movie") return matrix.entries.filter((e) => e.lane === "series");
    if (activeTab === "anime") return matrix.entries.filter((e) => e.lane === "anime");
    if (activeTab === "youtube") return matrix.entries.filter((e) => e.lane === "youtube");
    return matrix.entries;
  }, [matrix.entries, activeTab]);

  // Clamp selection when tab changes
  useEffect(() => {
    setSelectedIndex((prev) => Math.max(0, Math.min(prev, filteredEntries.length - 1)));
  }, [filteredEntries.length]);

  const selectedEntry = filteredEntries[selectedIndex] ?? filteredEntries[0];

  const handleProbe = useCallback(
    async (targetId?: string) => {
      const idToProbe = targetId ?? selectedEntry?.id;
      if (!idToProbe) return;

      setProbingIds((prev) => new Set([...prev, idToProbe]));
      setLiveOverrides((prev) => {
        const next = new Map(prev);
        next.set(idToProbe, { status: "probing", evidence: "Probing live endpoint..." });
        return next;
      });

      setStatusMessage(`Probing ${idToProbe}...`);

      const result = await probeSingleProvider(idToProbe, container);

      setProbingIds((prev) => {
        const next = new Set(prev);
        next.delete(idToProbe);
        return next;
      });

      setLiveOverrides((prev) => {
        const next = new Map(prev);
        next.set(idToProbe, {
          status: result.status,
          latencyMs: result.latencyMs,
          httpStatus: result.httpStatus,
          evidence: result.evidence,
          checkedAt: new Date().toISOString(),
        });
        return next;
      });

      setStatusMessage(
        `Probed ${idToProbe}: ${result.status.toUpperCase()} (${result.latencyMs}ms)`,
      );
    },
    [container, selectedEntry?.id],
  );

  const handleProbeAll = useCallback(async () => {
    const ids = filteredEntries.map((e) => e.id);
    if (ids.length === 0) return;

    setStatusMessage(`Probing all ${ids.length} providers...`);
    setProbingIds(new Set(ids));

    for (const id of ids) {
      setLiveOverrides((prev) => {
        const next = new Map(prev);
        next.set(id, { status: "probing", evidence: "Probing..." });
        return next;
      });
    }

    // Run probes with bounded concurrency of 3
    const queue = [...ids];
    const workers = Array.from({ length: 3 }, async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        if (!id) break;
        const res = await probeSingleProvider(id, container);
        setProbingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setLiveOverrides((prev) => {
          const next = new Map(prev);
          next.set(id, {
            status: res.status,
            latencyMs: res.latencyMs,
            httpStatus: res.httpStatus,
            evidence: res.evidence,
            checkedAt: new Date().toISOString(),
          });
          return next;
        });
      }
    });

    await Promise.all(workers);
    setStatusMessage(`Completed live probe of ${ids.length} providers.`);
  }, [container, filteredEntries]);

  const handleToggleDisabled = useCallback(async () => {
    if (!selectedEntry) return;
    const rawConfig = container.config.getRaw();
    const currentDisabled = new Set(rawConfig.disabledProviders ?? []);

    if (currentDisabled.has(selectedEntry.id)) {
      currentDisabled.delete(selectedEntry.id);
      setStatusMessage(`Enabled ${selectedEntry.name}`);
    } else {
      currentDisabled.add(selectedEntry.id);
      setStatusMessage(`Disabled ${selectedEntry.name}`);
    }

    await container.config.update({ disabledProviders: Array.from(currentDisabled) });
    setLiveOverrides((prev) => new Map(prev)); // trigger refresh
  }, [container, selectedEntry]);

  const handleSetActive = useCallback(async () => {
    if (!selectedEntry || selectedEntry.disabled) return;
    const lane = selectedEntry.lane;

    if (lane === "anime") {
      await container.config.update({ animeProvider: selectedEntry.id });
    } else if (lane === "youtube") {
      await container.config.update({ youtubeProvider: selectedEntry.id });
    } else {
      await container.config.update({ provider: selectedEntry.id });
    }

    container.stateManager.dispatch({ type: "SET_PROVIDER", provider: selectedEntry.id });
    setStatusMessage(`Set ${selectedEntry.name} as active provider for ${lane}`);
  }, [container, selectedEntry]);

  const handleResetHealth = useCallback(async () => {
    container.providerHealth.clearAll();
    setLiveOverrides(new Map());
    setStatusMessage("Cleared provider health statistics.");
  }, [container]);

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onClose();
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredEntries.length - 1));
      return;
    }

    if (key.downArrow || input === "j") {
      setSelectedIndex((prev) => (prev < filteredEntries.length - 1 ? prev + 1 : 0));
      return;
    }

    if (key.leftArrow || input === "h") {
      const currentIndex = TAB_ORDER.findIndex((t) => t.id === activeTab);
      const nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
      setActiveTab(TAB_ORDER[nextIndex]?.id ?? "all");
      return;
    }

    if (key.rightArrow || input === "l" || key.tab) {
      const currentIndex = TAB_ORDER.findIndex((t) => t.id === activeTab);
      const nextIndex = (currentIndex + 1) % TAB_ORDER.length;
      setActiveTab(TAB_ORDER[nextIndex]?.id ?? "all");
      return;
    }

    if (input === "1") setActiveTab("all");
    if (input === "2") setActiveTab("movie");
    if (input === "3") setActiveTab("anime");
    if (input === "4") setActiveTab("youtube");

    if (input === "p") {
      void handleProbe();
      return;
    }

    if (input === "P") {
      void handleProbeAll();
      return;
    }

    if (key.return) {
      void handleSetActive();
      return;
    }

    if (input === "t") {
      void handleToggleDisabled();
      return;
    }

    if (input === "r") {
      void handleResetHealth();
      return;
    }
  });

  const contentWidth = Math.max(76, Math.min(width, 110));

  return (
    <Box
      flexDirection="column"
      width={contentWidth}
      borderStyle="round"
      borderColor={palette.line}
      paddingX={1}
      paddingY={0}
    >
      {/* Header bar */}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexDirection="row" gap={1}>
          <Text bold color={palette.accent}>
            ◈ Global Provider Status
          </Text>
          <Text color={palette.dim}>|</Text>
          <Text color={palette.muted}>
            {matrix.totalCount} providers ·{" "}
            <Text color={palette.ok}>{matrix.healthyCount} ready</Text>
            {matrix.degradedCount > 0 ? (
              <Text color={palette.warn}> · {matrix.degradedCount} degraded</Text>
            ) : null}
            {matrix.downCount > 0 ? (
              <Text color={palette.danger}> · {matrix.downCount} offline</Text>
            ) : null}
            {matrix.disabledCount > 0 ? (
              <Text color={palette.dim}> · {matrix.disabledCount} off</Text>
            ) : null}
          </Text>
        </Box>
        {probingIds.size > 0 ? (
          <Text color={palette.accent}>
            ◌ Probing {probingIds.size} provider{probingIds.size > 1 ? "s" : ""}...
          </Text>
        ) : (
          <Text color={palette.dim}>[Esc] Close</Text>
        )}
      </Box>

      {/* Tabs */}
      <Box flexDirection="row" gap={1} marginTop={1} marginBottom={1}>
        {TAB_ORDER.map((tab) => {
          const isActive = tab.id === activeTab;
          const count =
            tab.id === "all"
              ? matrix.totalCount
              : tab.id === "movie"
                ? matrix.entries.filter((e) => e.lane === "series").length
                : tab.id === "anime"
                  ? matrix.entries.filter((e) => e.lane === "anime").length
                  : matrix.entries.filter((e) => e.lane === "youtube").length;

          return (
            <MouseTarget
              key={tab.id}
              id={`provider-tab:${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Box
                paddingX={1}
                borderStyle={isActive ? "bold" : "single"}
                borderColor={isActive ? palette.accent : palette.line}
              >
                <Text bold={isActive} color={isActive ? palette.text : palette.muted}>
                  [{tab.shortcut}] {tab.label} ({count})
                </Text>
              </Box>
            </MouseTarget>
          );
        })}
      </Box>

      {/* Table Header */}
      <Box flexDirection="row" borderStyle="single" borderColor={palette.dim} paddingX={1}>
        <Box width={14}>
          <Text bold color={palette.dim}>
            STATUS
          </Text>
        </Box>
        <Box width={22}>
          <Text bold color={palette.dim}>
            PROVIDER
          </Text>
        </Box>
        <Box width={10}>
          <Text bold color={palette.dim}>
            LANE
          </Text>
        </Box>
        <Box width={11}>
          <Text bold color={palette.dim}>
            LATENCY
          </Text>
        </Box>
        <Box width={16}>
          <Text bold color={palette.dim}>
            CAPABILITIES
          </Text>
        </Box>
        <Box flexGrow={1}>
          <Text bold color={palette.dim}>
            EVIDENCE & REACHABILITY
          </Text>
        </Box>
      </Box>

      {/* Rows */}
      <Box flexDirection="column">
        {filteredEntries.map((entry, index) => {
          const isSelected = index === selectedIndex;
          const isProbing = probingIds.has(entry.id) || entry.status === "probing";

          let statusIcon = "● Ready";
          let statusColor = palette.ok;
          if (entry.disabled) {
            statusIcon = "○ Disabled";
            statusColor = palette.dim;
          } else if (isProbing) {
            statusIcon = "◌ Probing";
            statusColor = palette.accent;
          } else if (entry.status === "degraded") {
            statusIcon = "▲ Degraded";
            statusColor = palette.warn;
          } else if (entry.status === "down") {
            statusIcon = "✖ Offline";
            statusColor = palette.danger;
          } else if (entry.status === "unknown") {
            statusIcon = "◌ Unknown";
            statusColor = palette.muted;
          }

          const latencyText =
            entry.latencyMs !== undefined
              ? `${entry.latencyMs.toString().padStart(4, " ")}ms`
              : "    --";

          return (
            <MouseTarget
              key={entry.id}
              id={`provider-row:${entry.id}`}
              onClick={() => {
                setSelectedIndex(index);
                void handleProbe(entry.id);
              }}
            >
              <Box
                flexDirection="row"
                paddingX={1}
                backgroundColor={isSelected ? "#1a2333" : undefined}
              >
                {/* Cursor & Status */}
                <Box width={14}>
                  <Text color={statusColor} bold={isSelected}>
                    {isSelected ? "> " : "  "}
                    {statusIcon}
                  </Text>
                </Box>

                {/* Provider Name & active tag */}
                <Box width={22}>
                  <Text
                    bold={entry.isActive || isSelected}
                    color={entry.disabled ? palette.dim : palette.text}
                  >
                    {entry.name}
                    {entry.isActive ? <Text color={palette.accent}> ★</Text> : null}
                    {entry.recommended ? <Text color={palette.muted}> ▾</Text> : null}
                  </Text>
                </Box>

                {/* Lane */}
                <Box width={10}>
                  <Text color={palette.muted}>
                    {entry.lane === "anime"
                      ? "Anime"
                      : entry.lane === "youtube"
                        ? "YouTube"
                        : "Movie"}
                  </Text>
                </Box>

                {/* Latency */}
                <Box width={11}>
                  <Text
                    color={entry.latencyMs && entry.latencyMs > 2000 ? palette.warn : palette.muted}
                  >
                    {latencyText}
                  </Text>
                </Box>

                {/* Capabilities */}
                <Box width={16}>
                  <Text color={palette.dim}>{entry.capabilities.slice(0, 2).join(" · ")}</Text>
                </Box>

                {/* Evidence / Reachability note */}
                <Box flexGrow={1}>
                  <Text color={isSelected ? palette.text : palette.muted} wrap="truncate">
                    {entry.evidence ?? "Available"}
                  </Text>
                </Box>
              </Box>
            </MouseTarget>
          );
        })}
      </Box>

      {/* Selected Provider Details Box */}
      {selectedEntry ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={palette.line}
          marginTop={1}
          paddingX={1}
        >
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={palette.accent}>
              {selectedEntry.name} ({selectedEntry.id})
              {selectedEntry.recommended ? " · Recommended Tier" : " · Alternative Tier"}
              {selectedEntry.isActive ? " · [Currently Active]" : ""}
            </Text>
            {selectedEntry.domain ? <Text color={palette.dim}>{selectedEntry.domain}</Text> : null}
          </Box>
          <Text color={palette.muted}>{selectedEntry.description}</Text>
          <Box flexDirection="row" gap={2} marginTop={0}>
            <Text color={palette.dim}>
              Capabilities:{" "}
              <Text color={palette.text}>{selectedEntry.capabilities.join(", ")}</Text>
            </Text>
            {selectedEntry.checkedAt ? (
              <Text color={palette.dim}>
                Last checked:{" "}
                <Text color={palette.text}>
                  {new Date(selectedEntry.checkedAt).toLocaleTimeString()}
                </Text>
              </Text>
            ) : null}
            {selectedEntry.consecutiveFailures ? (
              <Text color={palette.warn}>
                Failures: <Text color={palette.danger}>{selectedEntry.consecutiveFailures}</Text>
              </Text>
            ) : null}
          </Box>
        </Box>
      ) : null}

      {/* Status banner */}
      {statusMessage ? (
        <Box marginTop={1} paddingX={1}>
          <Text color={palette.accent}>ℹ {statusMessage}</Text>
        </Box>
      ) : null}

      {/* Actions footer */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        marginTop={1}
        borderStyle="single"
        borderColor={palette.line}
        paddingX={1}
      >
        <Text color={palette.muted}>
          <Text bold color={palette.accent}>
            [↑/↓]
          </Text>{" "}
          Select{"   "}
          <Text bold color={palette.accent}>
            [←/→/Tab]
          </Text>{" "}
          Filter{"   "}
          <Text bold color={palette.accent}>
            [p]
          </Text>{" "}
          Probe{"   "}
          <Text bold color={palette.accent}>
            [P]
          </Text>{" "}
          Probe All{"   "}
          <Text bold color={palette.accent}>
            [Enter]
          </Text>{" "}
          Set Active{"   "}
          <Text bold color={palette.accent}>
            [t]
          </Text>{" "}
          Toggle On/Off{"   "}
          <Text bold color={palette.accent}>
            [r]
          </Text>{" "}
          Reset Stats
        </Text>
      </Box>
    </Box>
  );
}
