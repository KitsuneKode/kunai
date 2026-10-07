---
name: verify-kunai
description: Verify Kunai the way a user would — drive the real CLI with real keystrokes, read the rendered frame, and check the SQLite/config backend in the same run. Use whenever asked to verify, confirm, or prove that a Kunai feature works end to end, when a bug report needs reproducing, or when "did my change work?" deserves more than a unit test. Covers `bun run agent:drive` (fast in-process replay), `bun run agent:session` (held tmux session on real `main.ts`), evidence bundles, citation checks, and the real-mpv tier.
---

# Verify Kunai

**A claim is verified only when it cites captured evidence.** Every drive
records frames, inputs and backend deltas. Quote the frame line or table row
that proves the claim and re-check it with `--verify-citation`. If you cannot
produce the quote, report "not verified" — never "should work".

## The loop

1. **Route.** Find the owning code through `.docs/feature-map.md`, read the
   handler and its real callee, and pick rows from
   [references/scenarios.md](references/scenarios.md) — the happy path **and**
   the reverse or failure case. One happy path never verifies a feature.
2. **Pick the lowest tier that can answer the question** (table below).
3. **Drive one transition at a time** — wait for the surface you are about to
   type into, act, then wait for the next.
4. **Witness twice** — the frame says it, and the backend (SQLite, config)
   agrees. A frame alone can be a deferred write or a silent no-op.
5. **Report** with the template at the bottom, including what you did not
   cover.

## Which tier answers what

| Tier                      | Command                                     | Proves                                                     | Does not prove                           |
| ------------------------- | ------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| L1 unit/integration tests | `bun run test`                              | Logic and contracts                                        | That a user can reach it                 |
| L2 in-process replay      | `bun run agent:drive`                       | Wiring: real `AppRoot` + `SessionController`, ~1–3 s       | Startup, TTY, signals, quit/relaunch     |
| L3 held tmux session      | `bun run agent:session`                     | The real `main.ts` in a real PTY; relaunch, signals, setup | Provider reachability, real playback     |
| L4 real mpv               | `KUNAI_REAL_MPV=1` + `test/agent/real-mpv*` | mpv decodes and Kunai records progress                     | Live providers                           |
| L5 live / device          | `bun run test:live:*`, a physical phone     | Today's upstream and hardware                              | Anything reproducible — date it, it rots |

L2 and L3 run against fixture providers and a fixture catalog: zero network.
L3 needs `tmux` (Linux/macOS). A missing tool is a skip, and **a skip is not a
pass** — say which tier you could not run.

## Quickstart

```sh
cd apps/cli

# Search, open the first result, play it with fake mpv, show frame + history:
bun run agent:drive -- \
  --mpv fake \
  --evidence /tmp/kunai-evidence \
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
bun run agent:session -- start --name s1                 # tmux + real main.ts + fresh sandbox
bun run agent:session -- doctor --name s1                # health check — run before driving
bun run agent:session -- see --name s1                   # the rendered pane (--raw keeps colour)
bun run agent:session -- keys --name s1                  # [key] hints the pane advertises
bun run agent:session -- do smoke "<enter>" --name s1    # same key vocabulary as agent:drive
bun run agent:session -- wait-for "Smoke" --name s1      # bounded; /re/ for regex
bun run agent:session -- inspect queue --name s1         # history | queue | config | tables
bun run agent:session -- relaunch --name s1              # real quit + reboot, same profile
bun run agent:session -- report /tmp/ev --name s1        # frame + backend.json bundle
bun run agent:session -- stop --name s1                  # kill session, remove sandbox
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
bun run agent:session -- start --name q1
bun run agent:session -- do smoke "<enter>" --name q1
bun run agent:session -- wait-for "Smoke" --name q1
bun run agent:session -- do q --name q1
bun run agent:session -- inspect queue --name q1          # row present
bun run agent:session -- relaunch --name q1
bun run agent:session -- do / --name q1
bun run agent:session -- wait-for "Command palette" --name q1
bun run agent:session -- do queue --name q1
bun run agent:session -- wait-for "/up-next" --name q1
bun run agent:session -- do "<enter>" --name q1           # Up Next surface
bun run agent:session -- do r --name q1                   # explicit restore after restart
bun run agent:session -- inspect queue --name q1          # still there
bun run agent:session -- stop --name q1
```

A settings toggle persists (L2, one shot):

```sh
bun run agent:drive -- \
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
5. **Fixture catalog only.** `smoke` matches `Smoke Movie`, `Smoke Series`,
   `Smoke Anime`, `Return To Shell` and friends; other queries correctly return
   nothing.
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

## Report template

```md
**Verified** — <behaviour>, <tier>, revision <sha>

- Drive: `<exact command or key plan>`
- Frame: "<quoted line>" (`--verify-citation` ✓)
- Backend: <table/config row that agrees>
- Reverse case: <what was undone/failed and what the frame + backend showed>

**Not verified** — <what was out of reach and why: tier missing, live-only, device-only>
```

## Files

- L2 driver + session API: `apps/cli/test/agent/agent-driver.ts`
- Replay CLI: `apps/cli/test/agent/drive.ts` (`bun run agent:drive`)
- tmux driver + CLI: `apps/cli/test/agent/tmux-session.ts`, `apps/cli/test/agent/session.ts`
- Backend inspector: `apps/cli/test/agent/profile-inspector.ts`
- Evidence + citation check: `apps/cli/test/agent/evidence.ts`
- Key decoder: `apps/cli/test/agent/keys.ts`
- Real-mpv tier: `apps/cli/test/agent/real-mpv.ts`, `apps/cli/test/agent/real-mpv.test.ts`
- Wiring scenarios: `apps/cli/test/agent/wiring.test.ts`
