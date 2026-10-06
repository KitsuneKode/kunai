# R01 — Provider transport, selection and relay boundaries

Status: READY FOR ASSIGNMENT; no runtime implementation is claimed.
Baseline: `e5fd018af3d673d9dc10e866dabbf4428486ddb1`, 2026-10-01. Refresh before execution.
Execution policy, isolation, integration ownership and evidence: [runbook](./2026-10-01-execution-runbook.md).
Use the executing-plans workflow for implementation; delegate only when the assignment explicitly authorizes it.

**Global constraints:** Preserve unrelated changes. Use isolated HOME/USERPROFILE/XDG/APPDATA/LOCALAPPDATA roots, never KUNAI_CONFIG_DIR. No real-profile writes. Episode presentation is 1-based. Keep enforced package/layer directions. Analytics requires explicit consent; relay remains metadata-only with no bundled shared endpoint. Run fresh checks; record skips and native/external limits. No commit/publication/deployment is authorized by this plan.

**Goal:** Probe and ship the same permitted request, keep useful candidate fallbacks, and bound relay ingress.
**Architecture:** Existing ProviderFetchPort + verifyCandidateStream remain the authority; provider adapters supply facts, shared transport enforces request policy, relay adapters only host metadata RPC.
**Tech stack:** Bun, TypeScript, Bun fetch/DNS, provider fixtures, streamed Request bodies.
**Spec:** Audit A01/A07/A08/A09/A12/A13; [provider contracts](../.docs/providers.md), [boundary map](../.docs/runtime-boundary-map.md).
**Dependencies:** Independent. Coordinator owns any exported fetch contract.

## Review focus

1. AniDB passes headers/redirect/TLS/abort and actual local lookup to guarded fetching; mixed DNS/redirect fixtures test it.
2. Probe equality holds for every active adapter; success without a probe is rejected behaviorally.
3. One failed rendition cannot veto another valid request on the same host.
4. Declared relay capabilities match executable registry entries; unsupported cases are visible.
5. Chunked ingress stops at the byte cap and cancellation is propagated; no whole-body allocation.

## R01.1 — Repair the remaining guarded-fetch wrapper (A01)

Allowed edits: `packages/providers/src/anidb/client.ts`, `packages/providers/src/shared/stream-reachability.ts`, their existing tests; coordinator-reviewed `packages/core/src` fetch port if necessary. Keep e5999a22a's real timeoutMs budget and regressions. Do not reintroduce a 1 ms deadline.

- [ ] Read the current fetch port declaration and all implementations. Trace an HLS playlist probe through AniDB's wrapper to the real HTTPS request, including relay mode.
- [ ] Extend `packages/providers/test/stream-reachability.test.ts` and the AniDB test suite: delayed-but-in-budget DNS succeeds; private IPv4/IPv6/mixed answers fail; redirect to a private address fails; allowed redirect revalidates every hop; headers/Range and abort survive the wrapper. Hold lookup promises rather than sleeping.
- [ ] Replace the wrapper that accepts RequestInit and forwards only signal/context. Pass the complete guarded request through an implementation that genuinely supports local lookup, or fail closed when pinning cannot be enforced. Never declare resolvesLocally without that behavior.
- [ ] Preserve hostname authority for TLS/SNI while pinning addresses. Recheck public-address policy at each hop; remove origin credentials on cross-origin redirects. Keep HEAD/GET fallback under one deadline and cancellation.
- [ ] Record ownership per request path: direct local transport pins locally; user-owned relay metadata requests rely on relay transport enforcement. Never use relay for media.
- [ ] Qualify with a local controlled HTTPS server on a capable runner, including certificate-name mismatch and DNS answer changes. Mock-only passes do not prove TLS behavior.

## R01.2 — Candidate failures and resolve coverage (A08/A09/A12)

Allowed edits: `packages/providers/src/shared/stream-reachability.ts`, `packages/providers/src/shared/provider-cycle.ts`, `packages/providers/test/stream-reachability.test.ts`, `packages/providers/test/provider-resolve-gate-coverage.test.ts`; create `packages/providers/test/provider-cycle-failure-mapping.test.ts`.

- [ ] Add the regression: 1080p request returns 403; 720p on the same CDN returns 200; selected result is the verified 720p candidate. A second request with different authorization/Referer must also receive an independent decision.
- [ ] Replace hostname-wide suppression with request-scoped deduplication. Key by normalized URL, method and relevant headers/policy; keep sensitive header values in memory only. Keep genuinely transport-wide failures classified without converting every HTTP error into host death.
- [ ] Make failure mapping exhaustive over the typed union. These assertions must pass:

```ts
expect(providerFailureCodeFromCycleFailure("candidate-rate-limited")).toBe("rate-limited");
expect(providerFailureCodeFromCycleFailure("candidate-server-error")).toBe("network-error");
```

Use a typed Record or exhaustive switch. The current ResolveErrorCode union has
no server-error value: map to network-error and retain candidate-server-error
and HTTP status in existing trace evidence. Adding a new failure class must
cause a type error until its mapping is chosen; a new public error code would
require a separate shared schema/reader amendment.

- [ ] Keep the roster-derived/empty-roster coverage gate already landed. Add fixture-driven runtime cases for each production adapter that returns success: the shipped candidate was probed, failed probe prevents success, shipped request preserves required headers. Record YouTube/Miruro runtime exemptions with their actual alternate validation paths; do not remove necessary exemptions to satisfy a text test.
- [ ] Check quality, source, audio and user pinning semantics for anime/TMDB lanes; avoid replacing explicit preferences with silent fallback.

## R01.3 — Relay roster and bounded RPC (A07/A13)

Allowed edits: `apps/relay-server/src/provider-registry.ts`, `apps/relay-server/src/registry-drift.ts`, `apps/relay-server/scripts/dev-server.ts`, `packages/relay/src/handler.ts`, their unit/integration tests. Coordinate desktop capability changes in `apps/cli/src/container/bootstrap-providers.ts`.

- [ ] Exercise the actual handler for hianime, animegg, kickassanime, vidrock and movy; current advertised relay-safe entries must execute supported methods or cease advertising them. YouTube stays intentionally unsupported. Compare canonical metadata, not two hand-maintained lists.
- [ ] Add a chunked-body test yielding 16 KiB chunks beyond 64 KiB. Assert 413, reader cancellation, and no further consumption. Include multibyte UTF-8, absent/lying Content-Length, exact boundary, abort and invalid JSON.
- [ ] Authenticate before body processing where the existing contract allows. Read bytes incrementally with a shared cap; do not call request.text() first. Node and Bun adapters must use the same limit contract; add Bun server maxRequestBodySize as defense in depth without relying on it as the shared handler's only guard.
- [ ] Preserve existing fallback policy: unsupported provider RPC is explained to the user and handled according to the configured fallback contract. Do not silently switch transport or ship a hosted URL.

## Verification and closure

```sh
bun run --cwd packages/providers test
bun run --cwd packages/providers typecheck
bun run --cwd packages/relay test
bun run --cwd packages/relay typecheck
bun run --cwd apps/relay-server test
bun run --cwd apps/relay-server typecheck
bun run --cwd apps/cli test:file -- test/unit/architecture/boundary-imports.test.ts test/unit/services/providers/provider-registry.test.ts
```

Update owning provider/relay transport docs and relevant dossiers, then run runbook integration gates. Return a per-production-provider table: direct probe, relay support, behavioral regression, native HTTPS qualification, live qualification or explicit reason unqualified. Live checks are deliberate, low volume, separately authorized; this plan does not authorize contacting arbitrary provider endpoints.
