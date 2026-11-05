import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";

import { MouseTarget } from "../mouse/MouseRegions";
import { palette } from "../shell-theme";
import {
  clearAllFacets,
  clearCategoryFacets,
  filterCategoriesByQuery,
  isFacetOptionSelected,
  toggleFacetOption,
  type FacetedFilterCategory,
  type FacetedFilterState,
} from "./faceted-filter.model";

export interface FacetedFilterModalProps<T = string> {
  readonly categories: readonly FacetedFilterCategory<T>[];
  readonly state: FacetedFilterState<T>;
  readonly width?: number;
  readonly height?: number;
  readonly onApply: (newState: FacetedFilterState<T>) => void;
  readonly onCancel: () => void;
  readonly title?: string;
}

interface FlatOptionEntry<T> {
  readonly category: FacetedFilterCategory<T>;
  readonly optionIndex: number;
}

/**
 * Interactive faceted filter popover modal matching shadcn DataTableFacetedFilter.
 */
export const FacetedFilterModal = React.memo(function FacetedFilterModal<T = string>({
  categories,
  state: initialState,
  width = 54,
  onApply,
  onCancel,
  title = "Filter options",
}: FacetedFilterModalProps<T>) {
  const [currentState, setCurrentState] = useState<FacetedFilterState<T>>(initialState);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCategories = useMemo(
    () => filterCategoriesByQuery(categories, searchQuery),
    [categories, searchQuery],
  );

  const flatOptions = useMemo<readonly FlatOptionEntry<T>[]>(() => {
    const list: FlatOptionEntry<T>[] = [];
    for (const cat of filteredCategories) {
      for (let i = 0; i < cat.options.length; i++) {
        list.push({ category: cat, optionIndex: i });
      }
    }
    return list;
  }, [filteredCategories]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      onApply(currentState);
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : flatOptions.length - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < flatOptions.length - 1 ? prev + 1 : 0));
      return;
    }

    const currentEntry = flatOptions[selectedIndex];

    if (input === " " && currentEntry) {
      const opt = currentEntry.category.options[currentEntry.optionIndex];
      if (opt) {
        setCurrentState((prev) =>
          toggleFacetOption(
            prev,
            currentEntry.category.id,
            opt.value,
            currentEntry.category.singleSelect,
          ),
        );
      }
      return;
    }

    if (input === "c" && currentEntry) {
      setCurrentState((prev) => clearCategoryFacets(prev, currentEntry.category.id));
      return;
    }

    if (input === "C") {
      setCurrentState((prev) => clearAllFacets(prev));
      return;
    }

    if (key.backspace || key.delete) {
      setSearchQuery((prev) => prev.slice(0, -1));
      setSelectedIndex(0);
      return;
    }

    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
      setSearchQuery((prev) => prev + input);
      setSelectedIndex(0);
    }
  });

  let runningFlatIndex = 0;

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={palette.accent}
      paddingX={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text color={palette.text} bold>
          {title}
        </Text>
        <Text color={palette.muted}>[Esc: close · Enter: apply]</Text>
      </Box>

      <Box borderStyle="single" borderColor={palette.line} paddingX={1} marginBottom={1}>
        <Text color={palette.accent}>⌕ </Text>
        <Text color={searchQuery ? palette.text : palette.muted}>
          {searchQuery || "Search facets (e.g. 1080, japanese)..."}
        </Text>
      </Box>

      {filteredCategories.length === 0 ? (
        <Box paddingY={1}>
          <Text color={palette.muted}>No matching filter options found.</Text>
        </Box>
      ) : (
        filteredCategories.map((category) => (
          <Box key={category.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={palette.muted} bold>
                {category.icon ? `${category.icon} ` : ""}
                {category.title.toUpperCase()}
              </Text>
            </Box>

            {category.options.map((opt) => {
              const flatIdx = runningFlatIndex++;
              const isFocused = flatIdx === selectedIndex;
              const isSelected = isFacetOptionSelected(currentState, category.id, opt.value);

              return (
                <MouseTarget
                  key={`${category.id}:${String(opt.value)}`}
                  id={`facet:${category.id}:${String(opt.value)}`}
                  onClick={() => {
                    setCurrentState((prev) =>
                      toggleFacetOption(prev, category.id, opt.value, category.singleSelect),
                    );
                    setSelectedIndex(flatIdx);
                  }}
                >
                  <Box
                    backgroundColor={isFocused ? palette.accentFill : undefined}
                    justifyContent="space-between"
                    paddingX={1}
                  >
                    <Box>
                      <Text color={isSelected ? palette.accent : palette.muted}>
                        {isSelected ? "[✓] " : "[ ] "}
                      </Text>
                      <Text
                        color={
                          isFocused ? palette.accent : isSelected ? palette.text : palette.textDim
                        }
                        bold={isFocused || isSelected}
                      >
                        {opt.label}
                      </Text>
                    </Box>

                    {opt.count !== undefined ? (
                      <Text color={palette.muted}>({opt.count})</Text>
                    ) : null}
                  </Box>
                </MouseTarget>
              );
            })}
          </Box>
        ))
      )}

      <Box borderStyle="single" borderColor={palette.lineSoft} paddingX={1} marginTop={1}>
        <Text color={palette.dim}>Space: toggle · c: clear category · C: reset all · ⏎ apply</Text>
      </Box>
    </Box>
  );
});
