import type { LocalTitleEntry } from "@/domain/palette/local-title-index";
import type { SearchSuggestion } from "@/domain/search/suggestion-engine";
import type { ShellMode } from "@/domain/types";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { BrowseShell, type BrowseQueryDraft, type DetailsSheetLocalContext } from "./browse-shell";
import type { CalendarTypeTab } from "./calendar-ui.model";
import type { AppCommandId, ResolvedAppCommand } from "./commands";
import type { CalendarRouteRequest, CalendarSessionStatus } from "./hooks/use-calendar-route";
import { takePaletteTitleLaunch } from "./palette-title-launch";
import { mountRootContent } from "./root-content-state";
import type {
  BrowseIdleContextLoader,
  BrowseShellOption,
  BrowseShellResult,
  BrowseShellSearchResponse,
} from "./types";

export function openBrowseShell<T>({
  mode,
  provider,
  initialQuery,
  queryDraft: sharedQueryDraft,
  initialResults,
  initialResultSubtitle,
  initialErrorMessage,
  initialEmptyMessage,
  initialWarnings,
  initialSelectedIndex,
  initialCalendarTypeTab,
  initialCalendarRoute,
  startupPicks,
  placeholder,
  commands,
  onSearch,
  onLoadCalendar,
  onCalendarAccepted,
  onCalendarStatus,
  onLoadDiscovery,
  onLoadRecommendations,
  settings,
  onQueueSelected,
  onWatchlistSelected,
  onFavoriteSelected,
  isFavorite,
  onFollowSelected,
  onPlayTrailer,
  onOpenLink,
  onPrefetchOption,
  onUndo,
  onPaletteCommand,
  idleContext,
  loadIdleContext,
  onSuggest,
  loadLocalSuggestions,
  detailsContextFor,
  suggestionDebounceMs,
  localTitles,
  onTitlePick,
}: {
  mode: ShellMode;
  provider: string;
  initialQuery?: string;
  queryDraft?: BrowseQueryDraft;
  initialResults?: readonly BrowseShellOption<T>[];
  initialResultSubtitle?: string;
  initialErrorMessage?: string;
  /** The cause-named empty copy from a bootstrap search that found nothing. */
  initialEmptyMessage?: string;
  initialWarnings?: readonly string[];
  initialSelectedIndex?: number;
  initialCalendarTypeTab?: CalendarTypeTab;
  initialCalendarRoute?: CalendarRouteRequest;
  startupPicks?: boolean;
  placeholder: string;
  commands: readonly ResolvedAppCommand[];
  onSearch: (query: string) => Promise<BrowseShellSearchResponse<T>>;
  onLoadCalendar?: (signal: AbortSignal) => Promise<BrowseShellSearchResponse<T>>;
  onCalendarAccepted?: (
    request: CalendarRouteRequest,
    response: BrowseShellSearchResponse<T>,
  ) => void;
  /** Session status implied by non-success calendar route transitions. */
  onCalendarStatus?: (status: CalendarSessionStatus) => void;
  onLoadDiscovery?: () => Promise<BrowseShellSearchResponse<T>>;
  onLoadRecommendations?: (isCurrent: () => boolean) => Promise<BrowseShellSearchResponse<T>>;
  settings?: KitsuneConfig;
  onQueueSelected?: (value: T) => Promise<void> | void;
  onWatchlistSelected?: (value: T) => Promise<void> | void;
  /** Resolves to the message to flash, so add and remove can read differently. */
  onFavoriteSelected?: (value: T) => Promise<string | void> | string | void;
  /** Live lookup, re-read on every render so a toggle shows immediately. */
  isFavorite?: (value: T) => boolean;
  onFollowSelected?: (value: T) => Promise<void> | void;
  onPlayTrailer?: (url: string) => void;
  onOpenLink?: (url: string) => void;
  onPrefetchOption?: (value: T, signal: AbortSignal) => void;
  onUndo?: () => void;
  /** Fires when a command is picked from this shell's `/` palette. */
  onPaletteCommand?: (commandId: AppCommandId) => void;
  idleContext?: import("./types").BrowseIdleContext;
  loadIdleContext?: BrowseIdleContextLoader;
  onSuggest?: (query: string, signal: AbortSignal) => Promise<readonly SearchSuggestion<T>[]>;
  loadLocalSuggestions?: () => readonly SearchSuggestion<T>[];
  detailsContextFor?: (titleId: string) => DetailsSheetLocalContext;
  suggestionDebounceMs?: number;
  /** Local title source — consulted once per palette open for the JUMP TO section. */
  localTitles?: () => readonly LocalTitleEntry[];
  /** Enter landed on a JUMP TO title row. */
  onTitlePick?: (entry: LocalTitleEntry) => void;
}): Promise<BrowseShellResult<T>> {
  // A title picked from another surface (picker, loading) parks its launch
  // here; the next browse mount resolves it instead of rendering.
  const stagedLaunch = takePaletteTitleLaunch();
  if (stagedLaunch) {
    return Promise.resolve({ type: "launch-playback", launch: stagedLaunch });
  }
  const queryDraft = sharedQueryDraft ?? { value: initialQuery ?? "", mode };
  if (queryDraft.mode !== mode) {
    queryDraft.value = initialQuery ?? "";
    queryDraft.mode = mode;
  }
  const session = mountRootContent<BrowseShellResult<T>>({
    kind: "browse",
    renderContent: (finish) => (
      <BrowseShell
        mode={mode}
        provider={provider}
        initialQuery={initialQuery}
        queryDraft={queryDraft}
        initialResults={initialResults}
        initialResultSubtitle={initialResultSubtitle}
        initialErrorMessage={initialErrorMessage}
        initialEmptyMessage={initialEmptyMessage}
        initialWarnings={initialWarnings}
        initialSelectedIndex={initialSelectedIndex}
        initialCalendarTypeTab={initialCalendarTypeTab}
        initialCalendarRoute={initialCalendarRoute}
        startupPicks={startupPicks}
        placeholder={placeholder}
        commands={commands}
        onSearch={onSearch}
        onLoadCalendar={onLoadCalendar}
        onCalendarAccepted={onCalendarAccepted}
        onCalendarStatus={onCalendarStatus}
        onLoadDiscovery={onLoadDiscovery}
        onLoadRecommendations={onLoadRecommendations}
        settings={settings}
        onQueueSelected={onQueueSelected}
        onWatchlistSelected={onWatchlistSelected}
        onFavoriteSelected={onFavoriteSelected}
        isFavorite={isFavorite}
        onFollowSelected={onFollowSelected}
        onPlayTrailer={onPlayTrailer}
        onOpenLink={onOpenLink}
        onPrefetchOption={onPrefetchOption}
        onUndo={onUndo}
        onPaletteCommand={onPaletteCommand}
        idleContext={idleContext}
        loadIdleContext={loadIdleContext}
        onSuggest={onSuggest}
        loadLocalSuggestions={loadLocalSuggestions}
        detailsContextFor={detailsContextFor}
        suggestionDebounceMs={suggestionDebounceMs}
        localTitles={localTitles}
        onTitlePick={onTitlePick}
        onResolve={(action, value) =>
          finish(
            value !== undefined ? { type: "action", action, value } : { type: "action", action },
          )
        }
        onSubmit={(value) => finish({ type: "selected", value })}
        onCancel={() => finish({ type: "cancelled" })}
      />
    ),
    fallbackValue: { type: "cancelled" },
    // A picker a detached overlay workflow mounts over browse resolves the
    // mount as displaced, so SearchPhase remounts instead of reporting a
    // cancel the user never made.
    displacedValue: { type: "cancelled", displaced: true },
  });

  return session.result;
}
