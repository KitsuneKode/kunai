# Cross-platform mpv IPC and playback parity

Status: **in progress** — core IPC + callers landed (`mpv-ipc-endpoint.ts`, `mpv-ipc.ts`, `PersistentMpvSession`, `launchMpv`, default bridge on Windows). Remaining: user-facing docs polish, optional CI on `windows-latest`, telemetry naming follow-ups.  
Owner: runtime / playback / platform  
Scope: Windows (and other non-Unix) **mpv JSON IPC** parity with today’s Unix-domain-socket path, persistent autoplay-chain behavior, bridge script loading, packaging story, and user-facing clarity so the product **feels the same quality everywhere** it is supported.

Related plans: [.plans/mpv-lifecycle-and-history-hardening.md](mpv-lifecycle-and-history-hardening.md) (teardown / reliability), [.plans/phase-2-playback-media-runtime.md](phase-2-playback-media-runtime.md) (media runtime direction), [.plans/kunai-playback-reliability-implementation.md](kunai-playback-reliability-implementation.md) (playback hardening).

---

## Why this exists

Previously, Kunai’s richest playback path assumed **Unix domain sockets** for mpv’s `--input-ipc-server`, and on **Windows** IPC was disabled (`ipcPath === null`), which blocked telemetry, skip overlay contract, and the default `kunai-bridge.lua` path.

**Now:** callers use `MpvIpcEndpoint` — Unix socket under `TMPDIR` / `TMP`, or a Windows named pipe (`//./pipe/kunai-mpv-…`) with **`Bun.connect({ unix: path })`** for the same newline JSON framing. `resolveKunaiMpvBridgeScriptPath` no longer short-circuits on `win32`.

Remaining gap is mostly **verification and messaging** (README / quickstart / diagnostics copy, optional Windows CI) so users rarely hit confusion around PATH vs IPC.

---

## Current state (honest matrix)


| Surface                              | Linux                           | macOS             | Windows (native)                                   | WSL (Linux guest)                          |
| ------------------------------------ | ------------------------------- | ----------------- | -------------------------------------------------- | ------------------------------------------ |
| One-shot `launchMpv`                 | IPC (Unix socket)               | Same              | IPC (named pipe)                                   | Same as Linux if Bun + mpv run in WSL      |
| Persistent `PersistentMpvSession`    | Full IPC + bridge               | Full IPC + bridge | Full IPC + default bridge (named pipe)             | Full IPC + bridge if both processes in WSL |
| Bridge mirror path (`mpvBridgePath`) | Written under Kunai `configDir` | Same              | Same as Linux/macOS once bundled path resolves   | Same as Linux in-guest                     |
| Package managers (Scoop, etc.)       | N/A                             | N/A               | Affects **PATH** only; does not fix IPC by itself  | User runs Linux binaries → Unix IPC        |


**WSL:** If the user runs Kunai **inside** WSL, the runtime is Linux; current IPC already applies. No extra work beyond docs (“native Windows vs WSL”). If we ever support **cross-boundary** Windows host ↔ WSL mpv, that is **out of scope** for this plan unless explicitly reopened.

---

## Goals

1. **Functional parity:** On Windows, persistent playback uses **mpv JSON IPC** over the **supported Windows transport** (named pipe), with the same command/observe protocol as today’s `mpv-ipc.ts` session.
2. **Single abstraction:** Callers (`PersistentMpvSession`, optionally `launchMpv`) depend on `MpvIpcTransport` (name TBD), not `unix: path` vs `pipe: name` details.
3. **Bridge parity:** Default `kunai-bridge.lua` resolution and `ensureUserKunaiMpvBridge` run on Windows once IPC is real; `mpvKunaiScriptPath` / `mpvKunaiScriptOpts` behavior unchanged.
4. **Reliability:** Socket/pipe bootstrap, teardown, and double-close behavior match the rigor already described in `mpv-lifecycle-and-history-hardening.md`.
5. **Discoverability:** README / quickstart / cli-reference state clearly: **what works on which OS**, how to install `mpv`, and that Scoop/Chocolatey/Winget are **PATH** concerns—not Kunai IPC substitutes.
6. **Verification:** Automated tests where feasible (mock transport or platform-gated integration); manual matrix for smoke.

## Non-goals (for this plan)

- Rewriting mpv’s JSON IPC protocol or switching to embedding libmpv.
- Supporting **arbitrary** mpv instances not spawned by Kunai (global hook model).
- **WSL↔Windows host** split-process playback.
- Changing provider/scraper behavior.

---

## Architecture direction

### 1. Transport abstraction

Introduce a small internal interface, e.g. `MpvIpcConnection` / `openMpvIpcSession` refactored to accept:

```text
type MpvIpcEndpoint =
  | { kind: "unix"; path: string }
  | { kind: "win32-pipe"; pipePath: string }; // exact shape after mpv manual / Bun capability research
```

**Implementation notes (engineering spike first):**

- **mpv:** Confirm the exact `--input-ipc-server` string format on Windows from the current mpv manual (named pipe naming rules differ from UDS paths).
- **Bun:** Confirm `Bun.connect` supports Windows named pipes for duplex newline-delimited framing identical to today’s Unix socket code path. If Bun gaps exist, fallback options are `node:net` for the pipe only (still inside CLI) or a tiny native helper—decide in spike, not here.

### 2. Session ownership unchanged

`PersistentMpvSession` keeps owning policy: `runReadyWork`, telemetry, skip timers, `user-data/*` contract with Lua. Only **bootstrap** (`waitFor…` + `open…`) and **mpv argv** generation branch by platform.

### 3. One-shot `launchMpv` (stretch but aligned)

Once transport exists, consider enabling IPC for **one-shot** playback on Windows too so telemetry and segment skip behavior match persistent mode where possible. Guard with the same health checks and feature flags if risk is non-zero.

---

## Phased execution

### Phase 0 — Spike and contract freeze (short)

- Read mpv manual section for **Windows IPC** (`--input-ipc-server`).
- Prove minimal **Bun** (or approved fallback) client can connect to mpv’s pipe and exchange a `get_property` / `observe_property` round-trip.
- Document the chosen pipe naming scheme (collision-resistant, per-session id, cleanup on crash).

**Exit:** ADR-style note in this plan file or `.docs/` (one page) recording the decision and any Bun limitation.

### Phase 1 — `mpv-ipc` refactor

- Split **framing** (buffer, newline JSON, dispatch) from **socket type**.
- Implement `openUnixMpvSession` + `openWin32PipeMpvSession` (names illustrative) behind `openMpvIpcSession(endpoint, handlers)`.
- `waitForMpvIpcReady(endpoint)` with shared backoff policy.
- Unit tests: framing/parser tests remain platform-agnostic; add **mock duplex stream** tests for dispatch + pending command drain (no real mpv required).

**Exit:** Typecheck green; tests green on Linux CI; Windows CI job if available runs at least the mock-level tests.

### Phase 2 — `PersistentMpvSession` + `mpv.ts` argv

- Replace `ipcPath: string | null` with `ipcEndpoint: MpvIpcEndpoint | null` (or keep string encoding if simpler—spike decides).
- On Windows: allocate pipe name, pass to `buildMpvArgs` / mpv spawn, connect after `waitFor…`.
- Remove or narrow the `win32 → null` fast-path once stable.
- Re-enable `resolveKunaiMpvBridgeScriptPath` default branch on Windows (keep explicit `mpvKunaiScriptPath` override semantics).

**Exit:** Manual smoke on Windows: autoplay chain, resume seek, skip chip, `N`/`P`, quit near end, diagnostics events still fire.

### Phase 3 — `launchMpv` parity (optional but “feels complete”)

- Same endpoint selection for one-shot launches.
- Confirm watchdog + telemetry paths behave; adjust `createPlayerTelemetryState` if `socketPath` naming was Unix-specific in logs.

**Exit:** One-shot and persistent telemetry field parity documented.

### Phase 4 — Packaging, PATH, and first-run UX

- **README / quickstart:** One subsection “Windows: install mpv (Scoop/Chocolatey/winget), ensure `mpv` on PATH; WSL users run Kunai inside WSL for Linux IPC.”
- **In-app diagnostics** (when playback fails): surface “mpv not found” vs “IPC bootstrap failed” with OS-specific hints (link to doc anchor).
- **Scoop manifest** (if/when maintained in-repo): document that Scoop installs **binaries**, not IPC; no false promise of “extra integration.”

**Exit:** New users rarely open GitHub issues for “skip chip missing on Windows” without an explanation in-product.

### Phase 5 — CI and regression gates

- Add or extend **integration test** seam: fake mpv is hard; prefer **transport unit tests** + optional **Windows runner** job (GitHub Actions `windows-latest`) running a tiny script that starts mpv with `--idle=yes` + IPC and sends one command (if license/headless constraints allow).
- Track **flaky IPC bootstrap** with retries and structured logs (`ipc-bootstrap` already exists—reuse taxonomy).

**Exit:** Regressions on either OS fail CI in a targeted way.

### Phase 6 — Polish and “feels great”

- Unified **debug** log line: `ipcTransport=unix|pipe`, `endpoint=…`, `bootstrapMs=…`.
- Confirm **no writes** to user’s global mpv config dir (stay with `--script` + `--script-opts` + Kunai `config.json`).
- UX copy pass: post-playback, settings, and help panels mention OS capabilities in **neutral** tone (not apologetic, not marketing).

**Exit:** Product review checklist signed off for Windows + macOS + Linux.

---

## Risk register


| Risk                                       | Mitigation                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Bun named-pipe support incomplete or buggy | Phase 0 spike; fallback to `node:net` for pipe only; keep protocol layer pure |
| mpv pipe naming / security expectations    | Follow mpv manual; use per-session random suffix; document                    |
| Antivirus / enterprise blocking pipes      | Diagnostics: clear error string; doc FAQ                                      |
| CI cannot run real mpv on Windows          | Rely on unit tests + periodic manual release checklist                        |
| Telemetry semantics drift between OS       | Shared `finalizePlaybackResult` tests with injected samples                   |


---

## Success metrics

- **Functional:** Windows persistent autoplay passes the same golden-path checklist as Linux (see [.plans/playback-golden-state-verifications.md](playback-golden-state-verifications.md) if maintained).
- **Support:** Reduction in “Windows skip chip / resume broken” reports after release notes ship.
- **Code:** Single IPC framing implementation; platform-specific code isolated to ≤2 files (`mpv-ipc-transport.ts` or similar).

---

## File touch list (expected)

- `apps/cli/src/infra/player/mpv-ipc.ts` (split / generalize)
- `apps/cli/src/infra/player/PersistentMpvSession.ts` (endpoint selection)
- `apps/cli/src/mpv.ts` (`launchMpv` IPC bootstrap)
- `apps/cli/src/infra/player/kunai-mpv-bridge.ts` (Windows default resolution)
- `.docs/cli-reference.md`, `.docs/quickstart.md`, `README.md` (accuracy pass)
- `apps/cli/test/unit/infra/player/` + possible new transport test module

---

## After this plan ships

Revisit **optional** enhancements: lower-latency observe batching, shared memory (not in mpv JSON IPC), or **daemon** model from architecture v2 docs—only if product direction requires it.

When active work begins on this plan, add a short “Implementation log” section at the bottom (date, decision, link to PR) the same way other `.plans/`* files evolve.