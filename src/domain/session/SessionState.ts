// =============================================================================
// Session State Types
//
// Immutable session state with explicit transitions.
// =============================================================================

import type { TitleInfo, EpisodeInfo, StreamInfo } from "../types";

export type ShellMode = "series" | "anime";
export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "finished" | "error";

export interface SessionState {
  // Mode and context
  readonly mode: ShellMode;
  readonly provider: string;
  readonly subLang: string;
  
  // Selected content
  readonly currentTitle: TitleInfo | null;
  readonly currentEpisode: EpisodeInfo | null;
  
  // Playback state
  readonly stream: StreamInfo | null;
  readonly playbackStatus: PlaybackStatus;
  readonly playbackError: string | null;
  
  // Search UI state (ephemeral)
  readonly searchQuery: string;
  readonly searchResults: import("../types").SearchResult[];
  readonly searchState: "idle" | "loading" | "ready" | "error";
  readonly selectedResultIndex: number;
  
  // Modal stack (ephemeral)
  readonly activeModals: ModalState[];
}

export type ModalState =
  | { type: "settings" }
  | { type: "provider_picker"; currentProvider: string; isAnime: boolean }
  | { type: "subtitle_picker"; tracks: import("../types").SubtitleTrack[] }
  | { type: "confirm"; message: string };

// State transitions
export type StateTransition =
  | { type: "SET_MODE"; mode: ShellMode; provider: string }
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "SET_SEARCH_RESULTS"; results: import("../types").SearchResult[] }
  | { type: "SET_SEARCH_STATE"; state: "idle" | "loading" | "ready" | "error" }
  | { type: "SELECT_RESULT"; index: number }
  | { type: "SELECT_TITLE"; title: TitleInfo }
  | { type: "SELECT_EPISODE"; episode: EpisodeInfo }
  | { type: "SET_STREAM"; stream: StreamInfo | null }
  | { type: "SET_PLAYBACK_STATUS"; status: PlaybackStatus; error?: string }
  | { type: "PUSH_MODAL"; modal: ModalState }
  | { type: "POP_MODAL" }
  | { type: "CLOSE_ALL_MODALS" }
  | { type: "RESET_CONTENT" }
  | { type: "RESET_SEARCH" };

// Initial state factory
export function createInitialState(defaultProvider: string, defaultAnimeProvider: string): SessionState {
  return {
    mode: "series",
    provider: defaultProvider,
    subLang: "en",
    currentTitle: null,
    currentEpisode: null,
    stream: null,
    playbackStatus: "idle",
    playbackError: null,
    searchQuery: "",
    searchResults: [],
    searchState: "idle",
    selectedResultIndex: 0,
    activeModals: [],
  };
}

// State reducer (pure function)
export function reduceState(state: SessionState, transition: StateTransition): SessionState {
  switch (transition.type) {
    case "SET_MODE":
      return {
        ...state,
        mode: transition.mode,
        provider: transition.provider,
      };
    
    case "SET_SEARCH_QUERY":
      return {
        ...state,
        searchQuery: transition.query,
        searchState: transition.query.length < 2 ? "idle" : "loading",
      };
    
    case "SET_SEARCH_RESULTS":
      return {
        ...state,
        searchResults: transition.results,
        searchState: "ready",
        selectedResultIndex: 0,
      };
    
    case "SET_SEARCH_STATE":
      return { ...state, searchState: transition.state };
    
    case "SELECT_RESULT":
      return { ...state, selectedResultIndex: transition.index };
    
    case "SELECT_TITLE":
      return {
        ...state,
        currentTitle: transition.title,
        currentEpisode: null,
        stream: null,
        playbackStatus: "idle",
      };
    
    case "SELECT_EPISODE":
      return { ...state, currentEpisode: transition.episode };
    
    case "SET_STREAM":
      return { ...state, stream: transition.stream };
    
    case "SET_PLAYBACK_STATUS":
      return {
        ...state,
        playbackStatus: transition.status,
        playbackError: transition.error ?? null,
      };
    
    case "PUSH_MODAL":
      return { ...state, activeModals: [...state.activeModals, transition.modal] };
    
    case "POP_MODAL":
      return { ...state, activeModals: state.activeModals.slice(0, -1) };
    
    case "CLOSE_ALL_MODALS":
      return { ...state, activeModals: [] };
    
    case "RESET_CONTENT":
      return {
        ...state,
        currentTitle: null,
        currentEpisode: null,
        stream: null,
        playbackStatus: "idle",
        playbackError: null,
      };
    
    case "RESET_SEARCH":
      return {
        ...state,
        searchQuery: "",
        searchResults: [],
        searchState: "idle",
        selectedResultIndex: 0,
      };
    
    default:
      return state;
  }
}
