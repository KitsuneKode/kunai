import { Box, Text } from "ink";
import React from "react";

import { PickerOptionRow } from "../overlay-picker-row";
import { ClaudeTabRow } from "../primitives/ClaudeTabRow";
import { StateBlock } from "../primitives/StateBlock";
import { palette } from "../shell-theme";
import { listSettingsSectionLabels } from "./build-page";
import { buildSettingsSubmenuView } from "./build-submenu";
import { SettingRowBoolean } from "./components/SettingRowBoolean";
import { SettingRowEnum } from "./components/SettingRowEnum";
import { SettingRowReorder } from "./components/SettingRowReorder";
import { SettingRowSubmenu } from "./components/SettingRowSubmenu";
import { SettingRowText } from "./components/SettingRowText";
import { SettingRowAction, SettingRowStatus, SettingSection } from "./components/SettingSection";
import { SettingsInputBanner } from "./components/SettingsInputBanner";
import { SettingsSearchBar } from "./components/SettingsSearchBar";
import { selectableSettingsRows, windowStart } from "./navigation";
import type { BuiltSettingsPage, SettingsRegistryContext, SettingsUiState } from "./types";

function renderMainRow(
  row: BuiltSettingsPage["rows"][number],
  selected: boolean,
  rowWidth: number,
): React.ReactNode {
  switch (row.def.kind) {
    case "section":
      return <SettingSection key={row.def.id} row={row} layout={row.def.layout} />;
    case "boolean":
      return (
        <SettingRowBoolean key={row.def.id} row={row} selected={selected} rowWidth={rowWidth} />
      );
    case "text":
      return <SettingRowText key={row.def.id} row={row} selected={selected} rowWidth={rowWidth} />;
    case "enum":
      return row.def.presentation === "segment" ? (
        <SettingRowEnum key={row.def.id} row={row} selected={selected} rowWidth={rowWidth} />
      ) : (
        <SettingRowSubmenu key={row.def.id} row={row} selected={selected} rowWidth={rowWidth} />
      );
    case "submenu":
      return (
        <SettingRowSubmenu key={row.def.id} row={row} selected={selected} rowWidth={rowWidth} />
      );
    case "reorder":
      return (
        <SettingRowReorder key={row.def.id} row={row} selected={selected} rowWidth={rowWidth} />
      );
    case "status":
      return <SettingRowStatus key={row.def.id} row={row} />;
    case "action":
      return (
        <SettingRowAction key={row.def.id} row={row} selected={selected} rowWidth={rowWidth} />
      );
    default:
      return null;
  }
}

export const SettingsOverlay = React.memo(function SettingsOverlay({
  page,
  state,
  registryCtx,
  width,
  maxRows,
  error,
  hideChromeTitle = false,
}: {
  readonly page: BuiltSettingsPage;
  readonly state: SettingsUiState;
  readonly registryCtx: SettingsRegistryContext;
  readonly width: number;
  readonly maxRows: number;
  readonly error: string | null;
  readonly hideChromeTitle?: boolean;
}) {
  const rowWidth = Math.max(24, width - 4);
  const sectionLabels = listSettingsSectionLabels(registryCtx);
  const showSectionTabs = sectionLabels.length > 1 && !state.searchQuery.trim();
  const inputDef =
    state.inputMode.active && state.inputMode.settingId
      ? page.defById.get(state.inputMode.settingId)
      : null;

  if (state.inputMode.active && inputDef?.kind === "text") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={palette.text} bold>
          {page.title}
        </Text>
        <Text color={palette.dim}>{page.subtitle}</Text>
        <SettingsInputBanner
          def={inputDef}
          buffer={state.inputMode.buffer}
          seed={state.inputMode.seed}
        />
        {error ? <Text color={palette.danger}>{error}</Text> : null}
      </Box>
    );
  }

  if (state.submenuId) {
    const submenu = buildSettingsSubmenuView(state.submenuId, registryCtx, page.defById);
    if (!submenu) return null;
    const start = windowStart(state.selectedIndex, submenu.choices.length, maxRows);
    const visible = submenu.choices.slice(start, start + maxRows);
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={palette.text} bold>
          {submenu.title}
        </Text>
        <Text color={palette.dim}>{submenu.subtitle}</Text>
        <Box marginTop={1} flexDirection="column">
          {start > 0 ? <Text color={palette.dim}> ▲ ...</Text> : null}
          {visible.map((choice, index) => {
            const absolute = start + index;
            const selected = absolute === state.selectedIndex;
            return (
              <Box key={choice.value} backgroundColor={selected ? palette.accentFill : undefined}>
                <Text color={selected ? palette.accent : palette.dim}>
                  {selected ? "▌ " : "  "}
                </Text>
                <PickerOptionRow
                  label={choice.label}
                  detail={choice.detail}
                  width={rowWidth - 2}
                  selected={selected}
                  accentColor={null}
                  pickerAccent={palette.accent}
                />
              </Box>
            );
          })}
          {start + maxRows < submenu.choices.length ? (
            <Text color={palette.dim}> ▼ ...</Text>
          ) : null}
        </Box>
        {error ? <Text color={palette.danger}>{error}</Text> : null}
      </Box>
    );
  }

  const selectableRows = selectableSettingsRows(page);
  if (state.searchQuery.trim() && selectableRows.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        {hideChromeTitle ? null : (
          <Text color={palette.text} bold>
            {page.title}
          </Text>
        )}
        <Text color={palette.dim}>{page.subtitle}</Text>
        <SettingsSearchBar query={state.searchQuery} />
        <Box marginTop={1}>
          <StateBlock
            model={{
              kind: "empty",
              title: `No settings match "${state.searchQuery.trim()}"`,
              detail: "Try another keyword or clear the filter with Backspace.",
            }}
            width={rowWidth}
          />
        </Box>
        {error ? <Text color={palette.danger}>{error}</Text> : null}
      </Box>
    );
  }

  const start = windowStart(state.selectedIndex, page.rows.length, maxRows);
  const visible = page.rows.slice(start, start + maxRows);

  return (
    <Box flexDirection="column" paddingX={1}>
      {hideChromeTitle ? null : (
        <Text color={palette.text} bold>
          {page.title}
        </Text>
      )}
      <Text color={palette.dim}>{page.subtitle}</Text>
      {showSectionTabs ? (
        <ClaudeTabRow
          labels={sectionLabels}
          activeIndex={state.activeSectionIndex}
          hint="Tab / Shift+Tab"
          maxWidth={rowWidth}
          dense
        />
      ) : null}
      <SettingsSearchBar query={state.searchQuery} />
      <Box marginTop={1} flexDirection="column">
        {start > 0 ? <Text color={palette.dim}> ▲ ...</Text> : null}
        {visible.map((row, index) => {
          const absolute = start + index;
          const selected = absolute === state.selectedIndex;
          if (row.def.kind === "section" || row.def.kind === "status") {
            return (
              <Box key={row.def.id} flexDirection="column">
                {renderMainRow(row, false, rowWidth)}
                {row.detail ? (
                  <Text color={palette.dim} dimColor>
                    {row.detail}
                  </Text>
                ) : null}
              </Box>
            );
          }
          return (
            <Box key={row.def.id} flexDirection="column">
              {renderMainRow(row, selected, rowWidth)}
              {selected && row.detail ? (
                <Text color={palette.dim} dimColor>
                  {`  ${row.detail}`}
                </Text>
              ) : null}
            </Box>
          );
        })}
        {start + maxRows < page.rows.length ? <Text color={palette.dim}> ▼ ...</Text> : null}
      </Box>
      {error ? <Text color={palette.danger}>{error}</Text> : null}
    </Box>
  );
});
