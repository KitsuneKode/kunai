import type { SearchResult } from "@/domain/types";
import type { RecommendationSection } from "@/services/recommendations/RecommendationService";
import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";

import { buildPreviewRailModelFromBrowseOption } from "./browse-preview-rail";
import {
  discoverSectionHeaderTitle,
  discoverSectionReasonDetail,
  discoverSectionReasonLine,
} from "./discover-reason";
import { DotMatrixLoader, InlineDotMatrixLoader } from "./dot-matrix-loader";
import { MediaListShell } from "./primitives/MediaListShell";
import { shouldRenderPreviewRail } from "./primitives/PreviewRail";
import { ResizeBlocker, ShellFooter } from "./shell-primitives";
import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import type { BrowseShellOption } from "./types";
import { useDebouncedViewportPolicy } from "./use-viewport-policy";

export type DiscoverShellResult = { type: "open"; result: SearchResult } | { type: "back" };

function discoverItemToBrowseOption(
  item: SearchResult,
  section?: RecommendationSection,
): BrowseShellOption<SearchResult> {
  const reasonLine = section ? discoverSectionReasonLine(section) : undefined;
  return {
    value: item,
    label: item.title,
    previewTitle: item.title,
    previewMeta: [
      item.type === "series" ? "Series" : "Movie",
      item.year ? String(item.year) : undefined,
      item.rating !== null && item.rating !== undefined ? `★ ${item.rating.toFixed(1)}` : undefined,
    ].filter((value): value is string => Boolean(value)),
    previewBody: item.overview?.trim() || undefined,
    previewNote: reasonLine ?? "Press Enter to open this pick.",
    previewFacts:
      item.rating !== null && item.rating !== undefined
        ? [{ label: "Rating", detail: `${item.rating.toFixed(1)}/10`, tone: "neutral" as const }]
        : undefined,
  };
}

const DiscoverSectionView = React.memo(function DiscoverSectionView({
  section,
  isFocused,
  compact,
  maxWidth,
  sectionOffset,
  globalSelectedIndex,
}: {
  section: RecommendationSection;
  isFocused: boolean;
  compact: boolean;
  maxWidth: number;
  sectionOffset: number;
  globalSelectedIndex: number;
}) {
  const titleBudget = Math.max(16, maxWidth - 18);
  const reasonLine = discoverSectionReasonLine(section);
  const reasonDetail = discoverSectionReasonDetail(section);
  const sectionTitle = discoverSectionHeaderTitle(section);
  return (
    <Box flexDirection="column" marginBottom={compact ? 0 : 1}>
      <Text color={isFocused ? palette.accent : palette.muted} bold={isFocused}>
        {isFocused ? "▸ " : "  "}
        {sectionTitle}
        <Text color={palette.dim} dimColor>
          {" "}
          · {section.items.length}
        </Text>
      </Text>
      <Box marginLeft={2} flexDirection="column">
        <Text color={isFocused ? palette.accent : palette.textDim} bold={isFocused}>
          {reasonLine}
        </Text>
        <Text color={palette.dim} dimColor>
          {reasonDetail}
        </Text>
      </Box>
      {section.items.length === 0 ? (
        <Text color={palette.dim} dimColor>
          {"    "}Nothing here yet
        </Text>
      ) : (
        section.items.map((item, idx) => {
          const globalIndex = sectionOffset + idx;
          const isActive = globalSelectedIndex === globalIndex;
          const rating =
            item.rating !== null && item.rating !== undefined ? `★ ${item.rating.toFixed(1)}` : "";
          return (
            <Box
              key={item.id}
              width={maxWidth}
              backgroundColor={isActive ? palette.surfaceActive : undefined}
            >
              <Box flexShrink={1} flexGrow={1}>
                <Text bold={isActive} wrap="truncate">
                  <Text color={isActive ? palette.accent : palette.dim}>
                    {isActive ? "  ▌ " : "    "}
                  </Text>
                  <Text color={palette.dim} dimColor>
                    {`${idx + 1}`.padStart(2)}
                    {"  "}
                  </Text>
                  <Text color={isActive ? palette.text : palette.textDim}>
                    {truncateLine(item.title, titleBudget)}
                  </Text>
                </Text>
              </Box>
              <Box flexShrink={0}>
                <Text color={palette.muted} dimColor={!isActive}>
                  {` ${rating.padEnd(7)} ${item.year}`}
                </Text>
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
});

export function DiscoverShell({
  sections,
  onRefresh,
  onRefreshSection,
  onResult,
}: {
  sections: RecommendationSection[];
  onRefresh?: () => Promise<readonly RecommendationSection[]>;
  onRefreshSection?: (sectionIdx: number) => Promise<RecommendationSection | null>;
  onResult: (result: DiscoverShellResult) => void;
}) {
  const [visibleSections, setVisibleSections] =
    useState<readonly RecommendationSection[]>(sections);
  const [selectedGlobalIndex, setSelectedGlobalIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingSectionIdx, setRefreshingSectionIdx] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const viewport = useDebouncedViewportPolicy("browse");

  const flatItems = useMemo(
    () => visibleSections.flatMap((section) => section.items),
    [visibleSections],
  );
  const sectionOffsets = useMemo(() => {
    const offsets: number[] = [];
    let running = 0;
    for (const section of visibleSections) {
      offsets.push(running);
      running += section.items.length;
    }
    return offsets;
  }, [visibleSections]);

  const resolveSectionSelection = (
    globalIndex: number,
  ): { sectionIdx: number; itemIdx: number } => {
    let cursor = 0;
    for (let sectionIdx = 0; sectionIdx < visibleSections.length; sectionIdx += 1) {
      const count = visibleSections[sectionIdx]?.items.length ?? 0;
      if (globalIndex < cursor + count) {
        return { sectionIdx, itemIdx: globalIndex - cursor };
      }
      cursor += count;
    }
    return { sectionIdx: 0, itemIdx: 0 };
  };

  const { sectionIdx } = resolveSectionSelection(selectedGlobalIndex);
  const activeSection = visibleSections[sectionIdx];
  const selectedItem = flatItems[selectedGlobalIndex];
  const previewRailModel = buildPreviewRailModelFromBrowseOption(
    selectedItem ? discoverItemToBrowseOption(selectedItem, activeSection) : undefined,
    "none",
  );
  const innerWidth = Math.max(36, viewport.columns - 8);
  const previewWidth = Math.max(28, Math.floor(innerWidth * 0.32));
  const listWidth = shouldRenderPreviewRail({ columns: viewport.columns, hasModel: true })
    ? Math.max(40, innerWidth - previewWidth - 4)
    : innerWidth;
  const showPreviewRail = shouldRenderPreviewRail({
    columns: viewport.columns,
    hasModel: previewRailModel !== null,
  });

  useInput((input, key) => {
    if (key.escape) {
      onResult({ type: "back" });
      return;
    }
    if (input === "r" && !refreshing && refreshingSectionIdx === null) {
      if (onRefreshSection) {
        setRefreshingSectionIdx(sectionIdx);
        setRefreshError(null);
        void onRefreshSection(sectionIdx)
          .then((updated) => {
            if (updated !== null) {
              setVisibleSections((prev) => prev.map((s, i) => (i === sectionIdx ? updated : s)));
            }
            return undefined;
          })
          .catch((err) => {
            setRefreshError(String(err));
            return undefined;
          })
          .finally(() => {
            setRefreshingSectionIdx(null);
          });
        return;
      }
      if (onRefresh) {
        setRefreshing(true);
        setRefreshError(null);
        void onRefresh()
          .then((nextSections) => {
            setVisibleSections(nextSections);
            setSelectedGlobalIndex(0);
            return undefined;
          })
          .catch((err) => {
            setRefreshError(String(err));
            return undefined;
          })
          .finally(() => {
            setRefreshing(false);
          });
        return;
      }
      return;
    }
    if (key.upArrow) {
      if (selectedGlobalIndex > 0) setSelectedGlobalIndex((index) => index - 1);
      return;
    }
    if (key.downArrow) {
      if (selectedGlobalIndex < flatItems.length - 1) {
        setSelectedGlobalIndex((index) => index + 1);
      }
      return;
    }
    if (key.tab && key.shift) {
      const prevOffset = sectionOffsets[sectionIdx - 1];
      if (prevOffset !== undefined) setSelectedGlobalIndex(prevOffset);
      return;
    }
    if (key.tab) {
      const nextOffset = sectionOffsets[sectionIdx + 1];
      if (nextOffset !== undefined) setSelectedGlobalIndex(nextOffset);
      return;
    }
    if (key.return) {
      const item = flatItems[selectedGlobalIndex];
      if (item) onResult({ type: "open", result: item });
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

  const listBody =
    visibleSections.length === 0 ? (
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <DotMatrixLoader variant="echo-ring" active onColor={palette.accent} />
        <Box marginTop={1}>
          <Text color={palette.muted}>Loading recommendations…</Text>
        </Box>
      </Box>
    ) : visibleSections.every((s) => s.items.length === 0) ? (
      <Box flexDirection="column" paddingY={2}>
        <Text color={palette.muted}>{"◈  nothing to discover yet"}</Text>
        <Text color={palette.dim}>watch something first to get recommendations</Text>
      </Box>
    ) : (
      visibleSections.map((section, idx) => {
        if (refreshingSectionIdx === idx) {
          return (
            <Box key={section.reason + String(idx)} flexDirection="column" marginBottom={1}>
              <Text
                color={idx === sectionIdx ? palette.accent : palette.muted}
                bold={idx === sectionIdx}
              >
                {idx === sectionIdx ? "▸ " : "  "}
                {section.label || discoverSectionReasonDetail(section)}
              </Text>
              <Box>
                <InlineDotMatrixLoader variant="echo-ring" active onColor={palette.dim} />
                <Text color={palette.dim} dimColor>
                  {" ░░░ rerolling…"}
                </Text>
              </Box>
            </Box>
          );
        }
        return (
          <DiscoverSectionView
            key={section.reason + String(idx)}
            section={section}
            isFocused={idx === sectionIdx}
            compact={viewport.compact}
            maxWidth={listWidth}
            sectionOffset={sectionOffsets[idx] ?? 0}
            globalSelectedIndex={selectedGlobalIndex}
          />
        );
      })
    );

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between" paddingX={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <Text bold color={palette.text}>
            ⬡ Discover
          </Text>
          {refreshing ? (
            <Box>
              <InlineDotMatrixLoader variant="echo-ring" active onColor={palette.accent} />
              <Text color={palette.accent}> refreshing</Text>
            </Box>
          ) : refreshError ? (
            <Text color={palette.danger}>refresh failed</Text>
          ) : null}
        </Box>
        {refreshError ? (
          <Box marginTop={1}>
            <Text color={palette.danger}>{refreshError}</Text>
            <Text color={palette.dim} dimColor>
              Press r to retry
            </Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexGrow={1}>
          <MediaListShell
            columns={viewport.columns}
            listWidth={listWidth}
            railWidth={previewWidth}
            list={listBody}
            railModel={showPreviewRail ? previewRailModel : null}
          />
        </Box>
      </Box>
      <ShellFooter
        taskLabel="Discover"
        actions={[
          { key: "↵", label: "open", action: "search" },
          { key: "↑↓", label: "navigate", action: "search" },
          { key: "tab", label: "section", action: "search" },
          ...(onRefreshSection
            ? [{ key: "r", label: "reroll section", action: "search" as const }]
            : onRefresh
              ? [{ key: "r", label: "refresh", action: "search" as const }]
              : []),
          { key: "esc", label: "back", action: "quit" },
        ]}
      />
    </Box>
  );
}
