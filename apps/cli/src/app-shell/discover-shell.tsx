import type { SearchResult } from "@/domain/types";
import type { RecommendationSection } from "@/services/recommendations/RecommendationService";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

import { DotMatrixLoader, InlineDotMatrixLoader } from "./dot-matrix-loader";
import { ResizeBlocker, ShellFooter } from "./shell-primitives";
import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import { useDebouncedViewportPolicy } from "./use-viewport-policy";

export type DiscoverShellResult = { type: "open"; result: SearchResult } | { type: "back" };

/**
 * Single recommendation section rendered as a horizontal "rail" with a label header.
 *
 * Items are displayed as compact ranked rows with active selection highlighting.
 * The active row shows the ▌ accent bar in the lavender recommendation accent.
 * Rating and year are rendered as right-aligned metadata when available.
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
      <Text color={isFocused ? palette.lavender : palette.muted} bold={isFocused}>
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
            <Box
              key={item.id}
              width={maxWidth}
              backgroundColor={isActive ? palette.surfaceActive : undefined}
            >
              <Box flexShrink={1} flexGrow={1}>
                <Text bold={isActive} wrap="truncate">
                  <Text color={isActive ? palette.lavender : palette.gray}>
                    {isActive ? "  ▌ " : "    "}
                  </Text>
                  <Text color={palette.dim} dimColor>
                    {`${idx + 1}`.padStart(2)}
                    {"  "}
                  </Text>
                  <Text color={isActive ? "white" : palette.text}>
                    {truncateLine(item.title, titleBudget)}
                  </Text>
                </Text>
              </Box>
              <Box flexShrink={0}>
                <Text color={isActive ? palette.lavender : palette.gray} dimColor={!isActive}>
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
  const [sectionIdx, setSectionIdx] = useState(0);
  const [itemIdx, setItemIdx] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingSectionIdx, setRefreshingSectionIdx] = useState<number | null>(null);
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
    if (input === "r" && !refreshing && refreshingSectionIdx === null) {
      if (onRefreshSection) {
        // Per-section reroll: refresh only the focused section
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
    if (key.tab && key.shift) {
      if (sectionIdx > 0) {
        setSectionIdx((s) => s - 1);
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
    return (
      <ResizeBlocker
        columns={viewport.columns}
        rows={viewport.rows}
        minColumns={viewport.minColumns}
        minRows={viewport.minRows}
      />
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between" paddingX={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <Text bold color={palette.lavender}>
            ⬡ Discover
          </Text>
          {refreshing ? (
            <Box>
              <InlineDotMatrixLoader variant="echo-ring" active onColor={palette.teal} />
              <Text color={palette.teal}> refreshing</Text>
            </Box>
          ) : refreshError ? (
            <Text color={palette.red}>refresh failed</Text>
          ) : null}
        </Box>
        {refreshError ? (
          <Box marginTop={1}>
            <Text color={palette.amber}>{refreshError}</Text>
            <Text color={palette.dim} dimColor>
              Press r to retry
            </Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column" flexGrow={1}>
          {visibleSections.length === 0 ? (
            <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
              <DotMatrixLoader variant="echo-ring" active onColor={palette.amber} />
              <Box marginTop={1}>
                <Text color={palette.muted}>Loading recommendations…</Text>
              </Box>
            </Box>
          ) : visibleSections.every((s) => s.items.length === 0) ? (
            <Box flexDirection="column" paddingY={2}>
              <Text color={palette.amber}>{"◈  nothing to discover yet"}</Text>
              <Text color={palette.dim}>watch something first to get recommendations</Text>
              <Box marginTop={1}>
                <Text color={palette.dim} dimColor>
                  {"  ^ᵔᴥᵔ^  a fox awaits"}
                </Text>
              </Box>
            </Box>
          ) : (
            visibleSections.map((section, idx) => {
              if (refreshingSectionIdx === idx) {
                return (
                  <Box key={section.reason + String(idx)} flexDirection="column" marginBottom={1}>
                    <Text
                      color={idx === sectionIdx ? palette.amber : palette.muted}
                      bold={idx === sectionIdx}
                    >
                      {idx === sectionIdx ? "▸ " : "  "}
                      {section.label}
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
                  focusedIndex={itemIdx}
                  compact={viewport.compact}
                  maxWidth={innerWidth}
                />
              );
            })
          )}
        </Box>
      </Box>
      {(() => {
        const focusedItem = currentSection?.items[itemIdx];
        if (!focusedItem) return null;
        const meta = [
          focusedItem.year,
          focusedItem.rating !== null && focusedItem.rating !== undefined
            ? `★ ${focusedItem.rating.toFixed(1)}`
            : null,
        ]
          .filter(Boolean)
          .join("  ");
        const overview = focusedItem.overview
          ? focusedItem.overview.slice(0, Math.max(60, innerWidth - 4))
          : null;
        return (
          <Box flexDirection="column" marginBottom={1} paddingX={1}>
            {meta ? (
              <Text color={palette.amber} dimColor>
                {meta}
              </Text>
            ) : null}
            {overview ? (
              <Text color={palette.muted} dimColor wrap="truncate">
                {overview}
              </Text>
            ) : null}
          </Box>
        );
      })()}
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
