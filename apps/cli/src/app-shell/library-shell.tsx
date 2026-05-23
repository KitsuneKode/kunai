import { DownloadManagerContent } from "@/app-shell/download-manager-shell";
import { DetailLine, EmptyState, ResizeBlocker } from "@/app-shell/shell-primitives";
import { truncateLine } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { useDebouncedViewportPolicy } from "@/app-shell/use-viewport-policy";
import { buildPickerActionContext } from "@/app-shell/workflows";
import type { Container } from "@/container";
import { createOfflineLibraryEngine } from "@/domain/offline/OfflineLibraryEngine";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import { formatTimestamp, isFinished } from "@/services/persistence/HistoryStore";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";

type TabId = "library" | "queue";

export function LibraryShell({
  container,
  onClose,
  initialView = "library",
}: {
  container: Container;
  onClose: () => void;
  initialView?: TabId;
}) {
  const [tab, setTab] = useState<TabId>(initialView);
  const [downloadsEnabled, setDownloadsEnabled] = useState(container.config.downloadsEnabled);
  const [autoDownload, setAutoDownload] = useState(container.config.autoDownload);
  const viewport = useDebouncedViewportPolicy("picker");

  useInput((input, key) => {
    if (key.tab) {
      setTab((prev) => (prev === "library" ? "queue" : "library"));
      return;
    }
    if (input === "1" || input === "l") {
      setTab("library");
      return;
    }
    if (input === "2") {
      setTab("queue");
      return;
    }
    if (input === "d" || input === "D") {
      const next = !downloadsEnabled;
      setDownloadsEnabled(next);
      void container.config.update({ downloadsEnabled: next });
      void container.config.save();
      return;
    }
    if (input === "a" || input === "A") {
      const next =
        autoDownload === "off"
          ? ("next" as const)
          : autoDownload === "next"
            ? ("season" as const)
            : ("off" as const);
      setAutoDownload(next);
      void container.config.update({ autoDownload: next });
      void container.config.save();
      return;
    }
  });

  if (viewport.tooSmall) {
    return (
      <ResizeBlocker
        columns={viewport.columns}
        rows={viewport.rows}
        minColumns={viewport.minColumns}
        minRows={viewport.minRows}
      />
    );
  }

  const autoLabel =
    autoDownload === "next" ? "next ep" : autoDownload === "season" ? "season" : "off";

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Tab bar */}
      <Box flexDirection="row" columnGap={3}>
        <Text color={tab === "library" ? palette.accent : palette.dim} bold={tab === "library"}>
          {tab === "library" ? "▸ " : "  "}Library
        </Text>
        <Text color={tab === "queue" ? palette.accent : palette.dim} bold={tab === "queue"}>
          {tab === "queue" ? "▸ " : "  "}Queue
        </Text>
      </Box>
      {/* Single-line status */}
      <Text color={palette.dim} dimColor>
        {downloadsEnabled ? "downloads on" : "downloads off"} · auto: {autoLabel}
      </Text>

      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {tab === "queue" ? (
          <DownloadManagerContent
            container={container}
            onClose={onClose}
            onNavigateToLibrary={() => setTab("library")}
          />
        ) : (
          <LibraryTab container={container} />
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={palette.dim} dimColor>
          {tab === "library"
            ? "↑↓ navigate · ↵ open · x delete · p protect · Tab switch"
            : "Tab switch to library · d toggle downloads · a auto-download"}
        </Text>
      </Box>
    </Box>
  );
}

function LibraryTab({ container }: { container: Container }) {
  const [entries, setEntries] = useState<
    readonly import("@/services/offline/offline-library").OfflineLibraryEntry[] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [historyMap, setHistoryMap] = useState<Record<string, HistoryEntry>>({});
  const viewport = useDebouncedViewportPolicy("picker");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      container.offlineLibraryService.listCompletedEntries(200),
      container.historyStore.getAll(),
    ])
      .then(([result, history]) => {
        if (cancelled) return undefined;
        setEntries(result);
        setHistoryMap(history);
        setLoading(false);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [container]);

  // Compute derived data unconditionally so hooks stay stable.
  // Guard all operations inside useInput so they no-op when data isn't ready.
  const shelf = entries ? createOfflineLibraryEngine().buildShelf(entries) : null;
  const totalGroups = shelf ? shelf.groups.length : 0;
  const maxGroups = Math.max(8, viewport.maxVisibleRows - 6);
  const safeIndex = totalGroups > 0 ? Math.min(selectedIndex, totalGroups - 1) : 0;
  const windowStart = Math.max(
    0,
    Math.min(safeIndex - Math.floor(maxGroups / 2), totalGroups - maxGroups),
  );
  const windowEnd = Math.min(totalGroups, windowStart + maxGroups);
  const groups = shelf ? shelf.groups.slice(windowStart, windowEnd) : [];
  const selectedGroup = totalGroups > 0 ? (shelf?.groups[safeIndex] ?? null) : null;

  useInput((input, key) => {
    if (loading || !entries || entries.length === 0 || groups.length === 0) return;
    if (key.upArrow) {
      setConfirmDeleteKey(null);
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setConfirmDeleteKey(null);
      setSelectedIndex((prev) => Math.min(totalGroups - 1, prev + 1));
      return;
    }
    if (input === "x" || key.delete) {
      if (!selectedGroup) return;
      if (confirmDeleteKey === selectedGroup.key) {
        setConfirmDeleteKey(null);
        const groupEntryIds = entries
          .filter((e) => e.job.titleId === selectedGroup.titleId)
          .map((e) => e.job.id);
        for (const jobId of groupEntryIds) {
          container.downloadService.deleteJob(jobId, { deleteArtifact: true });
        }
        setEntries((prev) =>
          prev ? prev.filter((e) => e.job.titleId !== selectedGroup.titleId) : null,
        );
      } else {
        setConfirmDeleteKey(selectedGroup.key);
      }
      return;
    }
    if (input === "p" || input === "P") {
      if (!selectedGroup) return;
      const groupEntryIds = entries
        .filter((e) => e.job.titleId === selectedGroup.titleId)
        .map((e) => e.job.id);
      const protectedSet = new Set(container.config.protectedDownloadJobIds);
      const allProtected = groupEntryIds.every((id) => protectedSet.has(id));
      void (async () => {
        const updated = new Set(container.config.protectedDownloadJobIds);
        for (const jobId of groupEntryIds) {
          if (allProtected) updated.delete(jobId);
          else updated.add(jobId);
        }
        await container.config.update({ protectedDownloadJobIds: [...updated] });
        await container.config.save();
      })();
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: allProtected
          ? `Removed cleanup protection: ${selectedGroup.titleName}`
          : `Protected from cleanup: ${selectedGroup.titleName}`,
      });
      return;
    }
    if (key.return) {
      if (!selectedGroup) return;
      const entryById = new Map(entries.map((e) => [e.job.id, e]));
      const groupEntryIdsSet = new Set(
        entries.filter((e) => e.job.titleId === selectedGroup.titleId).map((e) => e.job.id),
      );
      const groupEntries = [...entryById.values()].filter((e) => groupEntryIdsSet.has(e.job.id));
      void (async () => {
        const { openOfflineLibraryGroupPicker } = await import("./workflows");
        await openOfflineLibraryGroupPicker(
          container,
          groupEntries,
          buildPickerActionContext({
            container,
            taskLabel: `Offline: ${selectedGroup.titleName}`,
          }),
          {
            actionSummary: selectedGroup.actionSummary,
            artifactSummary: selectedGroup.artifactSummary,
          },
        );
      })();
      return;
    }
    if (confirmDeleteKey !== null) {
      setConfirmDeleteKey(null);
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center">
        <Text color={palette.muted}>◌ Loading offline titles…</Text>
      </Box>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <EmptyState
          icon="📂"
          title="No offline titles yet"
          subtitle="Queue downloads from playback with / → Download current episode"
        />
        <Box marginTop={1}>
          <Text color={palette.muted} dimColor>
            Switch to Queue (2) to see active downloads
          </Text>
        </Box>
      </Box>
    );
  }

  // TypeScript narrowing: shelf is guaranteed here because loading/empty returned above
  if (!shelf) return null;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text color={palette.dim}>{shelf.summary}</Text>
      </Box>
      <Box flexDirection="column">
        {windowStart > 0 ? <Text color={palette.dim}> ▲ ...</Text> : null}
        {groups.map((group, index) => {
          const absoluteIndex = windowStart + index;
          const selected = absoluteIndex === safeIndex;
          return (
            <Box key={group.key} flexDirection="column">
              <Box backgroundColor={selected ? palette.surfaceActive : undefined}>
                <Text color={selected ? palette.accent : palette.dim}>
                  {selected ? "▌ " : "  "}
                </Text>
                <Text color={selected ? palette.text : undefined} bold={selected}>
                  {truncateLine(group.label, 36)}
                </Text>
                {group.readyCount > 0 ? (
                  <Text color={palette.ok}>{`  ${group.readyCount}▶`}</Text>
                ) : null}
                {group.issueCount > 0 ? (
                  <Text color={palette.accentDeep}>{` ${group.issueCount}⚠`}</Text>
                ) : null}
                <Text color={palette.muted} dimColor>
                  {"  ·  "}
                  {group.nextPlayableEpisodeLabel ?? "no playable files"}
                </Text>
                {confirmDeleteKey === group.key ? (
                  <Text color={palette.accentDeep} bold>
                    {"  "}x again to delete
                  </Text>
                ) : null}
              </Box>
              {selected ? (
                <Box marginLeft={2}>
                  <Text color={palette.dim} dimColor>
                    {truncateLine(
                      `${group.artifactSummary}  ·  ${group.detail}`,
                      Math.max(40, Math.min(110, (viewport.columns ?? 80) - 6)),
                    )}
                  </Text>
                </Box>
              ) : null}
            </Box>
          );
        })}
        {windowEnd < totalGroups ? <Text color={palette.dim}> ▼ ...</Text> : null}
      </Box>
      {selectedGroup && confirmDeleteKey === selectedGroup.key ? (
        <Box marginTop={1}>
          <Text color={palette.accentDeep}>
            {"⚠ "}Press x again to delete {selectedGroup.titleName} and all local files
          </Text>
        </Box>
      ) : null}
      {selectedGroup && confirmDeleteKey !== selectedGroup.key ? (
        <Box marginTop={1} flexDirection="column">
          {(() => {
            const hist = historyMap[selectedGroup.titleId];
            if (!hist) return null;
            if (!isFinished(hist) && hist.timestamp > 30) {
              const ep =
                hist.type === "series"
                  ? ` S${String(hist.season).padStart(2, "0")}E${String(hist.episode).padStart(2, "0")}`
                  : "";
              const at = formatTimestamp(hist.timestamp);
              return (
                <DetailLine
                  label="Resume"
                  value={`${hist.title}${ep} · paused at ${at}`}
                  tone="warning"
                />
              );
            }
            if (isFinished(hist)) {
              const ep =
                hist.type === "series"
                  ? ` S${String(hist.season).padStart(2, "0")}E${String(hist.episode).padStart(2, "0")}`
                  : "";
              return (
                <DetailLine
                  label="History"
                  value={`last watched${ep} · ${new Date(hist.watchedAt).toLocaleDateString()}`}
                  tone="success"
                />
              );
            }
            return null;
          })()}
          <DetailLine label="Files" value={selectedGroup.artifactSummary} tone="neutral" />
          {selectedGroup.entries.slice(0, 6).map((entry) => (
            <DetailLine
              key={entry.jobId}
              label={entry.episodeLabel}
              value={entry.detail}
              tone={entry.playable ? "success" : "warning"}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
