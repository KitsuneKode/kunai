# TMDB API v4 Migration Plan

## Status

**Priority:** Low
**Reason:** TMDB v3 is not deprecated; no deprecation timeline announced

## Current State

Kunai uses TMDB API v3 in three places:

1. **Catalog/Metadata** (`apps/cli/src/tmdb.ts`, `services/catalog/tmdb-proxy.ts`)
   - Base: `https://api.themoviedb.org/3`
   - Uses public API key
   - Has fallback chain (Videasy proxy → direct → alias)
   - Uses for season summaries, episode lists, show metadata

2. **Account Sync** (`apps/cli/src/services/sync/TmdbAdapter.ts`)
   - Base: `https://api.themoviedb.org/3`
   - Uses user session tokens
   - v3 authentication flow
   - Used for watchlist and favorite membership

3. **ARM Integration** (`apps/cli/src/services/catalog/arm-client.ts`)
   - Uses ARM's API, not direct TMDB
   - No migration needed

## v4 vs v3 Differences

### Authentication

- **v3:** `api_key` query parameter
- **v4:** Bearer token (`Authorization: Bearer ACCESS_TOKEN`)
- **Note:** v4 Bearer token works for both v3 and v4

### Endpoints

- **v3:** `/3/...`
- **v4:** `/4/...`

### New v4 Features

- Mixed-type lists (movies + TV together)
- Private lists
- Unlimited imports
- More sort options
- Comments per item

## Migration Options

### Option 1: Minimal Migration (Recommended)

- Add v4 Bearer token support alongside v3
- Keep using v3 endpoints
- **Effort:** 4-6 hours
- **Risk:** Low
- **Benefit:** Future-proof without breaking changes

### Option 2: Full Migration

- Migrate catalog to v4 endpoints
- Rewrite account sync to v4 auth flow
- **Effort:** 2-3 days
- **Risk:** Medium
- **Benefit:** Access to v4-only features

### Option 3: Do Nothing (Current)

- v3 is actively maintained
- No deprecation timeline
- **Effort:** 0 hours
- **Risk:** None

## Recommendation

**Do nothing for now.** Rationale:

1. **v3 is not deprecated** - TMDB maintains both versions
2. **No new features needed** - Kunai's use cases are covered by v3
3. **Account sync would need significant rewrite** - v4 auth flow is different
4. **No urgency** - no deprecation timeline announced

## When to Consider Migration

Trigger migration when any of these occur:

1. **TMDB announces v3 deprecation** with a sunset date
2. **New v4-only features are needed** (e.g., private user lists)
3. **Significant performance improvements** are documented for v4
4. **v3-specific bugs** appear that are fixed in v4

## Migration Work (When Triggered)

### Catalog/Metadata Path

1. Update `TMDB_DIRECT_BASE` from `/3` to `/4`
2. Add Bearer token header instead of `api_key` query param
3. Test all endpoints:
   - `/tv/{id}` - show details
   - `/tv/{id}/season/{season}` - episode lists
   - `/tv/{id}/season/{season}?language={lang}` - localized episodes
4. Verify data structure compatibility
5. Update documentation

### Account Sync Path

1. Change authentication flow to v4:
   - v4 uses `/auth/access` instead of `/authenticate`
   - v4 requires user authentication (OAuth-like flow)
   - v4 has different token structure (request token → access token)
2. Rewrite `TmdbAdapter.ts` authentication methods
3. Update OAuth callback handling
4. Test full sync flow
5. Update user-facing error messages

### ARM Integration

- No changes needed (uses ARM's API)

## Testing Checklist

When migration is executed:

- [ ] All catalog tests pass
- [ ] All account sync tests pass
- [ ] Smoke tests for catalog metadata
- [ ] Smoke tests for account linking
- [ ] Verify no data loss in existing user accounts
- [ ] Performance regression tests
- [ ] Documentation updated

## References

- TMDB v4 docs: https://developer.themoviedb.org/v4/docs/getting-started
- TMDB v3 vs v4 lists: https://developer.themoviedb.org/reference/v3-or-v4-lists
- TMDB authentication: https://developer.themoviedb.org/v4/docs/authentication-application
