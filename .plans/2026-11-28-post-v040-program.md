---
status: active
lastReviewed: "2026-11-28T16:30:33Z"
---

# Post-v0.4.0 program and verification checklist

> Agent-facing (L3). The working list after the 2026-11-28 merge train. An
> agent picking this up should verify each item against the code and GitHub
> before acting; the code and the PR state win over this file.

## 1. State at the time of writing (2026-11-28)

- `main` is **frozen** at `878ab55` until v0.4.0 publishes. The publish job
  refuses when the release commit is not the tip of `origin/main`
  (`publication SHA … is not current origin/main`). The first approved run
  (46130672173 on `85c09b9`) refused for this reason and published nothing.
- Release run **46164940745** on `878ab55`, with provider signoff 46164836456
  (signoff valid for 24 hours). It publishes once a maintainer approves
  `release-production`.
- npm: both Android names were bootstrapped by the owner
  (`0.0.0-bootstrap.0`, dist-tag `bootstrap`) and given trusted publishers
  (`KitsuneKode/kunai`, `release.yml`, `release-production`).

Merged on 2026-11-28: #857 (shell v4 items 1, 2, 3, 5, 10, 11, 12), #872
(#746, #742, #743), #873 (#871), #874 (#864), #875 (#848), #876 (item 8),
#878 (item 16), #879 (v0.4.0 notes).

## 2. Open PRs: merge order after v0.4.0 publishes

Merge one at a time. Each PR re-pins `NPM_BUNDLE_BUDGET_KB` and
`file-size-baseline.json` against a different parent, so before each merge:
`git merge origin/main` into the PR, rebuild, set the budget to the smallest
whole KiB over the measured `dist/kunai.js`, lower baselines only, and rerun
`test:agent` + `test:unit` under `CI=true`.

| Order | PR                        | What                                                                                                                    | Blocker                                                                                                                                 |
| ----- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | #880                      | Shell v4 item 15: settings effect timing, one-line rows, env-lock reason, live-reader audit                             | None (reviewed); merge main first                                                                                                       |
| 2     | #877                      | Shell v4 item 4: ConfirmStrip + Esc stack                                                                               | 15 CodeRabbit threads (Ctrl+Y confirms, wrong-row submit, History stuck `executing`, arrow cancel without move, …) — queued on Cursor-1 |
| 3     | item 14 PR (not open yet) | Offline-first: local shelf, disabled online commands with a reason, cached calendar, `waiting for connection` downloads | Devin-2 in progress                                                                                                                     |
| 4     | item 17 PR (not open yet) | Now Playing: `▸ playing` header, framed poster tile, GO strip                                                           | Cursor-1 in progress                                                                                                                    |
| 5     | #856                      | Kanna alive                                                                                                             | 7 CodeRabbit threads (sprite upload races, `a=f` continuation chunks) + 7 conflicts — queued on Devin-2 after item 14                   |
| —     | #760                      | Sumi & Sakura web skin                                                                                                  | Maintainer decision: rewrite copy for the add-on direction                                                                              |
| —     | #716                      | Docs SEO / llms.txt                                                                                                     | Maintainer decision: hold until the direction is settled                                                                                |

## 3. Release verification (run after publish)

Each check names its pass condition. Record evidence (command + output) in
the release qualification note under `.release/`.

1. **npm channel**: `npm view @kitsunekode/kunai@0.4.0 version` and the same
   for all ten platform packages listed in `RELEASING.md` (each returns
   `0.4.0`). `npm i -g @kitsunekode/kunai@0.4.0` on Linux, then `kunai --version`
   prints `0.4.0`.
2. **Native installers**: in a throwaway `KUNAI_CONFIG_DIR`, `install.sh` on
   Debian/Ubuntu, Fedora, Arch, Alpine (musl) and macOS; `install.ps1` on
   Windows. Pass: `kunai --version` and `kunai doctor` exit 0. Then `kunai
   upgrade` / rollback on one platform.
3. **Windows binary** (never hand-tested this cycle): play one movie and one
   series episode through mpv, then VLC; check that a native install whose data
   folder is named `data` starts (#864); `kunai --version` from a profile payload.
4. **Physical Android (Termux)**: follow `.docs/mobile-device-lab.md`
   (Android sections) and `.docs/release-reliability-gate.md` → "Android
   terminal preview gate". Pass: the mobile host proof evidence JSON with
   `terminal: termux`, VLC handoff through `termux-am`/`am`, resume after a
   relaunch. Until this passes, keep Termux labelled a **preview** in
   `docs/users/mobile-preview.mdx` and the README.
5. **iPhone (a-Shell)**: same lab doc, iPhone sections. Preview only.
6. **Manual smoke** from `.docs/release-reliability-gate.md` → "Manual Smoke",
   on a real terminal (kitty or Ghostty) at 120×32 and 40×20: search → details
   → play → post-play → next episode; offline library; command palette `/sm`
   and `/frieren`; the failed-start panel (kill the stream); Settings at 40
   columns.
7. **Provider reality**: `bun run test:live:allmanga-crypto` (red since
   2026-11-23, #724; follow `.docs/provider-dossiers/allmanga.md`).

## 4. Remaining shell v4 items

From `.reference/design/cli/shell-v4-implementation-map.md`:

- **Item 9** — `PlainQuietPolicy`: no redraw chatter or timers under
  `KUNAI_PLAIN`/screen readers; enforced by a coverage test like
  motion-policy-coverage. Functional debounces must not be gated.
- **Item 13** — `OverlayListChrome` for History, Up Next, Notifications,
  Diagnostics, Help, Guide, Library, Downloads. Needs item 4 (#877) merged.
  Assign `root-overlay-shell.tsx` to this one owner only (two parallel PRs
  extracted the same component on 2026-11-28).
- **Item 18** — narrow `DownloadConfirmation` rows and Library
  partial/repairable badges. Needs item 9.
- **Item 6 leftovers** — verify what #854 did not cover.

## 5. Follow-ups found in review (not yet filed)

- `CatalogDiscoveryService` still has a hand-rolled generation counter;
  move it to `infra/concurrency/cache-generation.ts` (#872 follow-up).
- Failover banner: no real mpv/VLC mid-stream stall and no anime-lane play
  was driven (#876). Add a fake-mpv mid-stream death mode and an L2 test.
- Settings live-reader audit (#880) is a keyword scan; a stray mention of a
  key counts as a reader. Tighten it to config-access patterns per key.
- `release.yml` runs only on dispatch, so release-only scripts are untested
  by PR CI (three release-only failures on 2026-11-28). Add a PR job that runs
  the release gate's script set in dry-run mode.
- `bun run test` had one flaky task under heavy parallel load on 2026-11-28;
  rerun passed. Track if it recurs.

## 6. After v0.4.0: hygiene PR, then clean core

Hygiene PR (immediately after publish):

- remove the patched WASM, the cracking playbook, the FMHY survey and the
  Cloudflare-bypass note from the public tree;
- own TMDB key via `KUNAI_TMDB_BUILD_KEY`; set
  `LEGACY_PUBLIC_TMDB_API_KEY = null` in `tmdb-proxy.ts`;
- confirm the DoH opt-in docs; add a takedown page.

Clean core (ADR first, next sequential number in `.docs/adr/`): no bundled
scrapers; local files, Jellyfin-class servers, public-domain catalogs and
user-added Stremio-protocol add-ons. Five seams to design: provider roster
tiers, trust-tier capability policy, a namespaced `CanonicalTitleId` with a
crosswalk, a vaulted full Stremio add-on client, and a shared loopback stream
gateway. See `.plans/2026-11-28-stremio-like-client.md` and
`.plans/2026-11-23-provider-platform.md`.

## 7. Delegation notes

- Grok capacity: Cursor-2 is out until about 2026-12-05; the direct Grok and
  Grok-2 providers are out of credit; Cursor-1 works.
- Every brief carries the handbook: TMPDIR=/var/tmp, never the real profile,
  normal pushes only (never `--force`/`--no-verify`), merge main and never
  rebase, red/green proof, ratchets only lowered, no edits to changelogs or
  `.release/*` outside release PRs.
