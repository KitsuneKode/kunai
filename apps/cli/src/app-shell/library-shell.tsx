import { DownloadManagerContent } from "@/app-shell/download-manager-shell";
import { EmptyState, InlineBadge } from "@/app-shell/shell-primitives";
import { truncateLine } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
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
          d toggle · a cycle auto · 1 Library · 2 Queue · Esc close
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
    return () => {
      cancelled = true;
    };
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
  const previewGroups = shelf.groups.slice(0, 10);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text color={palette.gray}>{shelf.summary}</Text>
      </Box>
      <Box flexDirection="column">
        {previewGroups.map((group) => (
          <Box key={group.key}>
            <Text color="white" bold>
              {truncateLine(group.label, 44)}
            </Text>
            <Text color={palette.muted} dimColor>
              {"  ·  "}
              {group.actionSummary}
            </Text>
          </Box>
        ))}
        {shelf.groups.length > 10 ? (
          <Box marginTop={1}>
            <Text color={palette.gray} dimColor>
              and {shelf.groups.length - 10} more titles...
            </Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
