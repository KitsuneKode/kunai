# Search Service Refactor Plan

Status: Deferred

Use this only when decoupling search backends from provider implementations.

## Problem

Today, `TMDB_SERVICE` exists as a standalone search service, but `CinebyAnime` still owns its own search behavior. That means provider choice can change search results instead of only changing stream resolution.

## Target

Move search ownership into `src/search.ts` so providers declare compatibility rather than implementing search directly.

## Desired Shape

```ts
CinebyAnime.compatibleSearchServices = ["hianime"];

HIANIME_SERVICE: SearchService = {
  id: "hianime",
  search(query) {
    /* ... */
  },
};

const service = selectSearchService(currentProvider, isAnime);
const results = await service.search(query);
```

## Changes

### `src/search.ts`

- add `HIANIME_SERVICE`
- register all available services centrally
- add service-selection logic

### `src/providers/types.ts`

- replace `searchBackend` with `compatibleSearchServices`

### `src/providers/cineby-anime.ts`

- remove provider-owned search
- declare compatibility instead

### `index.ts`

- select the search service before running search
- stop calling provider-local search directly

## Why Deferred

The current shallow abstraction is good enough to ship. This becomes worth doing when:

- the user wants search results independent from provider choice
- another search backend is being added
- anime search parity becomes a recurring maintenance pain
