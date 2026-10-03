// =============================================================================
// use-browse-overlay.ts — details overlay state, focus stash, and key
// choreography
//
// The details sheet is the only overlay browse-shell opens itself — the
// pickers in the BrowseOverlay union belong to other shells. What the shell
// used to hand-roll inline:
//
//   • `activeOverlay` plus the focus-zone stash that restores the pre-overlay
//     zone on close (the list stays "under" the sheet so Esc lands back on the
//     highlighted row, not in the search field);
//   • `detailRequestGate` — the seeded sheet paints instantly from cache, then
//     a cold-cache TMDB detail fetch gap-fills it; a superseded or closed
//     sheet must not resurrect a stale fetch into a new overlay;
//   • the overlay key block — every keypress is consumed while a sheet is up:
//     Esc closes, Enter submits the highlighted row, s toggles seasons, t/l
//     fire trailer/link callbacks, w/q/d hand mutations back to the shell.
//
// The hook owns all of it and returns intents. The shell keeps only the
// parts that are genuinely its own — `onSubmit`/`onResolve`/prop callbacks,
// `setFocusZone` restore semantics, and the mutation feedback wrapper.
// =============================================================================

import type { SearchResult } from "@/domain/types";
import { fetchTitleDetail, peekTitleDetail } from "@/services/catalog/TitleDetailService";
import { useCallback, useRef, useState } from "react";

import { createLatestRequestGate } from "./browse-async";
import type { BrowseFocusZone } from "./browse-focus-zone";
import { resolveDetailsOverlaySubmitValue } from "./browse-search-state";
import { buildBrowseDetailsSheetSeed } from "./browse-shell-view";
import { buildBrowseDetailsPanel } from "./details-panel";
import { buildDetailsSheet } from "./details-sheet.model";
import type { LineEditorKey } from "./line-editor";
import type { BrowseOverlay } from "./overlay-panel";
import type { BrowseShellOption, ShellMode } from "./types";

/**
 * What the shell does with a keypress the overlay saw. Everything overlay-open
 * swallows is `consumed`; the variants name the shell-owned action to run.
 * `closed` carries the focus zone stashed at open time (null when none was
 * stashed — the shell then picks the fallback).
 */
export type BrowseOverlayIntent<T> =
  | { readonly kind: "ignored" }
  | { readonly kind: "consumed" }
  | { readonly kind: "closed"; readonly restoreTo: BrowseFocusZone | null }
  | { readonly kind: "submit"; readonly value: T }
  | { readonly kind: "trailer"; readonly url: string }
  | { readonly kind: "link"; readonly url: string }
  | { readonly kind: "watchlist"; readonly option: BrowseShellOption<T> }
  | { readonly kind: "queue"; readonly option: BrowseShellOption<T> }
  | { readonly kind: "download"; readonly option: BrowseShellOption<T> };

export function useBrowseOverlay<T>(input: { readonly mode: ShellMode }) {
  const [current, setCurrent] = useState<BrowseOverlay | null>(null);
  const focusZoneBeforeOverlayRef = useRef<BrowseFocusZone | null>(null);
  const [detailRequestGate] = useState(() => createLatestRequestGate());

  /**
   * Open the details sheet for a browse option. `focusZone` is stashed so
   * close can restore it; the palette close is the caller's job (the shell
   * owns palette state).
   */
  const openDetails = useCallback(
    (
      option: BrowseShellOption<T> | undefined,
      ctx: { readonly focusZone: BrowseFocusZone; readonly origin?: "notification" },
    ) => {
      if (!option) return;
      const detailRequestId = detailRequestGate.begin();
      const panel = buildBrowseDetailsPanel(option);
      focusZoneBeforeOverlayRef.current = ctx.focusZone;
      // Keep list ownership under the sheet so close restores the highlighted
      // row, not a forced dump into the search field.

      const seed = buildBrowseDetailsSheetSeed(option);
      // SAFETY: option.value carries the origin row payload the sheet seed
      // reads; Partial lets absent fields degrade cleanly.
      const value = option.value as Partial<SearchResult>;
      const titleId = typeof value?.id === "string" ? value.id : undefined;
      const cached = titleId ? (peekTitleDetail(titleId, seed.type) ?? null) : null;

      setCurrent({
        type: "details",
        // SAFETY: the details overlay only reads shared option fields; the
        // generic row payload stays opaque downstream.
        option: option as BrowseShellOption<unknown>,
        origin: ctx.origin,
        title: panel.title,
        subtitle: panel.subtitle,
        lines: [],
        sheet: buildDetailsSheet({ seed, detail: cached, history: null, availability: null }),
        seasonsExpanded: false,
        imageUrl: panel.imageUrl,
        loading: false,
        scrollIndex: 0,
      });

      // Gap-fill only when cold (peek miss); the fetch rides the shared TMDB cache.
      if (titleId && !cached) {
        void (async () => {
          try {
            const detail = await fetchTitleDetail(titleId, seed.type, undefined, {
              externalIds: value?.externalIds,
              isAnime: input.mode === "anime" || value?.isAnime === true,
            });
            setCurrent((overlay) =>
              detailRequestGate.isCurrent(detailRequestId) && overlay && overlay.type === "details"
                ? {
                    ...overlay,
                    sheet: buildDetailsSheet({
                      seed,
                      detail,
                      history: null,
                      availability: null,
                      seasonsExpanded: overlay.seasonsExpanded,
                    }),
                  }
                : overlay,
            );
          } catch {
            // best-effort; the seeded header/synopsis stay, skeletons resolve to "—"
          }
        })();
      }
    },
    [detailRequestGate, input.mode],
  );

  /**
   * Every key is consumed while a sheet is up. Esc closes inside the hook and
   * returns the stashed zone; everything else either mutates the sheet
   * (s/arrows) or comes back as a named intent for the shell to run.
   */
  const handleKey = useCallback(
    (
      keyInput: string,
      key: LineEditorKey,
      ctx: {
        readonly selectedOption?: BrowseShellOption<T> | null;
        readonly searchReady: boolean;
      },
    ): BrowseOverlayIntent<T> => {
      const overlay = current;
      if (!overlay) return { kind: "ignored" };
      if (keyInput === "/") return { kind: "consumed" };

      if (key.escape) {
        detailRequestGate.invalidate();
        setCurrent(null);
        const restoreTo = focusZoneBeforeOverlayRef.current;
        focusZoneBeforeOverlayRef.current = null;
        return { kind: "closed", restoreTo };
      }

      // A details sheet belongs to the option that opened it — the live list
      // selection may have moved on (filter, notification-opened sheet).
      const detailsOption =
        overlay.type === "details"
          ? // SAFETY: a details overlay always stores a BrowseShellOption — the
            // cast recovers it; ?? covers the absent case.
            ((overlay.option as BrowseShellOption<T> | undefined) ?? ctx.selectedOption ?? null)
          : null;

      if (key.return && overlay.type === "details") {
        // A notification-opened sheet carries its own option and has no live
        // search behind it — searchReady gates Enter for result-opened sheets
        // only.
        const value = resolveDetailsOverlaySubmitValue({
          detailsOpen: true,
          searchReady: ctx.searchReady || overlay.origin === "notification",
          option: detailsOption,
        });
        return value !== null ? { kind: "submit", value } : { kind: "consumed" };
      }

      if (overlay.type === "details" && overlay.sheet) {
        const letter = keyInput.toLowerCase();
        if (letter === "s") {
          setCurrent((active) =>
            active && active.type === "details"
              ? { ...active, seasonsExpanded: !active.seasonsExpanded }
              : active,
          );
          return { kind: "consumed" };
        }
        if (letter === "t" && overlay.sheet.trailerUrl) {
          return { kind: "trailer", url: overlay.sheet.trailerUrl };
        }
        if (letter === "l" && overlay.sheet.links.items[0]) {
          return { kind: "link", url: overlay.sheet.links.items[0].url };
        }
        // Sheet-footer mutations — the shell owns the prop callbacks; the hook
        // only reports that the user asked, carrying the sheet's own option.
        if (letter === "w" && detailsOption) {
          return { kind: "watchlist", option: detailsOption };
        }
        if (letter === "q" && detailsOption) {
          return { kind: "queue", option: detailsOption };
        }
        if (
          letter === "d" &&
          detailsOption &&
          (ctx.searchReady || overlay.origin === "notification")
        ) {
          return { kind: "download", option: detailsOption };
        }
      }

      if (overlay.type === "episode-picker") {
        return { kind: "consumed" };
      }

      if ("lines" in overlay && (key.upArrow || key.downArrow) && !overlay.loading) {
        if (overlay.lines.length === 0) return { kind: "consumed" };
        const maxScroll = Math.max(0, overlay.lines.length - 1);
        const nextScroll = key.upArrow
          ? Math.max(0, (overlay.scrollIndex ?? 0) - 1)
          : Math.min(maxScroll, (overlay.scrollIndex ?? 0) + 1);
        setCurrent({ ...overlay, scrollIndex: nextScroll });
      }
      return { kind: "consumed" };
    },
    [current, detailRequestGate],
  );

  return { current, openDetails, handleKey };
}
