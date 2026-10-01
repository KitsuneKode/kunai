// =============================================================================
// use-idle-surface.ts — idle/home surface state + row choreography
//
// The idle surface is what browse shows before any search resolves: the local
// context loader (continue watching / queue next / offline-ready / release
// nudges), its load lifecycle (loading hint after a beat, request-gated so a
// superseded load can't resurrect a stale result), the post-history refresh
// listener, and the selected-row index with its arrow-key boundary semantics
// (↓ past the last row hands focus back to the query, ↑ from the first row
// escapes the surface). browse-shell used to hand-roll all of it inline —
// five state slots, two effects, and three key-handler blocks interleaved
// with search and list choreography. One hook owns it now; the shell keeps
// only the focus-zone translation of the returned intents.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import { createLatestRequestGate } from "./browse-async";
import { buildBrowseIdleReturnLoopModel, resolveIdleRowAction } from "./browse-idle-actions";
import { setBrowseIdleRefreshListener } from "./browse-idle-context";
import type { BrowseIdleContext, BrowseIdleContextLoader, ShellAction } from "./types";

/** Arrow-key outcome at the surface's focus boundary — the shell translates it. */
export type IdleSurfaceMove = "moved" | "exit-to-query" | "escape";

export type IdleSurfaceStatus = "loading" | "ready" | "error";

export function useIdleSurface(options: {
  /** Preloaded context — the async loader's answer may replace it. */
  readonly initial?: BrowseIdleContext;
  readonly load?: BrowseIdleContextLoader;
  /** Whether the idle rows own focus right now (focus-zone stays in the shell). */
  readonly idleFocused: boolean;
}) {
  const [context, setContext] = useState(options.initial);
  const [status, setStatus] = useState<IdleSurfaceStatus>(options.load ? "loading" : "ready");
  const [showLoadingHint, setShowLoadingHint] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [requestGate] = useState(() => createLatestRequestGate());

  // Load lifecycle: the gate wins over a slow earlier request, and the hint
  // only earns a render after a beat so a fast loader never flashes it.
  useEffect(() => {
    const load = options.load;
    if (!load) return;
    const request = requestGate.begin();
    let active = true;
    setStatus("loading");
    const timer = setTimeout(() => {
      if (active) setShowLoadingHint(true);
    }, 150);

    void (async () => {
      try {
        const next = await load();
        if (!active || !requestGate.isCurrent(request)) return;
        setSelectedIndex(0);
        setContext(next);
        setStatus("ready");
      } catch {
        if (!active || !requestGate.isCurrent(request)) return;
        setStatus("error");
      } finally {
        clearTimeout(timer);
        if (active) setShowLoadingHint(false);
      }
    })();

    return () => {
      active = false;
      clearTimeout(timer);
      requestGate.invalidate();
    };
  }, [requestGate, options.load]);

  // History mutations refresh the context best-effort — a failed refresh keeps
  // the last good rows rather than blanking the surface.
  useEffect(() => {
    const load = options.load;
    if (!load) return undefined;
    setBrowseIdleRefreshListener(() => {
      void (async () => {
        try {
          const next = await load();
          setContext(next);
        } catch {
          // best-effort refresh after history mutations
        }
      })();
    });
    return () => setBrowseIdleRefreshListener(null);
  }, [options.load]);

  const model = useMemo(
    () =>
      buildBrowseIdleReturnLoopModel(context, {
        idleFocused: options.idleFocused,
        selectedIndex,
      }),
    [context, options.idleFocused, selectedIndex],
  );

  // The title menu only makes sense when the focused row maps to a real title —
  // a nudge row under 'm' must not open a stale session's menu.
  const selectedRow = model?.rows[selectedIndex];
  const menuReady =
    options.idleFocused &&
    ((selectedRow?.id === "continue" && Boolean(context?.continueWatching?.titleId)) ||
      (selectedRow?.id === "playlist-next" && Boolean(context?.playlistNext?.titleId)));

  const selectedRowAction = useCallback((): ShellAction | null => {
    const row = model?.rows[selectedIndex];
    if (!row?.actionable) return null;
    return resolveIdleRowAction(row.id, context);
  }, [model, selectedIndex, context]);

  const moveDown = useCallback((): IdleSurfaceMove => {
    const lastIndex = (model?.rows.length ?? 0) - 1;
    if (lastIndex < 0 || selectedIndex >= lastIndex) {
      // Circle back to search — same exit as ↑ on the first row / Esc.
      setSelectedIndex(0);
      return "exit-to-query";
    }
    setSelectedIndex(selectedIndex + 1);
    return "moved";
  }, [model, selectedIndex]);

  const moveUp = useCallback((): IdleSurfaceMove => {
    if (selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
      return "moved";
    }
    return "escape";
  }, [selectedIndex]);

  return {
    context,
    status,
    showLoadingHint,
    selectedIndex,
    model,
    menuReady,
    selectedRowAction,
    moveDown,
    moveUp,
  };
}
