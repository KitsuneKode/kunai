# Replay and held-session commands

Run these commands from `apps/cli`. The drivers isolate storage and credentials.

## Quickstart

```sh
cd apps/cli

# Search, open the first result, play it with fake mpv, show frame + history:
DO_NOT_TRACK=1 bun run agent:drive -- \
  --mpv fake \
  --evidence /path/to/durable-evidence \
  --show frame,history,journal \
  --keys smoke "<enter>" "<wait:Smoke>" "<enter>" "<wait:Post-play>"
```

That boots, types `smoke`, searches, waits for results, selects (resolve →
play), waits for post-play, prints the frame, the history table and the
journal, and writes a bundle (transcript, frames, per-step DB deltas).

## `agent:drive` (L2)

`--keys` consumes every following non-flag token, so put it last:

- plain tokens type text (`smoke` types s-m-o-k-e)
- named keys: `<enter> <esc> <up> <down> <left> <right> <tab> <space>
  <backspace> <ctrlC>`
- `<wait:TEXT>` — pause until a frame contains TEXT; `<wait:/re/>` waits on a
  regex (`[\s\S]` spans lines)
- `<wait-config:key=value>` — pause until the debounced write lands in
  `config.json`, not just in the frame

| Flag                      | Meaning                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| `--show a,b`              | `frame,keys,history,queue,config,tables,delta,journal` (default `frame,tables`) |
| `--wait-for TEXT`         | after the keys, wait for a frame (`/re/` for regex)                             |
| `--evidence DIR`          | write the bundle — keep it outside any profile                                  |
| `--verify-citation TEXT`  | nonzero exit unless TEXT is in the captured evidence                            |
| `--seed onboarded\|fresh` | profile seed (default `onboarded`)                                              |
| `--providers smoke\|none` | fixture providers (default `smoke`)                                             |
| `--mpv fake\|none`        | PATH-shim fake mpv (default `none`)                                             |
| `--fake-mpv-mode M`       | `normal \| fail-pre-loaded \| hold`                                             |
| `--width N` / `--rows N`  | terminal size (default 100×30)                                                  |
| `--set-env K=V`           | extra env for the run (repeatable)                                              |

`--show keys` lists the `[key]` hints the current frame advertises — read it
before writing a key plan for an unfamiliar surface. `--seed fresh` writes no
config, but the setup wizard only runs on a real TTY: use L3 for onboarding.

## `agent:session` (L3)

```sh
cd apps/cli
DO_NOT_TRACK=1 bun run agent:session -- start --name s1                 # tmux + real main.ts + fresh sandbox
DO_NOT_TRACK=1 bun run agent:session -- doctor --name s1                # health check — run before driving
DO_NOT_TRACK=1 bun run agent:session -- see --name s1                   # the rendered pane (--raw keeps colour)
DO_NOT_TRACK=1 bun run agent:session -- keys --name s1                  # [key] hints the pane advertises
DO_NOT_TRACK=1 bun run agent:session -- do smoke "<enter>" --name s1    # same key vocabulary as agent:drive
DO_NOT_TRACK=1 bun run agent:session -- wait-for "Smoke" --name s1      # bounded; /re/ for regex
DO_NOT_TRACK=1 bun run agent:session -- inspect queue --name s1         # history | queue | config | tables
DO_NOT_TRACK=1 bun run agent:session -- relaunch --name s1              # real quit + reboot, same profile
DO_NOT_TRACK=1 bun run agent:session -- report /path/to/durable-evidence/session-s1 --name s1        # frame + backend.json bundle
DO_NOT_TRACK=1 bun run agent:session -- stop --name s1                  # kill session, remove sandbox
```

`start` also takes `--seed fresh` (the real setup wizard), `--no-fake-mpv`,
`--width/--rows`, `--command "--offline"` (extra `main.ts` args) and
`--keep-profile`. The session outlives each command through a sidecar file, so
separate invocations keep driving the same app — like a user leaving it open.

`doctor` prints `healthy <name> · <surface> · credential backend file` when
the pane is alive, shows recognised interactive chrome, uses contained storage
paths and the file credential backend, and has minted no analytics install id.
It does **not** prove provider reachability, playback, or that every handler
is attached.

## Recipes

Enqueue survives relaunch and explicit restore (L3):

```sh
DO_NOT_TRACK=1 bun run agent:session -- start --name q1
DO_NOT_TRACK=1 bun run agent:session -- do smoke "<enter>" --name q1
DO_NOT_TRACK=1 bun run agent:session -- wait-for "Smoke" --name q1
DO_NOT_TRACK=1 bun run agent:session -- do q --name q1
DO_NOT_TRACK=1 bun run agent:session -- inspect queue --name q1          # row present
DO_NOT_TRACK=1 bun run agent:session -- relaunch --name q1
DO_NOT_TRACK=1 bun run agent:session -- do / --name q1
DO_NOT_TRACK=1 bun run agent:session -- wait-for "Command palette" --name q1
DO_NOT_TRACK=1 bun run agent:session -- do queue --name q1
DO_NOT_TRACK=1 bun run agent:session -- wait-for "/up-next" --name q1
DO_NOT_TRACK=1 bun run agent:session -- do "<enter>" --name q1           # Up Next surface
DO_NOT_TRACK=1 bun run agent:session -- do r --name q1                   # explicit restore after restart
DO_NOT_TRACK=1 bun run agent:session -- inspect queue --name q1          # still there
DO_NOT_TRACK=1 bun run agent:session -- stop --name q1
```

A settings toggle persists (L2, one shot):

```sh
DO_NOT_TRACK=1 bun run agent:drive -- \
  --show config --verify-citation '"footerHints": "minimal"' \
  --keys "/" "<wait:command>" settings "<enter>" \
         "<wait:Usage analytics>" "<down>" "<enter>" \
         "<wait:Minimal>" "<down>" "<enter>" \
         "<wait-config:footerHints=minimal>"
```

Real mpv (L4): with `mpv` and `ffmpeg` on PATH, `KUNAI_REAL_MPV=1` makes the
harness mint a short mp4, serve it on `127.0.0.1`, point the fixture stream at
it through `KUNAI_SMOKE_MEDIA_BASE`, and wrap mpv with `--vo=null --ao=null`.
Proof is two witnesses: mpv's own IPC `time-pos` advancing **and** Kunai's
`history_progress` row (`test/agent/real-mpv.test.ts`).

## Rules — each one has been broken before

1. **Never touch the real profile.** No `KUNAI_CONFIG_DIR`, no real
   `~/.config/kunai`. The drivers isolate HOME/XDG/APPDATA **and** force the
   file credential backend — OS vaults are account-wide, so a new HOME does
   not isolate them. The L3 launcher refuses overrides of either. Need extra
   env? Pass `--set-env`; never export globals.
2. **Analytics stays off.** Seeded profiles decline it, and `dispose()` fails
   the run if an `installId` appears. A key plan that toggles the analytics
   row is caught by that check — that is the intended outcome.
3. **Cite or retract.** Every claim ends with the quoted frame line or table
   row, re-checked with `--verify-citation`.
4. **One transition at a time.** A rendered frame does not prove its input
   handlers are attached; bursting keys across a surface change drops them. If
   fast input or paste drops keys, keep that as a separate reproduction — a
   slower retry that passes does not fix the product bug.
5. **Identify the source.** Fixture `smoke` matches `Smoke Movie`, `Smoke Series`,
   `Smoke Anime`, `Return To Shell` and friends; other queries correctly return
   nothing. Production Kitty runs require `--live`; their upstream failures
   stay failures, with no fake provider replacement or automatic retry storm.
6. **Deferred writes are real.** The frame can claim a toggle ~300 ms before
   `config.json` commits it. Wait with `<wait-config:…>` before concluding
   "persisted" or "no-op".
7. **Name the tier.** Fixture, real terminal, compiled binary, real mpv, live
   provider and physical device are different claims. A local pass says
   nothing about hosted Windows or macOS; a VLC-open event proves a handoff,
   not playback.

## When something fails

- Capture first: `--show journal` / `transcript.md` (L2) or `report <dir>`
  (L3), into a directory outside the profile, before any cleanup.
- Run `doctor`. If unhealthy, relaunch that named session once and recheck. If
  the same failure returns, stop and record the blocker — do not repeat inputs
  or raise timeouts.
- A `wait-for` timeout prints its label; re-run with `--show frame` at each
  prefix of the key plan to see where the flow actually went.
- A frame that says the right thing while config/tables stay unchanged is a
  deferred write or a silent no-op — wait on the backend before concluding.
- Dispose/unwind timeouts usually mean an overlay is still open (the driver
  already sends Esc, Esc, Ctrl+C); a persistent hang is a real shutdown bug.
- Stop only the session you started — never kill every tmux session — and
  confirm its sidecar is gone and your evidence survived.
