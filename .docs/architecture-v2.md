# KitsuneSnipe Architecture v2 (Refactored)

## Overview

This document describes the refactored architecture. For the legacy architecture, see `architecture.md`.

## Layer Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Entry Layer                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   CLI Args  │  │   Config    │  │   Logger    │  │   Telemetry/Tracing │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Application Layer (Orchestration)                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    SessionController                                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │ SearchPhase  │→ │ SelectPhase  │→ │ PlaybackPhase│                │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │   │
│  │         ↑________________________________↓                            │   │
│  │                    (mode toggle loops back)                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
┌─────────────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐
│    Search Service         │ │  Provider       │ │     Persistence         │
│    Registry               │ │  Registry       │ │     Layer               │
│  ┌─────────────────┐    │ │  ┌───────────┐  │ │  ┌─────────────────┐   │
│  │ Service: TMDB   │    │ │  │ Playwright│  │ │  │ ConfigStore     │   │
│  │ Service: HiAnime│    │ │  │ Api       │  │ │  │ HistoryStore    │   │
│  │ Service: Custom │    │ │  │ AnimeBase │  │ │  │ CacheStore      │   │
│  └─────────────────┘    │ │  └───────────┘  │ │  └─────────────────┘   │
└─────────────────────────┘ └─────────────────┘ └─────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Infrastructure Layer                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Shell      │  │    MPV      │  │   Browser   │  │    File Storage     │ │
│  │  (Ink)      │  │  (Player)   │  │(Playwright) │  │    (JSON)           │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phase 1: Foundation (Complete)

### Created Files

| File | Purpose |
|------|---------|
| `src/container.ts` | DI container with all service wiring |
| `src/domain/types.ts` | Core domain types (TitleInfo, EpisodeInfo, StreamInfo) |
| `src/domain/errors.ts` | Typed error taxonomy with recovery strategies |
| `src/domain/session/SessionState.ts` | Immutable session state with transitions |
| `src/domain/session/SessionStateManager.ts` | Centralized state management |
| `src/infra/logger/Logger.ts` | Logger interface |
| `src/infra/logger/StructuredLogger.ts` | Implementation with structured output |
| `src/infra/tracer/Tracer.ts` | Tracer interface |
| `src/infra/tracer/TracerImpl.ts` | Implementation with spans |
| `src/infra/storage/StorageService.ts` | Storage interface |
| `src/infra/storage/FileStorage.ts` | JSON file implementation |
| `src/infra/shell/ShellService.ts` | Shell interface |
| `src/infra/shell/ShellServiceImpl.ts` | Stub implementation |
| `src/infra/browser/BrowserService.ts` | Browser interface |
| `src/infra/browser/BrowserServiceImpl.ts` | Stub implementation |
| `src/infra/player/PlayerService.ts` | Player interface |
| `src/infra/player/PlayerServiceImpl.ts` | Stub implementation |
| `src/services/providers/Provider.ts` | Provider interface definition |
| `src/services/providers/ProviderRegistry.ts` | Registry with auto-discovery |
| `src/services/search/SearchService.ts` | Search service interface |
| `src/services/search/SearchRegistry.ts` | Registry with advisory coupling |
| `src/services/persistence/ConfigService.ts` | Config interface |
| `src/services/persistence/ConfigServiceImpl.ts` | Implementation |
| `src/services/persistence/ConfigStore.ts` | Store interface |
| `src/services/persistence/ConfigStoreImpl.ts` | File implementation |
| `src/services/persistence/HistoryStore.ts` | History interface |
| `src/services/persistence/HistoryStoreImpl.ts` | File implementation |
| `src/services/persistence/CacheStore.ts` | Cache interface |
| `src/services/persistence/CacheStoreImpl.ts` | File implementation |

### Bug Fix

- Fixed `openListShell` missing `waitUntilExit()` handler in `src/app-shell/ink-shell.tsx`

## Next Phases

### Phase 2: Domain Layer (In Progress)
- Define concrete Provider implementations
- Create provider adapters for existing providers
- Implement SearchService definitions

### Phase 3: Infrastructure (Pending)
- Integrate BrowserService with existing scraper.ts
- Integrate PlayerService with existing mpv.ts
- Build new search-first Ink shell

### Phase 4: Application Layer (Pending)
- Implement SessionController
- Build Phase classes (SearchPhase, PlaybackPhase)
- Wire up telemetry throughout

## Adding a New Provider

With this architecture, adding a provider requires only 1 file:

```typescript
// src/services/providers/definitions/myprovider.ts
export class MyProvider implements Provider {
  metadata = {
    id: "myprovider",
    name: "MyProvider",
    description: "Example provider",
    recommended: false,
    isAnimeProvider: false,
  };
  
  capabilities = { contentTypes: ["movie", "series"] };
  
  constructor(private deps: ProviderDeps) {}
  
  canHandle(title: TitleInfo): boolean {
    return true;
  }
  
  async resolveStream(request, signal): Promise<StreamInfo | null> {
    // Provider-specific logic
  }
}

// Add one line to src/services/providers/index.ts:
export const PROVIDER_DEFINITIONS = [
  // ... existing providers
  MyProvider,  // ← one line
];
```

## Key Design Decisions

1. **Constructor Injection**: All services receive dependencies through constructors
2. **Immutable Session State**: State transitions are explicit and logged
3. **Layer Boundaries**: Domain has no infrastructure dependencies
4. **Registry Pattern**: Auto-discovery through definition arrays
5. **Search-First UI**: Single persistent shell with modal overlays
