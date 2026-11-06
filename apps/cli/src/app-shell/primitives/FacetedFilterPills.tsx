import { Box, Text } from "ink";
import React from "react";

import { MouseTarget } from "../mouse/MouseRegions";
import { palette } from "../shell-theme";
import {
  formatFacetCategoryBadge,
  getActiveFacetCounts,
  type FacetedFilterCategory,
  type FacetedFilterState,
} from "./faceted-filter.model";

export interface FacetedFilterPillsProps<T = string> {
  readonly categories: readonly FacetedFilterCategory<T>[];
  readonly state: FacetedFilterState<T>;
  readonly onOpenFilter?: (categoryId?: string) => void;
  readonly onClearCategory?: (categoryId: string) => void;
  readonly onClearAll?: () => void;
  readonly width?: number;
}

/**
 * Filter trigger and pill bar matching the shadcn DataTableFacetedFilter design.
 *
 * Displays:
 * - Filter trigger pill [+ Filter ▾]
 * - Category facet pills with selected badge counters: [Quality: 1080p, 720p (2) ×]
 * - Direct reset action [Clear all] when any facet is active
 */
export const FacetedFilterPills = React.memo(function FacetedFilterPills<T = string>({
  categories,
  state,
  onOpenFilter,
  onClearCategory,
  onClearAll,
}: FacetedFilterPillsProps<T>) {
  const { total, byCategory } = getActiveFacetCounts(state);

  return (
    <Box flexDirection="row" flexWrap="wrap" alignItems="center">
      <MouseTarget id="filter:trigger" onClick={() => onOpenFilter?.()}>
        <Box
          marginRight={1}
          paddingX={1}
          backgroundColor={total > 0 ? palette.accentFill : undefined}
          borderStyle="single"
          borderColor={total > 0 ? palette.accent : palette.line}
        >
          <Text color={total > 0 ? palette.accent : palette.text}>
            {total > 0 ? `◆ Filter (${total}) ▾` : "◇ Filter ▾"}
          </Text>
        </Box>
      </MouseTarget>

      {categories.map((category) => {
        const count = byCategory.get(category.id) ?? 0;
        const selectedValues = state.selected.get(category.id);
        const badgeText = formatFacetCategoryBadge(category, selectedValues);

        if (count === 0) return null;

        return (
          <Box
            key={category.id}
            marginRight={1}
            paddingX={1}
            borderStyle="single"
            borderColor={palette.accentSoft}
            backgroundColor={palette.surfaceActive}
          >
            <MouseTarget
              id={`filter:category:${category.id}`}
              onClick={() => onOpenFilter?.(category.id)}
            >
              <Text color={palette.text} bold>
                {category.title}:{" "}
              </Text>
              <Text color={palette.accent}>{badgeText}</Text>
            </MouseTarget>

            {onClearCategory ? (
              <MouseTarget
                id={`filter:clear:${category.id}`}
                onClick={() => onClearCategory(category.id)}
              >
                <Text color={palette.muted}> ×</Text>
              </MouseTarget>
            ) : null}
          </Box>
        );
      })}

      {total > 0 && onClearAll ? (
        <MouseTarget id="filter:reset-all" onClick={onClearAll}>
          <Box marginLeft={1}>
            <Text color={palette.dangerText}>[Clear all]</Text>
          </Box>
        </MouseTarget>
      ) : null}
    </Box>
  );
});
