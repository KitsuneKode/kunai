import type { Container } from "@/container";
import { useInput } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildSettingsPage } from "./build-page";
import { SettingsFooter } from "./components/SettingsFooter";
import { handleSettingsKey } from "./controller";
import { isSettingVisible } from "./gates";
import { firstSelectableRowIndex } from "./navigation";
import { persistSettingsDraft } from "./persist";
import { buildSettingsRegistry } from "./registry";
import { buildSettingsRegistryContext } from "./registry-context";
import { settingsEqual } from "./settings-equal";
import { SettingsOverlay } from "./SettingsOverlay";
import { createSettingsUiState } from "./state";
import type { SettingsUiState } from "./types";

export function SettingsShell({
  container,
  width,
  maxRows,
  commandMode,
  initialSectionId,
  onClose,
  onStatus,
  onRedraw,
}: {
  readonly container: Container;
  readonly width: number;
  readonly maxRows: number;
  readonly commandMode: boolean;
  readonly initialSectionId?: string;
  readonly onClose: () => void;
  readonly onStatus: (message: string | null) => void;
  readonly onRedraw: () => void;
}) {
  const [state, setState] = useState<SettingsUiState>(() => {
    const base = createSettingsUiState(container.config.getRaw());
    const ctx = buildSettingsRegistryContext(container, base.draft);
    let activeSectionIndex = 0;
    if (initialSectionId) {
      const sections = buildSettingsRegistry(ctx)
        .filter((row) => isSettingVisible(row, ctx))
        .filter((row) => row.kind === "section");
      const idx = sections.findIndex((row) => row.id === initialSectionId);
      activeSectionIndex = idx >= 0 ? idx : 0;
    }
    // Row 0 is the section header (not focusable). Land on the first real setting
    // so the highlight is visible and Down doesn't skip past it.
    const page = buildSettingsPage(ctx, { activeSectionIndex });
    return {
      ...base,
      activeSectionIndex,
      selectedIndex: firstSelectableRowIndex(page),
    };
  });

  const registryCtx = useMemo(
    () => buildSettingsRegistryContext(container, state.draft),
    [container, state.draft],
  );

  const page = useMemo(
    () =>
      buildSettingsPage(registryCtx, {
        searchQuery: state.searchQuery,
        activeSectionIndex: state.activeSectionIndex,
      }),
    [registryCtx, state.searchQuery, state.activeSectionIndex],
  );

  const runAction = useCallback(
    async (actionId: string) => {
      const def = page.defById.get(actionId);
      if (!def || def.kind !== "action") {
        setState((current) => ({ ...current, busy: false }));
        return;
      }
      try {
        const message = await def.run(registryCtx);
        if (message) onStatus(message);
        if (def.id === "presenceConnection") {
          setState((current) => ({
            ...current,
            draft: container.config.getRaw(),
            busy: false,
            error: message ?? null,
          }));
          return;
        }
        setState((current) => ({ ...current, busy: false, error: message ?? null }));
      } catch (error) {
        setState((current) => ({
          ...current,
          busy: false,
          error: `Action failed: ${String(error)}`,
        }));
      }
    },
    [container, onStatus, page.defById, registryCtx],
  );

  useEffect(() => {
    if (settingsEqual(state.draft, container.config.getRaw())) return;
    const next = state.draft;
    const timer = setTimeout(() => {
      void persistSettingsDraft(container, next);
    }, 300);
    return () => clearTimeout(timer);
  }, [state.draft, container]);

  useInput(
    (input, key) => {
      if (commandMode) return;
      const result = handleSettingsKey(input, key, state, { container, registryCtx });
      if (!result.handled) return;

      setState(result.state);
      if (result.statusMessage !== undefined) {
        onStatus(result.statusMessage);
      }
      if (result.closeOverlay) {
        onClose();
        return;
      }
      if (result.persist === "immediate") {
        void persistSettingsDraft(container, result.state.draft);
      }
      if (result.runActionId) {
        void runAction(result.runActionId);
      }
      onRedraw();
    },
    { isActive: !commandMode },
  );

  const footerMode = state.inputMode.active ? "input" : state.submenuId ? "submenu" : "main";

  return (
    <>
      <SettingsOverlay
        page={page}
        state={state}
        registryCtx={registryCtx}
        width={width}
        maxRows={maxRows}
        error={state.error}
      />
      <SettingsFooter state={state} mode={footerMode} />
    </>
  );
}
