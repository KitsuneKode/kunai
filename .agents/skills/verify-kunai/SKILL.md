---
name: verify-kunai
description: Verify Kunai the way a user would — drive the real CLI with real keystrokes, read the rendered frame, and check the SQLite/config backend in the same run. Use whenever asked to verify, confirm, or prove that a Kunai feature actually works end to end, when a bug report needs reproducing, or when "did my change work?" deserves more than a unit test. Covers `bun run agent:drive` (fast in-process replay) and `bun run agent:session` (held tmux session on real `main.ts`), evidence bundles, citation checking, and the optional real-mpv tier.
---

# Verify Kunai — agent verification loop

Trust model: **a claim is verified only when it cites captured evidence.** Every
drive produces a journal (frames + inputs + backend deltas). When you report
results, quote what you saw and check it with `--verify-citation` — never claim
"the queue updated" without the frame line or table row that proves it.

Two drivers, one mental model (do → see → inspect):

|              | `agent:drive` (L2)                                   | `agent:session` (L3)                                   |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------ |
| What it runs | Real `AppRoot` + real `SessionController` in-process | Real `src/main.ts` under tmux (real PTY)               |
| Interaction  | Stateless replay — each run re-executes the key list | Held named session — incremental `see`/`do`/`relaunch` |
| Speed        | ~1–3 s                                               | ~3–10 s boot, then instant steps                       |
| Use for      | Wiring probes, regressions, quick checks             | Real user paths: boot, gate, quit, relaunch, signals   |
| Platform     | Anywhere Bun runs                                    | Linux/macOS only (needs `tmux`)                        |

Both share: a throwaway seeded profile (isolated via storage-root env — never
the developer's real profile), deterministic fixture providers + fixture search
(`smoke` catalog, zero network), an optional fake-mpv PATH shim, and direct
SQLite/config inspection (`ProfileInspector`, no live-container reads).

## Quickstart — answer "does X work?" in one command

```sh
cd apps/cli

# Search, select the first result, play it (fake mpv), show everything:
bun run agent:drive -- \
  --mpv fake \
  --keys smoke "<enter>" "<wait:Smoke>" "<enter>" "<wait:Post-play>" \
  --show frame,history,journal \
  --evidence /tmp/kunai-evidence
```

That replays: boot → type `smoke` → Enter (search) → wait for results → Enter
(select → resolve → play) → wait for the post-play surface. Then it prints the
frame, the history table, the journal, and writes an evidence bundle
(transcript + frames + per-step DB deltas) to `/tmp/kunai-evidence`.

## `agent:drive` reference

```sh
bun run agent:drive -- [flags]
```

Input — `--keys` consumes every following non-flag token (put it last):

- literal tokens type as text (`smoke` types s-m-o-k-e)
- named keys: `<enter> <esc> <up> <down> <left> <right> <tab> <space>
<backspace> <ctrlC>`
- `<wait:TEXT>` — pause replay until a frame contains TEXT (multi-surface
  flows wait like a human instead of typing into a surface that hasn't
  rendered yet)
- `<wait-config:key=value>` — pause until the debounced config write lands
  (frame claims it AND `config.json` commits it, or the run times out honestly)

Waits and output (all repeatable):

- `--wait-for <text>` — after the keys, wait for a frame containing text
- `--show <a,b,c>` — sections: `frame,history,queue,config,tables,delta,journal`
  (default `frame,tables`)
- `--evidence <dir>` — write the bundle (transcript.md, frames/, steps/,
  final state)
- `--verify-citation <text>` — assert the text exists in captured evidence;
  nonzero exit if missing. **Use this to back every claim you report.**

Environment knobs:

- `--seed onboarded|fresh` — profile seed (default `onboarded`). `fresh` writes
  no config, but the wizard only runs on a real TTY — under `agent:drive`
  (in-process, no TTY) it lands on the browse shell. For the real onboarding
  flow use `agent:session -- start --seed fresh`.
- `--providers smoke|none` — fixture providers (default `smoke`)
- `--mpv fake|none` — PATH-shim fake mpv (default `none`)
- `--fake-mpv-mode <m>` — `normal | fail-pre-loaded | hold`
- `--width N` / `--rows N` — terminal size (default 100x30)
- `--set-env K=V` — extra env for the session (repeatable)

## `agent:session` — the real thing, held open

```sh
cd apps/cli

bun run agent:session -- start --name myrun      # tmux session, real main.ts, fresh sandbox
bun run agent:session -- see --name myrun        # capture-pane → the actual screen
bun run agent:session -- do smoke "<enter>" --name myrun   # positional keys
bun run agent:session -- wait-for "Smoke" --name myrun     # wait for pane text
bun run agent:session -- inspect history --name myrun      # history|queue|config|tables
bun run agent:session -- report /tmp/ev --name myrun       # frame + backend.json bundle
bun run agent:session -- relaunch --name myrun   # real quit + real reboot, SAME profile
bun run agent:session -- stop --name myrun       # tmux kill-session + sandbox cleanup
```

`start` also takes `--seed fresh` (boots the real setup wizard — the tmux pane
is a real TTY), `--no-fake-mpv`, `--width/--rows`, `--command "..."` (extra CLI
args to `main.ts`), `--keep-profile` (stop leaves the sandbox on disk).
Default session name is `kunai-agent`. Each invocation reattaches via a
sidecar state file, so a session survives across separate commands — exactly
like a user leaving the app open. `relaunch` is a first-class verb: close,
reopen, prove state survived. `see` is the real rendered pane
(`capture-pane`), not a debug frame; `--raw` keeps colors.

## What a real verification looks like

Prove "enqueue survives relaunch":

```sh
bun run agent:session -- start --name q1
bun run agent:session -- do smoke "<enter>" --name q1
bun run agent:session -- wait-for "Smoke" --name q1
bun run agent:session -- do q --name q1
bun run agent:session -- inspect queue --name q1          # row in queue table
bun run agent:session -- relaunch --name q1
bun run agent:session -- do Q --name q1                   # Up Next surface
bun run agent:session -- inspect queue --name q1          # still there
bun run agent:session -- stop --name q1
```

Prove "a settings toggle persists" (L2, one shot):

```sh
bun run agent:drive -- \
  --keys "/" "<wait:command>" settings "<enter>" \
         "<wait:Usage analytics>" "<down>" "<enter>" \
         "<wait:Minimal>" "<down>" "<enter>" \
         "<wait-config:footerHints=minimal>" \
  --show config --verify-citation '"footerHints": "minimal"'
```

## Real mpv (opt-in, local + main-branch CI)

`KUNAI_REAL_MPV=1` with `mpv` + `ffmpeg` on PATH upgrades fake playback to
real: the harness mints a short mp4, serves it on 127.0.0.1, remaps the
fixture stream URL via `KUNAI_SMOKE_MEDIA_BASE`, and wraps `mpv` with
`--vo=null --ao=null`. Proof is two independent witnesses — mpv's own IPC
`time-pos` advancing AND Kunai's `history_progress` row. See
`test/agent/real-mpv.test.ts` and `test/agent/real-mpv.ts`. Runs in-process
(L2 session), not through tmux.

## The rules (these exist because they've each been violated)

1. **Never point anything at the real profile.** No `KUNAI_CONFIG_DIR`, no
   real `~/.config/kunai`. The drivers isolate via HOME/XDG/APPDATA — if you
   need a custom env, pass `--set-env`, don't export globals.
2. **Analytics stays off.** The seeded profile has it explicitly declined.
   `dispose()` asserts no `installId` was minted — if your key plan toggles it
   (it lives one row below "Footer hints" in settings), the run fails. That is
   the intended outcome.
3. **Cite evidence.** End every verification claim with the frame line or
   table row you saw, and re-check it with `--verify-citation`. If you can't
   produce the quote, you didn't verify it — say so.
4. **A skip is not a pass.** tmux missing → session commands fail loudly;
   real-mpv absent → the test prints a skip line. Neither means verified.
5. **Wait like a human.** A frame can render before its input handlers attach.
   `<wait:>`/`--wait-for` on the surface you intend to type into, every time.
   Typing into a not-yet-live surface drops keys — that failure is real UX
   truth, not a flaky test.
6. **Fixture catalog only.** `smoke` matches `Smoke Movie`, `Smoke Series`,
   `Smoke Anime`, `Return To Shell`, and friends. Other queries legitimately
   return zero results — that's the fixture working, not a bug.
7. **Deferred writes are real.** The frame can claim a toggle landed ~300 ms
   before `config.json` does. Always `<wait-config:...>` (or `waitForBackend`)
   before concluding "persisted" — or "no-op".

## When something fails

- Read the journal first (`--show journal`, or `transcript.md` in the bundle) —
  every step shows the input and what the backend did.
- `waitForFrame`/`--wait-for` timeouts print the label; re-run with
  `--show frame` at each prefix to see where the flow actually went.
- A frame that says the right thing while `config`/tables stay unchanged is a
  deferred write or a silent no-op — wait on the backend before concluding.
- Dispose/unwind timeouts usually mean an overlay is still open — the driver
  already sends Esc,Esc,Ctrl+C through the real path; a persistent hang is a
  real shutdown bug worth reporting.

## Files

- L2 driver + session API: `apps/cli/test/agent/agent-driver.ts`
- Backend inspector: `apps/cli/test/agent/profile-inspector.ts`
- Evidence bundles + citation check: `apps/cli/test/agent/evidence.ts`
- Key decoder: `apps/cli/test/agent/keys.ts`
- Replay CLI: `apps/cli/test/agent/drive.ts` (`bun run agent:drive`)
- tmux driver + CLI: `apps/cli/test/agent/tmux-session.ts`, `apps/cli/test/agent/session.ts` (`bun run agent:session`)
- Real-mpv tier: `apps/cli/test/agent/real-mpv.ts`, `apps/cli/test/agent/real-mpv.test.ts`
- Wiring scenarios: `apps/cli/test/agent/wiring.test.ts`
