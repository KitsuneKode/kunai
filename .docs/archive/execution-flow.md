# Execution Flow Trace

This document traces a complete user session through the refactored architecture.

## Bootstrap Sequence

```
main.ts
  └── createContainer()
        ├── new StructuredLogger()              // No deps
        ├── new TracerImpl({ logger })          // Needs logger
        ├── new FileStorage()                   // No deps
        ├── new ConfigStoreImpl(storage)        // Needs storage
        ├── new HistoryStoreImpl(storage)       // Needs storage
        ├── new CacheStoreImpl(storage)         // Needs storage
        ├── ConfigServiceImpl.load(store)       // Async, loads user config
        ├── new SessionStateManager({ logger }) // Needs logger
        ├── new ShellServiceImpl({...})         // Needs logger, tracer, state
        ├── new BrowserServiceImpl({...})       // Needs logger, tracer, config
        ├── new PlayerServiceImpl({...})        // Needs logger, tracer
        ├── new ProviderRegistryImpl(deps, [])  // Empty for now (Phase 2)
        └── new SearchRegistryImpl(deps, [])    // Empty for now (Phase 2)
  └── SessionController.run(container)
```

## User Session: Searching for "Breaking Bad"

### Phase 1: Search

```
SessionController.run()
  └── tracer.span("session", ...)
        └── while (true)  // Outer loop
              └── SearchPhase.execute()
                    └── shell.showSearchInterface()

                          [UI State Update]
                          stateManager.dispatch({
                            type: "SET_SEARCH_STATE",
                            state: "loading"
                          })

                          └── searchService.search("Breaking Bad", signal)
                                └── fetch(db.videasy.net/3/search/multi?query=Breaking%20Bad)

                                [Success]
                                └── Returns SearchResult[]

                          [UI State Update]
                          stateManager.dispatch({
                            type: "SET_SEARCH_RESULTS",
                            results: [...]
                          })

                          [User navigates with arrows, presses Enter]

                          stateManager.dispatch({
                            type: "SELECT_TITLE",
                            title: {
                              id: "1396",
                              type: "series",
                              name: "Breaking Bad"
                            }
                          })

                    └── Returns TitleSelection
```

### Phase 2: Episode Selection

```
PlaybackPhase.execute(titleSelection)
  └── HistoryStore.get("1396")
        └── Returns: { season: 1, episode: 3, timestamp: 1245 }

  [User has history - show resume options]

  └── shell.showPlaybackStartOptions()
        [UI: Resume S1E3, Restart, Pick Episode, etc.]

  [User selects "Resume S1E3"]

  └── Returns EpisodeSelection: { season: 1, episode: 3 }
```

### Phase 3: Stream Resolution

```
PlaybackPhase (inner loop)
  └── providerRegistry.get("vidking")
        └── provider.resolveStream(
              { title: {id:"1396", type:"series"},
                episode: {season:1, episode:3} },
              signal
            )

              [Playwright Path]
              ├── buildUrl: "https://vidking.to/tv/1396-1-3"
              ├── BrowserService.scrape({ url, needsClick: false })
              │     ├── Launch Chromium
              │     ├── Navigate to URL
              │     ├── Intercept network for *.m3u8
              │     └── Return StreamInfo
              └── Returns StreamInfo

  [Cache for next episode]
  └── CacheStore.set(url, streamInfo)

  [UI State Update]
  stateManager.dispatch({
    type: "SET_STREAM",
    stream: streamInfo
  })
```

### Phase 4: Playback

```
  └── PlayerService.play(stream, {
        url: streamInfo.url,
        displayTitle: "Breaking Bad - S01E03",
        startAt: 1245,  // From history
        autoNext: true,
        onProgress: (seconds) => {
          // Live progress updates
          HistoryStore.updateProgress("1396", {
            season: 1,
            episode: 3,
            timestamp: seconds
          });
        }
      })

      [MPV Launches]
      └── mpv --start=1245 "stream.m3u8"

      [User watches to end]
      └── Returns: { watchedSeconds: 2847, duration: 2850, endReason: "eof" }

  [Save final position]
  └── HistoryStore.save("1396", {
        title: "Breaking Bad",
        type: "series",
        season: 1,
        episode: 3,
        timestamp: 2847,
        duration: 2850,
        provider: "vidking",
        watchedAt: "2026-04-22T01:15:00Z"
      })
```

### Phase 5: Post-Playback Decision

```
  [autoNext enabled, episode finished]

  [Inner loop continues]
  EpisodeSelection.episode = 4

  [Next iteration of inner loop]
  └── Pre-fetch next episode
        ├── providerRegistry.get("vidking")
        ├── buildUrl: "https://vidking.to/tv/1396-1-4"
        └── BrowserService.scrape({ url })  // Fire-and-forget

  [Resolve S1E4 using pre-fetched stream]
  └── provider.resolveStream({...episode:4})
        ├── Check CacheStore.get(url)  // Cache hit!
        └── Return cached StreamInfo

  [Play S1E4]
  └── PlayerService.play(stream, {...})
```

### Phase 6: Mode Switch

```
  [User presses 'a' - anime mode]

  [Break inner loop]
  PlaybackPhase returns: { type: "back_to_search" }

  [Outer loop continues]
  stateManager.dispatch({
    type: "SET_MODE",
    mode: "anime",
    provider: "allanime"
  })

  [Restart from SearchPhase]
  └── SearchPhase.execute()
        [UI resets to search with anime provider]
        └── searchService = searchRegistry.getForProvider("allanime")
        └── searchService.search("Demon Slayer", signal)
```

### Phase 7: Error Recovery

```
  [SearchPhase - Network error]

  searchService.search("Breaking Bad", signal)
    └── fetch() throws Error("ETIMEDOUT")

  [Error caught in tracer.span]
  span.addEvent("error", { message: "ETIMEDOUT" })

  [Phase error handler]
  SearchPhase.getRecoveryStrategy(error)
    └── Returns: { type: "retry", maxAttempts: 3, delayMs: 1000 }

  [SessionController applies recovery]
  await sleep(1000)
  Retry attempt 2/3...

  [Success on retry]
  Continue normally

  ── OR ──

  [All retries exhausted]
  shell.showError({
    title: "Search failed",
    message: "Could not reach TMDB search",
    actions: ["Retry", "Switch Provider", "Quit"]
  })

  [User selects "Switch Provider"]
  └── providerRegistry.getCompatible(title)
  └── Try next provider: "cineby"
```

## State Transitions During Session

```
Initial State
  mode: "series"
  provider: "vidking"
  currentTitle: null
  currentEpisode: null
  searchQuery: ""
  searchResults: []
  activeModals: []

After SET_SEARCH_QUERY "Breaking Bad"
  searchQuery: "Breaking Bad"
  searchState: "loading"

After SET_SEARCH_RESULTS
  searchResults: [{id:"1396", title:"Breaking Bad", ...}]
  searchState: "ready"
  selectedResultIndex: 0

After SELECT_TITLE
  currentTitle: {id:"1396", type:"series", name:"Breaking Bad"}
  currentEpisode: null
  stream: null

After SELECT_EPISODE (S1E3)
  currentEpisode: {season:1, episode:3, name:"...And the Bag's in the River"}

After SET_STREAM
  stream: {url:"https://cdn.example/stream.m3u8", headers:{...}}
  playbackStatus: "ready"

After SET_PLAYBACK_STATUS "playing"
  playbackStatus: "playing"

After RESET_CONTENT (user goes back)
  currentTitle: null
  currentEpisode: null
  stream: null
  searchQuery: "Breaking Bad"  // Preserved!
  searchResults: [...]          // Preserved!
```

## Tracing Output

```json
{
  "timestamp": "2026-04-22T01:10:00.000Z",
  "trace": {
    "id": "trace-abc123",
    "spans": [
      {
        "id": "span-1",
        "name": "session",
        "startTime": 1713738600000,
        "events": [
          { "name": "phase_start", "attributes": { "phase": "search" } },
          {
            "name": "phase_complete",
            "attributes": { "phase": "search", "selected_title": "1396" }
          },
          { "name": "phase_start", "attributes": { "phase": "playback" } },
          { "name": "provider_selected", "attributes": { "provider": "vidking" } },
          { "name": "stream_resolved", "attributes": { "url": "https://cdn.example/stream.m3u8" } },
          { "name": "playback_started", "attributes": { "startAt": 1245 } },
          { "name": "playback_complete", "attributes": { "watchedSeconds": 2847 } },
          { "name": "auto_next", "attributes": { "next_episode": 4 } }
        ]
      }
    ]
  }
}
```

## Key Flow Invariants

1. **State is immutable** - Every dispatch creates a new state object
2. **Transitions are logged** - Every state change is traceable
3. **Errors bubble with context** - Phase boundaries catch and recover
4. **Pre-fetch is transparent** - Next episode loads while current plays
5. **History is live-updated** - Progress saved during playback
6. **Cache respects TTL** - Stream URLs expire after 15 minutes
