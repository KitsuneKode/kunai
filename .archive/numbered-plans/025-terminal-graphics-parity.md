# 025 — Terminal graphics parity: runtime capability probe + native sixel

- **Written against commit**: `ddeb800e`
- **Priority**: P1 (Windows users currently get the worst renderer available)
- **Effort**: L (three independent slices; 025.1 is shippable alone)
- **Risk**: MED (025.1 writes to the TTY and reads a reply; get the timeout right)
- **Depends on**: nothing

## Why this matters

Kunai already has four renderers and picks between them well:

| Renderer        | Protocol     | Dependency | Where it is used   |
| --------------- | ------------ | ---------- | ------------------ |
| `kitty-native`  | kitty        | none       | Kitty, Ghostty     |
| `chafa-sixel`   | sixel        | **chafa**  | WezTerm only       |
| `chafa-symbols` | unicode      | **chafa**  | forced via env var |
| `half-block`    | U+2580 + RGB | none       | everything else    |

The gap is not the renderers. It is **how the protocol is chosen**:
`apps/cli/src/image/capability.ts:60-70` decides purely from environment
variables (`TERM`, `TERM_PROGRAM`, `WT_SESSION`). Env vars cannot express
"this build supports sixel", so the code has to guess, and it guesses
conservatively — correctly, given what it knows:

```ts
// capability.ts:193-202
// Windows Terminal only gained sixel in 1.22, and nothing in the environment
// reports its version. Emitting sixel to an older build dumps raw escape
// bytes across the UI, so we take the always-correct path and leave sixel
// available through KUNAI_IMAGE_PROTOCOL=sixel for users who know they have it.
if (terminal === "windows-terminal") {
  return halfBlockCapability(terminal, "Windows Terminal detected; sixel support is unverifiable");
}
```

Two consequences:

1. **Windows Terminal 1.22+ users get half-block** even though their terminal
   does sixel — and they will never know, because discovering the env var
   requires reading the source.
2. **Sixel requires `chafa`**, an external binary. `apps/cli/src/ui.ts:123`
   already admits `chafa` is effectively never installed on Windows. So even
   after detection improves, Windows still has no sixel path.

Terminals that support sixel and today get half-block: Windows Terminal ≥1.22,
foot, contour, mlterm, xterm (`-ti vt340`), Konsole, iTerm2, and any future
terminal that is not WezTerm.

**The fix is to ask the terminal instead of guessing**, which is what yazi,
chafa, and timg all do. This is a solved problem with a standard answer.

---

## 025.1 — Runtime capability probe (M, highest value, shippable alone)

Replace env-var guessing with a real query, falling back to today's logic when
the terminal does not answer.

**Primary Device Attributes.** Write `ESC [ c` to the TTY; a conforming terminal
replies `ESC [ ? 6 2 ; 4 ; ... c`. Attribute **`4` means sixel**. This is the
same check chafa and timg use.

**Kitty graphics.** Query `ESC _ G i=31,s=1,v=1,a=q;<base64> ESC \` followed by
DA1; a kitty-protocol terminal answers `ESC _ G i=31;OK ESC \` _before_ the DA1
reply. Sending DA1 second is what makes the probe terminate on terminals that
ignore the kitty query — never wait on the kitty reply alone.

### Rules that make this safe

- **Only probe an interactive TTY.** Require `stdin.isTTY && stdout.isTTY`.
  Never probe when piped, in CI, or under a dumb `TERM` — the escape bytes would
  land in the user's output.
- **Raw mode, restored unconditionally.** Set raw, read, and restore in a
  `finally`. A thrown probe must never leave the terminal unusable — that is
  precisely the "broken terminal state" `CLAUDE.md` forbids.
- **Short deadline (~100 ms) with a hard cancel.** Use `setTimeout` +
  `clearTimeout` (cancellable, per the Bun-first guidance), not `Bun.sleep`.
  A terminal that does not answer must cost ~100 ms once, not block startup.
- **Memoize the result for the process.** `capability.ts` already memoizes by
  env key; extend that so the probe runs at most once.
- **Env override still wins.** `KUNAI_IMAGE_PROTOCOL` must short-circuit before
  any probe, and gain a `KUNAI_IMAGE_PROBE=0` escape hatch.
- **Never probe mid-render.** Do it once during capability detection, before the
  Ink tree mounts. Writing escape bytes from a nav hot path is exactly the class
  of bug recorded in the calendar-input-lag memory.

### Files

- `apps/cli/src/image/probe.ts` (new) — pure parser + IO wrapper, split so the
  parser is testable without a TTY.
- `apps/cli/src/image/capability.ts` — consult the probe before the
  terminal-name heuristics; keep every existing branch as fallback.

### Verify

- Unit-test the **parser** against captured DA1 replies: with `4` present,
  without it, a malformed reply, an empty reply, and a reply split across reads.
  No TTY required — this is where the real coverage lives.
- Manual matrix (record results in the PR): Kitty, Ghostty, WezTerm, foot,
  Windows Terminal ≥1.22, Windows Terminal <1.22, Alacritty (no sixel), `TERM=dumb`,
  and `kunai | cat` (must emit no escape bytes).
- Confirm `kunai --version | cat` output is byte-identical before and after.

**STOP** and report if the probe cannot be made reliable under `bun test`
without a real TTY — the parser split above is what avoids that, and if it is
not enough the design needs revisiting rather than a flaky test.

---

## 025.2 — Native sixel encoder (L, removes the `chafa` dependency)

Today sixel means shelling out to `chafa`. The pixel pipeline needed to encode
sixel directly **already exists** for half-block:

- `apps/cli/src/image/decode.ts:288` — `decodeImageBytes()` → RGBA
- `apps/cli/src/image/renderers/half-block.ts:58` — `resampleRgba()`
- `half-block.ts:41` — `fitDimensions()`

So a `sixel-native` renderer is a pure function from the RGBA buffer we already
have, and it makes sixel work on Windows, where `chafa` is a non-starter.

Sixel encoding, briefly: quantize to a palette (≤256), emit `ESC P q`, the
palette as `#<i>;2;<r>;<g>;<b>`, then six-pixel-tall bands per colour with
`$` (carriage return within band) and `-` (next band), ending `ESC \`.

- Start with a fixed palette or median-cut; posters are small and forgiving.
- Reuse `resampleRgba` — do not add a second scaling path.
- Keep `chafa-sixel` as a fallback and behind `KUNAI_IMAGE_RENDERER`, so a
  quality regression is one env var away from being worked around.

**Verify.** Golden-file test: fixed input PNG → byte-exact sixel output.
Then visually confirm on one sixel terminal per platform. Compare against
`chafa` output for obvious palette/banding regressions.

**STOP** if native output is visibly worse than `chafa` on real posters. Ship
025.1 alone in that case — detection alone already helps every non-Windows
sixel terminal, and `chafa` remains available.

---

## 025.3 — Make the choice visible and reportable (S)

Whatever is detected, the user cannot currently see it, and neither can we in a
bug report.

- Surface protocol, renderer, dependency, and **reason** in the diagnostics
  panel. `ImageCapability` already carries all four (`capability.ts`), so this
  is display work, not plumbing.
- Include them in the support bundle, so `/report-issue` (fixed in `ddeb800e`)
  carries them into the issue automatically. `.github/ISSUE_TEMPLATE/bug_report.yml`
  asks for the terminal by hand today; this makes the answer authoritative.
- Add a `kunai doctor` line: which protocol was chosen and why, plus the env var
  to override it.

**Verify.** Assert the support bundle contains the image-capability block; assert
the redactor does not strip it.

---

## Out of scope

- Changing poster **layout** or sizing.
- The Kitty placement path — it works; the memory note about not driving Kitty
  placements from a nav hot path still stands.
- Video-in-terminal of any kind.
