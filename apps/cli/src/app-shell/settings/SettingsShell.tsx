import type { Container } from "@/container";
import { getDesignThemeName, setDesignTheme } from "@kunai/design";
import { useInput } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildSettingsPage } from "./build-page";
import { buildSettingsSubmenuView } from "./build-submenu";
import { SettingsFooter } from "./components/SettingsFooter";
import { handleSettingsKey } from "./controller";
import { isSettingVisible } from "./gates";
import { clampSelectedIndex, firstSelectableRowIndex } from "./navigation";
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
  hideChromeTitle = false,
  onClose,
  onStatus,
  onRedraw,
}: {
  readonly container: Container;
  readonly width: number;
  readonly maxRows: number;
  readonly commandMode: boolean;
  readonly initialSectionId?: string;
  /** When framed by AppHeader, skip the in-body "Settings" title band. */
  readonly hideChromeTitle?: boolean;
  readonly onClose: () => void;
  readonly onStatus: (message: string | null) => void;
  readonly onRedraw: () => void;
}) {
  const actionAbortRef = useRef<AbortController | null>(null);
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

  /**
   * Actions change things the draft cannot see.
   *
   * Connecting a tracker mutates adapter state, not config — so a context
   * memoized on the draft alone kept reporting "not connected" after a
   * successful connect. `revision` is bumped whenever an action completes,
   * which is exactly when out-of-band state may have moved.
   */
  const registryCtx = useMemo(() => {
    // Read so the dependency is honest: its only job is to re-run this after an
    // action, which is when adapter state the draft cannot see may have moved.
    void state.revision;
    return buildSettingsRegistryContext(container, state.draft);
  }, [container, state.draft, state.revision]);

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
        setState((current) => ({ ...current, busy: false, activeActionId: null }));
        return;
      }
      const controller = new AbortController();
      actionAbortRef.current = controller;
      try {
        const message = await def.run(registryCtx, {
          signal: controller.signal,
          onStatus,
        });
        if (message) onStatus(message);
        // An action's message is its result, not a failure. Storing it in
        // `error` is what painted "Connected to AniList as @you." in red.
        setState((current) => ({
          ...current,
          draft: container.config.getRaw(),
          busy: false,
          activeActionId: null,
          error: null,
          revision: current.revision + 1,
        }));
      } catch (error) {
        if (controller.signal.aborted) {
          onStatus("Action cancelled.");
          setState((current) => ({
            ...current,
            busy: false,
            activeActionId: null,
            error: null,
          }));
          return;
        }
        setState((current) => ({
          ...current,
          busy: false,
          activeActionId: null,
          error: `Action failed: ${String(error)}`,
        }));
      } finally {
        if (actionAbortRef.current === controller) actionAbortRef.current = null;
      }
    },
    [container, onStatus, page.defById, registryCtx],
  );

  // A failed save must reach the user and the support bundle, not vanish into
  // a void promise: settings silently not sticking is otherwise undiagnosable.
  const persistedDraftRef = useRef(state.draft);
  const persistChainRef = useRef<Promise<void> | null>(null);
  const saveDraft = useCallback(
    (draft: SettingsUiState["draft"], phase: "editing" | "closing") => {
      const write = (persistChainRef.current ?? Promise.resolve()).then(async () => {
        try {
          await persistSettingsDraft(container, draft, persistedDraftRef.current);
          persistedDraftRef.current = draft;
        } catch (error) {
          // Normalize a rejection at the persistence boundary; rendering and
          // diagnostics consume the message rather than arbitrary throw values.
          const detail = error instanceof Error ? error.message : String(error);
          container.diagnosticsService.record({
            category: "session",
            message:
              phase === "closing"
                ? "Settings draft lost on close: final persist failed"
                : "Settings persist failed",
            context: { error: detail },
          });
          if (phase === "editing") {
            setState((current) => ({ ...current, error: `Couldn't save settings: ${detail}` }));
          }
        }
      });
      persistChainRef.current = write;
      return write;
    },
    [container],
  );

  // The debounced save below dies with the shell: exiting settings within
  // 300ms of the last edit silently dropped the draft. Flush best-effort on
  // unmount; persistSettingsDraft no-ops when nothing changed.
  const draftRef = useRef(state.draft);
  /** Theme active before a submenu preview began — restored on Esc/unmount. */
  const themePreviewOriginRef = useRef<string | null>(null);
  useEffect(() => {
    draftRef.current = state.draft;
  }, [state.draft]);
  useEffect(
    () => () => {
      void saveDraft(draftRef.current, "closing");
      // Preview is transient; only a confirmed choice persists the theme.
      if (themePreviewOriginRef.current !== null) {
        setDesignTheme(themePreviewOriginRef.current);
        themePreviewOriginRef.current = null;
      }
    },
    [saveDraft],
  );

  useEffect(() => {
    if (settingsEqual(state.draft, container.config.getRaw())) return;
    const next = state.draft;
    const timer = setTimeout(() => {
      void saveDraft(next, "editing");
    }, 300);
    return () => clearTimeout(timer);
  }, [state.draft, container, saveDraft]);

  useEffect(() => () => actionAbortRef.current?.abort(), []);

  useInput(
    (input, key) => {
      if (commandMode) return;
      if (state.busy && (key.escape || input.toLowerCase() === "q")) {
        const activeDef = state.activeActionId ? page.defById.get(state.activeActionId) : null;
        if (activeDef?.kind === "action" && activeDef.cancellable) {
          actionAbortRef.current?.abort();
          onStatus("Cancelling…");
          onRedraw();
        }
        return;
      }
      const result = handleSettingsKey(input, key, state, { container, registryCtx });
      if (!result.handled) return;

      // Theme live preview: while the theme enum submenu is open, repaint on
      // highlight so the whole shell shows the palette, not a swatch. On
      // close, Enter's persist applies the pick; Esc restores the theme that
      // was active before previewing — `KUNAI_THEME`'s mask included.
      if (result.state.submenuId === "theme") {
        const submenu = buildSettingsSubmenuView("theme", registryCtx, page.defById);
        const choice =
          submenu?.choices[clampSelectedIndex(result.state.selectedIndex, submenu.choices.length)];
        if (choice && choice.value !== getDesignThemeName()) {
          if (themePreviewOriginRef.current === null) {
            themePreviewOriginRef.current = getDesignThemeName();
          }
          setDesignTheme(choice.value);
        }
      } else if (state.submenuId === "theme") {
        const origin = themePreviewOriginRef.current;
        themePreviewOriginRef.current = null;
        setDesignTheme(
          result.persist ? result.state.draft.theme : (origin ?? result.state.draft.theme),
        );
      }

      setState(result.state);
      if (result.statusMessage !== undefined) {
        onStatus(result.statusMessage);
      }
      if (result.closeOverlay) {
        onClose();
        return;
      }
      if (result.persist === "immediate") {
        void saveDraft(result.state.draft, "editing");
      }
      if (result.runActionId) {
        void runAction(result.runActionId);
      }
      onRedraw();
    },
    { isActive: !commandMode },
  );

  const footerMode = state.inputMode.active
    ? "input"
    : state.submenuId
      ? "submenu"
      : state.searchFocused
        ? "search"
        : "main";

  return (
    <>
      <SettingsOverlay
        page={page}
        state={state}
        registryCtx={registryCtx}
        width={width}
        maxRows={maxRows}
        error={state.error}
        hideChromeTitle={hideChromeTitle}
      />
      <SettingsFooter state={state} mode={footerMode} />
    </>
  );
}
