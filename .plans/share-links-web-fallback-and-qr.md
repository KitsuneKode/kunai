# Share: web fallback, short codes, and QR

**Status:** not started · **Owner:** unassigned · **Prereq:** none

A handoff for one agent. The `kunai://` link format is **already built and
good** — do not redesign it. This plan adds the three things missing for
sharing with people who are not already sitting in a Kunai shell.

## What exists (read before touching anything)

[.docs/share-links.md](../.docs/share-links.md) is current and accurate. The
grammar is catalog-anchored, which is already the fast path — a shared link
carries `cat=tmdb:1396`, so resolution is a direct catalog lookup, never a
search:

```
kunai://play?cat=tmdb%3A1396&kind=series&s=1&e=3
kunai://play?cat=anilist%3A21&kind=anime&s=1&e=1&t=120
kunai://play?q=One%20Piece&kind=anime        # search anchor, the slow fallback
```

Codec and model: `apps/cli/src/domain/share/playback-target-ref.ts`.
Resolver: `apps/cli/src/app/bootstrap/resolve-share-target.ts`.
Surfaces (`/share`, `/watch`, `--open`, `--handoff-url`, mpv `Ctrl+Shift+S`,
post-play, history) are listed in the doc's Code map and Surfaces sections.

**The search anchor (`q=`) is the slow path** and already sets
`autoPickIndex: 1`. Anything that makes a shared link land on `q=` instead of
`cat=` is a regression — that is the single most important invariant here.

## The actual gap

`kunai://` is unreachable for a recipient who does not already have Kunai:

- chat apps do not linkify a custom scheme, so it arrives as dead text
- a browser cannot open it
- a QR encoding it does nothing on a phone that has no handler
- it carries no title, so the recipient cannot tell what they were sent

Netflix links work because they are `https` first, with the app handoff as an
enhancement. Kunai already owns a docs site to be that `https` layer.

## Scope

### 1. `https` share URLs with a web landing page

Mint `https://kunai.kitsunekode.in/w/<code>` alongside the `kunai://` ref.
The page shows poster, title, and the episode being shared, then:

- **Has Kunai** → an `Open in Kunai` button hitting the `kunai://` ref
- **Does not** → the install command for their platform, then the same button

`apps/docs` is a Next app already deploying to that domain, so this is a route
plus a decoder — **no new service, no database**. Encode the whole ref into
`<code>` (base64url of the query string) so the page is a pure function of the
URL and nothing is stored server-side. That keeps the privacy posture: a share
link reveals what it contains to whoever holds it, and nothing else.

Do not add a shortener backend. It creates a mapping table of who shared what,
which is exactly the kind of state this project has avoided everywhere else.

### 2. Short codes for speaking and typing

The full query is too long for a QR at useful density and impossible to read
aloud. Add a compact form of the catalog anchor — `tmdb:1396` plus `s`/`e`
packed — targeting under ~40 chars. `/watch` must accept **both** the long and
short forms, and the long form stays canonical.

### 3. QR in the terminal

`/share --qr` renders the `https` URL as a QR block in the shell. Terminal QR
is half-block Unicode over the existing colour tokens; check
[.docs/design-system.md](../.docs/design-system.md) before inventing glyphs.
Point it at the `https` URL, never the `kunai://` one — a scanning phone needs
the web fallback, which is the entire reason it exists.

Encoder must be vendored or dependency-free; do not add a runtime dep for this.

## Tests

- round-trip: every `PlaybackTargetRef` shape → `https` → decode → identical ref
- short form → long form equivalence, including anime and `t=` timestamps
- a shared **series episode** resolves through the catalog anchor, never `q=`
- the docs route renders with a malformed/truncated `<code>` instead of throwing
- QR: encode a known payload, assert against a fixture (do not snapshot pixels)

## Out of scope

- Any server-side storage, analytics, or click tracking on `/w/<code>`
- Changing the `kunai://` grammar
- Auth or private/expiring links

## Gotchas

- `apps/docs` is a separate deploy. A ref-decoding change touches CLI _and_
  docs — keep the codec in one shared place rather than reimplementing it in
  TypeScript twice, or they will drift.
- Vercel provisions its own bun for `apps/docs` and has been seen restoring a
  build cache pinned to an older one. If a docs build fails oddly, redeploy
  with the build cache disabled before debugging the code.
- `/share` already has a timestamp picker when a resume position exists. `--qr`
  composes with it; do not fork a second share path.
