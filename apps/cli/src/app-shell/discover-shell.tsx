import { truncateLabel } from "@/design";
import type { SearchResult } from "@/domain/types";
import type { RecommendationSection } from "@/services/recommendations/RecommendationService";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

import { EmptyState, ResizeBlocker, ShellFooter } from "./shell-primitives";
import { palette } from "./shell-theme";
import { useDebouncedViewportPolicy } from "./use-viewport-policy";

export type DiscoverShellResult = { type: "open"; result: SearchResult } | { type: "back" };

/**
 * Single recommendation section rendered as a horizontal "rail" with a label header.
 *
 * Items are displayed as compact rows with active selection highlighting.
 * The focused section shows the ❯ cursor indicator. Rating and year are rendered
 * as right-aligned metadata when available.
 */
const DiscoverSectionView = React.memo(function DiscoverSectionView({
  section,
  isFocused,
  focusedIndex,
  compact,
  maxWidth,
}: {
  section: RecommendationSection;
  isFocused: boolean;
  focusedIndex: number;
  compact: boolean;
  maxWidth: number;
}) {
  const titleBudget = Math.max(16, maxWidth - 18);
  return (
    <Box flexDirection="column" marginBottom={compact ? 0 : 1}>
      <Text color={isFocused ? palette.amber : palette.muted} bold={isFocused}>
        {isFocused ? "▸ " : "  "}
        {section.label}
        <Text color={palette.gray} dimColor>
          {" "}
          · {section.items.length}
        </Text>
      </Text>
      {section.items.length === 0 ? (
        <Text color={palette.gray} dimColor>
          {"    "}Nothing here yet
        </Text>
      ) : (
        section.items.map((item, idx) => {
          const isActive = isFocused && idx === focusedIndex;
          const rating =
            item.rating !== null && item.rating !== undefined ? `★ ${item.rating.toFixed(1)}` : "";
          return (
            <Box key={item.id} width={maxWidth}>
              <Box flexShrink={1} flexGrow={1}>
                <Text
                  backgroundColor={isActive ? palette.teal : undefined}
                  color={isActive ? "black" : palette.muted}
                  bold={isActive}
                  wrap="truncate"
                >
                  {isActive ? "  ❯ " : "    "}
                  {truncateLabel(item.title, titleBudget)}
                </Text>
              </Box>
              <Box flexShrink={0}>
                <Text color={isActive ? palette.teal : palette.gray} dimColor={!isActive}>
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
  onResult,
}: {
  sections: RecommendationSection[];
  onRefresh?: () => Promise<readonly RecommendationSection[]>;
  onResult: (result: DiscoverShellResult) => void;
}) {
  const [visibleSections, setVisibleSections] =
    useState<readonly RecommendationSection[]>(sections);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [itemIdx, setItemIdx] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const viewport = useDebouncedViewportPolicy("browse");

  const currentSection = visibleSections[sectionIdx];
  const currentItems = currentSection?.items ?? [];
  const innerWidth = Math.max(36, viewport.columns - 8);

  useInput((input, key) => {
    if (key.escape) {
      onResult({ type: "back" });
      return;
    }
    if (input === "r" && onRefresh && !refreshing) {
      setRefreshing(true);
      setRefreshError(null);
      void onRefresh()
        .then((nextSections) => {
          setVisibleSections(nextSections);
          setSectionIdx(0);
          setItemIdx(0);
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
    if (key.upArrow) {
      if (itemIdx > 0) setItemIdx((i) => i - 1);
      else if (sectionIdx > 0) {
        const prevSection = visibleSections[sectionIdx - 1];
        setSectionIdx((s) => s - 1);
        setItemIdx((prevSection?.items.length ?? 1) - 1);
      }
      return;
    }
    if (key.downArrow) {
      if (itemIdx < currentItems.length - 1) setItemIdx((i) => i + 1);
      else if (sectionIdx < visibleSections.length - 1) {
        setSectionIdx((s) => s + 1);
        setItemIdx(0);
      }
      return;
    }
    if (key.tab) {
      if (sectionIdx < visibleSections.length - 1) {
        setSectionIdx((s) => s + 1);
        setItemIdx(0);
      }
      return;
    }
    if (key.return) {
      const item = currentSection?.items[itemIdx];
      if (item) onResult({ type: "open", result: item });
      return;
    }
  });

  if (viewport.tooSmall) {
    return <ResizeBlocker minColumns={viewport.minColumns} minRows={viewport.minRows} />;
  }

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between" paddingX={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <Text bold color={palette.amber}>
            ⬡ Discover
          </Text>
          {refreshing ? (
            <Text color={palette.teal}>◌ refreshing</Text>
          ) : refreshError ? (
            <Text color={palette.red}>refresh failed</Text>
          ) : null}
        </Box>
        {refreshError ? (
          <Box marginTop={1}>
            <Text color={palette.red}>{refreshError}</Text>
            <Text color={palette.muted} dimColor>
              Press r to retry
            </Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column" flexGrow={1}>
          {visibleSections.length === 0 ? (
            <EmptyState
              icon="⬡"
              title="Loading recommendations"
              subtitle="Fetching personalized suggestions from your watch history"
              hint="Press r to refresh manually"
            />
          ) : (
            visibleSections.map((section, idx) => (
              <DiscoverSectionView
                key={section.reason + String(idx)}
                section={section}
                isFocused={idx === sectionIdx}
                focusedIndex={itemIdx}
                compact={viewport.compact}
                maxWidth={innerWidth}
              />
            ))
          )}
        </Box>
      </Box>
      <ShellFooter
        taskLabel="Discover"
        actions={[
          { key: "↵", label: "open", action: "search" },
          { key: "↑↓", label: "navigate", action: "search" },
          { key: "tab", label: "next section", action: "search" },
          ...(onRefresh ? [{ key: "r", label: "refresh", action: "search" as const }] : []),
          { key: "esc", label: "back", action: "quit" },
        ]}
      />
    </Box>
  );
}
