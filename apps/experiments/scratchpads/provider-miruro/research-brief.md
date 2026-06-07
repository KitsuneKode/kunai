# Miruro research brief — what to look into (for agnostic anime resolve)

Date: 2026-06-07. Goal: unblock cross-provider anime resolve (AllManga ⇄ Miruro). Grounded in our current `packages/providers/src/miruro/direct.ts`.

## 0. The reframe (read first)
**Miruro has NO search.** It is a **resolve-only provider keyed by AniList id.** AllManga is the only anime provider with `search()`. So "agnostic anime search" is really:
- **Search** → AllManga search (+ AniList enrichment) produces titles carrying an **anilistId** (`externalIds.anilistId`).
- **Resolve** → use that anilistId to resolve via **Miruro (takes the anilistId directly)** OR **AllManga (needs its own `allanime:` show id)**, with fallback between them.

So the real fix is **cross-provider resolve dispatch + fallback on the shared anilistId** — NOT merging two search lists. Miruro is the one whose resolve is flaky, so that's what your research must pin down.

## 1. How our Miruro client works today (verify each against live)
- **Base hosts (mirror fallback):** `miruro.bz`, `miruro.ru`, `miruro.tv`, `www.miruro.tv` (`MIRURO_PIPE_BASE_URLS`). Referer `https://miruro.bz/`.
- **Single endpoint for everything:** `GET {base}/api/secure/pipe?e=<encodedPayload>`.
  - `encodedPayload` = `base64url( JSON.stringify(payload) )` (url-safe: `+`→`-`, `/`→`_`, strip `=`).
  - **Two payload "actions"** we use: `episodes` (`{ anilistId: <number> }`) and the **sources/stream** action (per episode — confirm its exact shape + name; ours builds it in `buildMiruroCycleCandidates` / the resolve path).
- **Response is obfuscated.** Accepted only if `body.startsWith("bh4YNPj7")` OR header `x-obfuscated: 2`. Then: `base64url → bytes → xorDecrypt(bytes, PIPE_KEY) → (gunzip if first two bytes are 0x1f 0x8b) → JSON.parse`.
- **Episode catalog shape:** `epData.providers.kiwi.episodes.{sub|dub}` (and `bee`). Servers we know: **kiwi, bee**.
- Request headers we send: referer, `sec-fetch-dest/mode/site` cors-ish.

## 2. What to capture from the live site (the actual research)
Open `https://miruro.bz`, pick an anime, open DevTools → Network, and watch the `/api/secure/pipe?e=…` calls while you (a) open the episode list and (b) press play:
1. **Decode the `e=` payloads.** base64url-decode each `e=` value → JSON. Record the exact JSON for: episode-list request, and the stream/source request. Confirm the **action names + field names** match ours (`anilistId`, the source action, server id, episode id, audio category).
2. **Is the response still obfuscated the same way?** Check the response headers for `x-obfuscated`, and whether the body starts with `bh4YNPj7`. If the scheme changed, our guard silently returns `null` (→ "weird/flaky").
3. **The XOR key (`PIPE_KEY`) — is ours current?** This is the #1 fragility: if Miruro rotated the key, our `xorDecrypt` yields garbage → resolve fails intermittently or always. Find the key in their client JS (search the site bundle for the XOR/decrypt routine) and compare to our `PIPE_KEY`.
4. **Server list.** Confirm the providers are still `kiwi`/`bee` (and sub/dub split). If they renamed/added servers, our catalog parse misses them.
5. **The final stream.** What does the resolved source look like — m3u8 URL + required `Referer`/headers? Does the m3u8 host need a specific referer to not 403?
6. **Anti-bot.** Is the pipe endpoint behind Cloudflare / rate-limited / needs a cookie or token? Intermittent 403/429 would explain "feels weird sometimes."

## 3. Likely causes of the flakiness (confirm/deny)
- **Rotated `PIPE_KEY`** (most likely) → decrypt garbage.
- **Changed obfuscation marker** (`bh4YNPj7` / `x-obfuscated`) → valid responses rejected.
- **Server rename** (kiwi/bee) → empty episode/source lists.
- **Mirror host down / CF challenge / rate limit** → network failures the mirror loop can't recover.
- **Payload schema drift** (field/action names) → 4xx or empty.

## 4. What I need back from you to build the agnostic resolve
1. Confirm **Miruro reliably resolves by anilistId** (the shared key) once the key/scheme is current.
2. The **current `PIPE_KEY` + endpoint + the two payload schemas** (so I fix our decoder if it drifted).
3. Your call on **preference**: Miruro-first or AllManga-first for resolve, and whether Miruro is fallback-only.
4. Any **header/referer/cookie** the m3u8 needs.

With that, the build is surgical: tag each `SearchResult` with its source provider, switch playback resolve to dispatch on the result's provider (or try-anilist-on-Miruro-then-AllManga), add fallback, and refresh our Miruro decoder to the live key/scheme. No change to the working AllManga path.

## 5. Compare against ani-cli
For AllManga parity, the canonical checkout is `~/Projects/osc/ani-cli` (per CLAUDE.md). Miruro is not ani-cli-based, so its reference is the live site only.
