---
updated: 2026-04-22T01:17:00+05:30
branch: main
session_name: 'KitsuneSnipe Refactor Phase 1 - Foundation'
context_pressure: medium
---

## Done

- **Bug fix**: `openListShell` missing `waitUntilExit()` added @ `src/app-shell/ink-shell.tsx:562`
- **Domain layer**: Types (`src/domain/types.ts`), errors (`src/domain/errors.ts`), session state (`src/domain/session/SessionState.ts` + `SessionStateManager.ts`)
- **DI Container**: Full container with 16 services wired @ `src/container.ts:76`
- **Infrastructure**: Interfaces + stubs for Logger, Tracer, Shell, Browser, Player, Storage (all under `src/infra/`)
- **Service layer**: Provider/Search registries, Config/History/Cache stores (under `src/services/`)
- **Docs**: Architecture v2 (`docs/architecture-v2.md`), execution flow trace (`docs/execution-flow.md`)

## In Progress

- Phase 2: **Provider adapters** - Need to adapt existing providers (VidKing, Cineby, AllAnime, Braflix, etc.) to new `Provider` interface
- Phase 2: **Search services** - Need to adapt `searchVideasy()` and AllAnime search to new `SearchService` interface
- Phase 2: **Registry population** - Container has `[]` for provider/search definitions - wire them in

## Blocked

- None. Typecheck passes. All stubs compile.

## Next

### Phase 2: Domain Integration (Start here)

- [ ] **Create provider adapters**:
  - `src/services/providers/definitions/vidking.ts` - Wrap existing `src/providers/vidking.ts` into new `Provider` interface
  - `src/services/providers/definitions/cineby.ts`
  - `src/services/providers/definitions/bitcine.ts`
  - `src/services/providers/definitions/braflix.ts` (API provider)
  - `src/services/providers/definitions/allanime.ts` (API provider)
  - `src/services/providers/definitions/cineby-anime.ts` (API provider)
  
- [ ] **Create `src/services/providers/index.ts`** with `PROVIDER_DEFINITIONS` array
  - Export all definitions as `PROVIDER_DEFINITIONS = [VidKingDef, CinebyDef, ...]`
  - Wire into container @ `src/container.ts:103-106`

- [ ] **Create search service implementations**:
  - `src/services/search/definitions/tmdb.ts` - Wrap `src/search.ts:searchVideasy()` into `SearchService`
  - `src/services/search/definitions/allanime.ts` - Wrap AllAnime GraphQL search
  - 
- [ ] **Create `src/services/search/index.ts`** with `SEARCH_SERVICE_DEFINITIONS` array
  - Wire into container @ `src/container.ts:108-111`

### Phase 3: Infrastructure Integration

- [ ] **ShellServiceImpl**: Replace stubs with real Ink components from `src/app-shell/`
- [ ] **BrowserServiceImpl**: Delegate to existing `src/scraper.ts`
- [ ] **PlayerServiceImpl**: Delegate to existing `src/mpv.ts`
- [ ] **Storage**: Replace in-memory with real file paths (`~/.config/kitsunesnipe/`)

### Phase 4: Application Layer

- [ ] **SessionController**: Implement outer loop with phase orchestration
- [ ] **SearchPhase**: Implement search-first UI flow
- [ ] **PlaybackPhase**: Implement stream resolve + MPV + post-playback loop

## Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| DI pattern | Constructor injection | Testable, explicit deps |
| State | Immutable snapshots | Debuggable, traceable transitions |
| Provider registration | Explicit list in `index.ts` | Type-safe, no dynamic imports |
| Search coupling | Advisory (`compatibleProviders`) | TMDB results work with VidKing/Cineby |
| Error recovery | Conservative | Don't auto-switch providers without asking |
| UI | Search-first, full-screen | No "press enter to search" gate |

## Key Files

```
src/container.ts                          # DI container - start here for wiring
src/domain/types.ts                       # Core domain types
src/domain/errors.ts                      # Error taxonomy
src/domain/session/SessionState.ts        # State transitions (pure reducer)
src/domain/session/SessionStateManager.ts # State manager with logging
src/services/providers/Provider.ts        # Provider interface
src/services/providers/ProviderRegistry.ts # Registry implementation
src/services/search/SearchService.ts      # Search service interface
src/services/search/SearchRegistry.ts     # Registry implementation
src/infra/shell/ShellService.ts           # Shell interface
src/infra/browser/BrowserService.ts     # Browser interface
src/infra/player/PlayerService.ts       # Player interface
src/infra/logger/Logger.ts              # Logger interface
src/infra/tracer/Tracer.ts              # Tracer interface

# Existing providers to adapt:
src/providers/index.ts                  # Current provider registry
src/providers/vidking.ts                # Playwright provider
src/providers/cineby.ts                 # Playwright provider
src/providers/bitcine.ts                # Playwright provider
src/providers/braflix.ts                # API provider
src/providers/allanime.ts               # API provider (anime)
src/providers/cineby-anime.ts           # API provider (anime)
src/search.ts                           # TMDB search
src/scraper.ts                          # Playwright scraping
src/mpv.ts                              # MPV integration

# Documentation:
.docs/architecture-v2.md                # New architecture overview
.docs/execution-flow.md                 # Full session trace
.plans/kitsunesnipe-refactor-v2-6c53df.md # Master plan
AGENTS.md                               # Repo guide (entry point rules)
```

## How to Adapt an Existing Provider

Example pattern for VidKing (Playwright):

```typescript
// src/services/providers/definitions/vidking.ts
export class VidKingProvider implements Provider {
  metadata = { id: "vidking", name: "VidKing", ... };
  capabilities = { contentTypes: ["movie", "series"] };
  
  constructor(private deps: ProviderDeps) {}
  
  canHandle(title: TitleInfo): boolean {
    return title.type === "movie" || title.type === "series";
  }
  
  async resolveStream(request, signal): Promise<StreamInfo | null> {
    const url = title.type === "movie"
      ? `https://vidking.to/movie/${title.id}`
      : `https://vidking.to/tv/${title.id}-${request.episode.season}-${request.episode.episode}`;
    
    return this.deps.browser.scrape({ url, signal });
  }
}
```

Then add `VidKingProvider` to `PROVIDER_DEFINITIONS` array.
