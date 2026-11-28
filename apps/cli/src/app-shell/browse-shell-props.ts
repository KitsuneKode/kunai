import type { CalendarTypeTab } from "@/app-shell/calendar-ui.model";
import type { AppCommandId, ResolvedAppCommand } from "@/app-shell/commands";
import type {
  DetailsSheetAvailability,
  DetailsSheetHistory,
} from "@/app-shell/details-sheet.model";
import type {
  CalendarRouteRequest,
  CalendarSessionStatus,
} from "@/app-shell/hooks/use-calendar-route";
import type {
  BrowseIdleContextLoader,
  BrowseShellOption,
  BrowseShellSearchResponse,
  ShellAction,
} from "@/app-shell/types";
import type { LocalTitleEntry } from "@/domain/palette/local-title-index";
import type { SearchSuggestion } from "@/domain/search/suggestion-engine";
import type { ShellMode } from "@/domain/types";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

export type BrowseQueryDraft = { value: string; mode: ShellMode };

export type DetailsSheetLocalContext = {
  readonly history: DetailsSheetHistory | null;
  readonly availability: DetailsSheetAvailability | null;
};

export type BrowseShellProps<T> = {
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
  /**
   * Present when this open IS the calendar route. Route identity comes from
   * here, never from whether the loaded options happen to contain calendar rows.
   */
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
  onResolve: (action: ShellAction, value?: T) => void;
  /** Enter landed on a JUMP TO title row. */
  onTitlePick?: (entry: LocalTitleEntry) => void;
  onSubmit: (value: T) => void;
  onCancel: () => void;
  /**
   * Dwell prefetch: fired ~500ms after a result row stops moving, warming what
   * Enter would pay (identity, detail, episode catalogs). Abortable via the
   * passed signal; silent by contract.
   */
  onPrefetchOption?: (value: T, signal: AbortSignal) => void;
  /**
   * `z` while a session-undo entry is live. Routed here (not the keybinding
   * registry) so overlays, command mode, and text focus each decide first —
   * the callback itself no-ops when nothing is journaled.
   */
  onUndo?: () => void;
  /** Fires when a command is picked from this shell's `/` palette. */
  onPaletteCommand?: (commandId: AppCommandId) => void;
  idleContext?: import("./types").BrowseIdleContext;
  loadIdleContext?: BrowseIdleContextLoader;
  /**
   * Fast catalog suggest for the type-ahead band — one registry-service call,
   * abortable; never the provider-lane search. Absent → local-only band.
   */
  onSuggest?: (query: string, signal: AbortSignal) => Promise<readonly SearchSuggestion<T>[]>;
  /** Sync local corpus read (watched / followed / lists / playlists). */
  loadLocalSuggestions?: () => readonly SearchSuggestion<T>[];
  /** Your progress and offline state for a title, for the details sheet. */
  detailsContextFor?: (titleId: string) => DetailsSheetLocalContext;
  /** Test seam: keystroke → catalog-fetch debounce. Defaults to the standard delay. */
  suggestionDebounceMs?: number;
  /** Local title source — consulted once per palette open for the JUMP TO section. */
  localTitles?: () => readonly LocalTitleEntry[];
};
