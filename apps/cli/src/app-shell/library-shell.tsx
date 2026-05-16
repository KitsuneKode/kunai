import { DownloadManagerContent } from "@/app-shell/download-manager-shell";
import { EmptyState, InlineBadge } from "@/app-shell/shell-primitives";
import { truncateLine } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { buildPickerActionContext } from "@/app-shell/workflows";
import type { Container } from "@/container";
import { createOfflineLibraryEngine } from "@/domain/offline/OfflineLibraryEngine";
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

  useInput((input) => {
    if (input === "1" || input === "l") {
      setTab("library");
      return;
    }
    if (input === "2" || input === "q") {
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

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box>
        <InlineBadge label="panel library" tone="success" />
        <InlineBadge
          label={downloadsEnabled ? "downloads on" : "downloads off"}
          tone={downloadsEnabled ? "success" : "warning"}
        />
        <InlineBadge
          label={`auto: ${autoDownload === "next" ? "next ep" : autoDownload === "season" ? "season" : "off"}`}
          tone={autoDownload === "off" ? "neutral" : "info"}
        />
      </Box>

      <Box marginTop={1} flexDirection="row" columnGap={1}>
        <Box
          borderStyle={tab === "library" ? "round" : undefined}
          borderColor={tab === "library" ? palette.teal : undefined}
          paddingX={1}
        >
          <Text color={tab === "library" ? "white" : palette.gray}>1 Library</Text>
        </Box>
        <Box
          borderStyle={tab === "queue" ? "round" : undefined}
          borderColor={tab === "queue" ? palette.teal : undefined}
          paddingX={1}
        >
          <Text color={tab === "queue" ? "white" : palette.gray}>2 Queue</Text>
        </Box>
      </Box>

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
        <Text color={palette.muted} dimColor>
          ↑↓ select · x delete · p protect · Enter browse · d toggle · a cycle auto · Esc close
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    container.offlineLibraryService
      .listCompletedEntries(200)
      .then((result) => {
        if (cancelled) return undefined;
        setEntries(result);
        setLoading(false);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
  }, [container]);

  if (loading) {
    return (
      <Box>
        <Text color={palette.muted}>Loading offline titles...</Text>
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
          <Text color={palette.info}>Switch to Queue (2) to see active downloads</Text>
        </Box>
      </Box>
    );
  }

  const shelf = createOfflineLibraryEngine().buildShelf(entries);
  const safeIndex = Math.min(selectedIndex, shelf.groups.length - 1);
  const groups = shelf.groups.slice(0, 15);
  const selectedGroup = groups[safeIndex] ?? null;

  useInput((input, key) => {
    if (key.upArrow) {
      setConfirmDeleteKey(null);
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setConfirmDeleteKey(null);
      setSelectedIndex((prev) => Math.min(groups.length - 1, prev + 1));
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

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text color={palette.gray}>{shelf.summary}</Text>
      </Box>
      <Box flexDirection="column">
        {groups.map((group, index) => (
          <Box key={group.key}>
            <Text color={index === safeIndex ? palette.teal : palette.gray}>
              {index === safeIndex ? "❯ " : "  "}
            </Text>
            <Text color={index === safeIndex ? "white" : undefined} bold={index === safeIndex}>
              {truncateLine(group.label, 42)}
            </Text>
            <Text color={palette.muted} dimColor>
              {"  ·  "}
              {group.actionSummary}
            </Text>
            {confirmDeleteKey === group.key ? (
              <Text color={palette.amber} bold>
                {"  "}x again to delete
              </Text>
            ) : null}
          </Box>
        ))}
        {shelf.groups.length > 15 ? (
          <Box marginTop={1}>
            <Text color={palette.gray} dimColor>
              and {shelf.groups.length - 15} more titles...
            </Text>
          </Box>
        ) : null}
      </Box>
      {selectedGroup && confirmDeleteKey === selectedGroup.key ? (
        <Box marginTop={1}>
          <Text color={palette.amber}>
            {"⚠ "}Press x again to delete {selectedGroup.titleName} and all local files
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
