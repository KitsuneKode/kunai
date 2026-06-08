# CLI Playback UX Hardening

Status: **Phase 0–3 + verification landed** (2026-06-08); Phase 4 provider opts deferred after smoke gate  
Coordinates: playback correctness, bootstrap UX, series-loop polish.

Related plans (do not duplicate):

- [kunai-playback-reliability-implementation.md](./kunai-playback-reliability-implementation.md) — mpv lifecycle, HLS materialization, terminal input routing
- [daily-use-ux-discovery-and-runtime-hardening.md](./daily-use-ux-discovery-and-runtime-hardening.md) — M8 playback/bootstrap subset defers here
- [vidking-videasy-health-and-sources-implementation.md](./vidking-videasy-health-and-sources-implementation.md) — sources UX **implemented**; this plan extends correctness + bootstrap only

---

## Problem

Three layers fail independently:

1. **Provider correctness** — stale cache keys, session token expiry, Vidlink missing resolve-gate probe.
2. **Bootstrap UX** — 15 granular stages in `playback-startup-timeline.ts` never reach Ink; `ink-shell.tsx` maps coarse `playbackStatus` while rail still shows misleading **"Stream"** labels.
3. **Series loop** — autoplay/recovery exist but messaging, telemetry, and web parity are not cohesive.

---

## Truth table

| ID                     | Item                                                     | Status                             |
| ---------------------- | -------------------------------------------------------- | ---------------------------------- |
| p0-land-fixes          | mb-flix, flavors, catalog order, cache purge, `o` source | **Done** (`cfcb36cf` … `b07c84bc`) |
| p1-segment-probe       | HLS manifest + first-segment probe (Videasy)             | **Done**                           |
| p1-hls-materializer    | Host-root playlist materialize + mpv whitelist           | **Done** (`2a983e0c`)              |
| p1-playback-input      | `playback-shell-input` + deferred HLS cleanup            | **Done** (`525c6e61`)              |
| p1-cache-keys          | `videasyAppId` + `apiRoute` cache facets + invalidation  | **Done**                           |
| p1-vidlink-probe       | Resolve-gate segment probe for Vidlink                   | **Done**                           |
| p1-session-token       | Videasy session lifecycle UX                             | **Open** (deferred)                |
| p2-bootstrap-presenter | Timeline → shell view model                              | **Done**                           |
| p2-loading-copy        | Honest rail labels + slow-phase copy                     | **Done**                           |
| p2-stall-recovery      | 45s bootstrap-stall classification                       | **Done**                           |
| p2-footer-go-parity    | Footer vs GO hint alignment                              | **Done**                           |
| p3-source-parity       | Neon naming, bootstrap inventory summary                 | **Done**                           |
| p4-provider-opt        | Server race, enc-dec cache                               | **Open** (after smoke)             |
| p5-verify-docs         | VERIFICATION.md smoke script                             | **Done**                           |

---

## Architecture boundaries

Per `.docs/runtime-boundary-map.md` and `.docs/playback-source-inventory-contract.md`:

| Layer                       | Owns                          | This plan adds                                 |
| --------------------------- | ----------------------------- | ---------------------------------------------- |
| `packages/providers`        | Scrape, headers, reachability | Vidlink probe; evidence `apiRoute` in metadata |
| `packages/core`             | Cache key policy              | `videasyAppId`, `apiRoute` facets              |
| `apps/cli/.../playback`     | Resolve, inventory            | Bootstrap presenter; stall policy              |
| `apps/cli/src/app`          | Phases, user intent           | Timeline → presenter; purge (done)             |
| `apps/cli/src/app-shell`    | Ink only                      | 5-step rail, honest copy                       |
| `apps/cli/src/infra/player` | mpv mechanics                 | Cleanup lifetime (done)                        |

---

## Videasy route decision

- **Code:** `bc-frontend` + `mb-flix` → `["mb-flix", "e3b0c442"]` in `resolveVideasyRequestServers`.
- **Field parity:** Study Group `tmdb=233347` needs `mb-flix` first for 3-quality ladder.
- **Research:** Cineplay player bundle may prefer `e3b0c442` on some titles — per-title preference belongs in Phase 4 server preference, not a single global route.
- **Cache:** `apiRoute` must be in cache key parts so ORG-only stale payloads cannot resurrect.

---

## Phase 0 — Landed (complete)

Reference only. Gate: Study Group S01E02 — 3 qualities, Cineplay referer, mpv plays, `r/f/d` from terminal during stall.

---

## Phase 1 — Provider correctness

### 1A-core — Cache key hardening

- Extend `ProviderCacheKeyInput` with `videasyAppId`, `apiRoute`.
- Wire Videasy `createProviderCachePolicy` calls.
- Auto-invalidate on `videasyAppId` migration and ORG-only cache hit.

### 1B — Vidlink resolve-gate probe

- `runStreamHealthCheck({ phase: "resolve-gate" })` before return; `streamReachabilityVerified: true`.

### 1C / 1D — Deferred

Session token lifecycle and server preference store — Phase 4 follow-up.

---

## Phase 2 — Bootstrap UX

### 2A — `PlaybackBootstrapPresenter`

`apps/cli/src/app/playback-bootstrap-presenter.ts` maps startup timeline + `playbackStatus` → `BootstrapShellViewModel`.

### 2B — Loading shell copy

Honest rail labels; dominant phase after 10s; `resolveStageFromOperation` fix.

### 2C — Bootstrap stall recovery

45s after `subtitle-attached` without `first-progress` → `bootstrap-stall` issue.

### 2D — Footer vs GO parity

Document overflow behind `/`; align quality key to `k`.

---

## Phase 3 — Series loop

Neon display naming; bootstrap inventory summary; lazy probes on `o` only.

---

## Phase 4 — Provider optimizations (after smoke)

Videasy server race, Vidlink enc-dec cache, anime HealthTracker — **out of scope for this pass**.

---

## Phase 5 — Verification

See [VERIFICATION.md](../VERIFICATION.md) — Study Group smoke script.

---

## Success criteria

1. Cineplay titles match web quality ladder; stale ORG-only cache cannot survive appId/route change.
2. Bootstrap shows which phase is slow; diagnostics include route + phase timings.
3. Purge / source / fallback without quit; advertised keys work.
4. Auto-next and upcoming copy are honest.
5. No provider logic in Ink; no UI policy in `packages/providers`.
