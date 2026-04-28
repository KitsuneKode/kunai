// =============================================================================
// Shell Service Interface
//
// Manages the terminal UI (Ink-based).
// =============================================================================

import type { SearchResult, TitleInfo, EpisodeInfo, StreamInfo } from "../../domain/types";

export type ShellState =
  | { mode: "searching"; query: string; results: SearchResult[]; selectedIndex: number }
  | { mode: "detail"; title: TitleInfo; selectedAction: string }
  | { mode: "episodes"; title: TitleInfo; episodes: EpisodeInfo[]; selectedIndex: number }
  | { mode: "playback_loading"; title: TitleInfo; episode: EpisodeInfo }
  | { mode: "playback_ready"; title: TitleInfo; episode: EpisodeInfo; stream: StreamInfo }
  | { mode: "playback_error"; title: TitleInfo; episode: EpisodeInfo; error: string };

export type ModalType =
  | { type: "settings" }
  | { type: "provider_picker"; currentProvider: string; isAnime: boolean }
  | { type: "subtitle_picker"; tracks: import("../../domain/types").SubtitleTrack[] }
  | { type: "confirm"; message: string; onConfirm: () => void };

export interface ShellService {
  // State management
  setState(state: ShellState): void;
  getState(): ShellState;

  // Search interface
  setSearchQuery(query: string): void;
  setSearchResults(results: SearchResult[]): void;
  setSearchState(state: "idle" | "loading" | "ready" | "error", error?: string): void;

  // Modal system
  pushModal(modal: ModalType): void;
  popModal(): void;
  closeAllModals(): void;

  // User input (returns promise that resolves on selection)
  waitForSelection<T>(): Promise<T | null>;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
}
