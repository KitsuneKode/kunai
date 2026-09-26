---
status: current
lastReviewed: "2026-09-27"
---

# Cloudflare Handling: What Actually Shipped 🛡️

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

This document describes the Cloudflare strategy **as implemented**. An earlier
revision described a Playwright "Harvest & Fetch" architecture — a hidden
browser that solves the IUAM challenge once, harvests `cf_clearance`, and lets
plain `fetch()` reuse the token. **None of that was ever built**: no Playwright
dependency exists in any `package.json`, no `cf_clearance` string appears in
`src/`, and the provider runtime never launches a browser. Do not debug against
that model.

What shipped instead is cheaper and, for the threat model Kunai faces, the
better design — Cloudflare on these providers fingerprints the _client_, not
the session, so a convincing TLS/HTTP-2 fingerprint beats a harvested cookie.

---

## 1. Why `fetch()` alone fails

Cloudflare scores the TLS fingerprint (JA3) and HTTP/2 fingerprint before it
ever looks at headers. Bun's `fetch()` presents a handshake no browser
produces, so under elevated security the request is challenged regardless of
how accurate the `User-Agent` is.

The shipped answer is not a browser — it is a `curl` whose handshake _is_ a
browser's.

## 2. The shipped model

### PATH-discovered curl-impersonate (`shared/curl-impersonate.ts`)

- `resolveCurlCandidate()` scans PATH for `curl_<browser><version>` wrappers
  (`curl_chrome150`, `curl_firefox147`, `.bat`/`.cmd` accepted for Windows),
  ranks families chrome → firefox → safari → edge and newest version inside
  each family, then falls back to plain `curl`. No hardcoded binary list — the
  previous allowlist rotted the moment upstream renamed a wrapper.
- `curlCipherArgs()` applies ani-cli's cipher list **only on Darwin and only
  for plain curl**: Windows `curl.exe` links Schannel and rejects OpenSSL
  cipher names outright, and an impersonate build already carries the
  fingerprint the list exists to fake.
- `isCloudflareChallengeText()` detects the challenge on a **200 OK body** —
  the "Just a moment" interstitial is an HTML page served with a success
  status, not a 4xx, so status-code checks alone miss it.

### Per-provider fetch → curl fallback

Each Cloudflare-fronted provider runs the same shape:

1. Try the injected fetch port first (relay-safe, fast).
2. If the response fails or is a challenge body, fall back to the discovered
   curl — impersonate wrapper if present.
3. Error messages name what actually ran: a Cloudflare block under an
   impersonate build says "curl-impersonate was already used", not "install
   curl-impersonate" (see `hianime/client.ts`, `miruro/direct.ts`).

Miruro additionally uses `curl --http2` with browser-captured headers for its
pipe API, dossier-proven against `www.miruro.bz`.

## 3. Why not Harvest & Fetch

- `cf_clearance` is IP- and often TLS-bound: a token harvested by Chromium
  frequently rejects the Node.js handshake that reuses it — the doc's own
  "strict binding" caveat, which forced the Persistent Daemon fallback anyway.
- A resident browser costs ~hundreds of MB and a child-process lifecycle for a
  problem that a PATH-local binary solves with zero residency.
- One more moving part to keep secret-safe: the cookie is a bearer token and
  would need storage hardening, expiry handling, and redaction.

If a provider ever moves to strict token binding, that is the moment to
revisit — not before.

## 4. Troubleshooting a "provider is broken" report

1. **Which curl ran?** Check `kunai doctor` / the capability snapshot — the
   curl row distinguishes plain curl from an impersonating build and names the
   profile (`chrome150`, …).
2. **2xx challenge vs real 4xx.** A block that reaches the user as "blocked by
   Cloudflare" came from `isCloudflareChallengeText` on a 200 body or a
   genuine 403/503; the error text says which arm fired.
3. **Impersonate still blocked?** Fingerprint drift — install or update a
   `curl-impersonate` build (the lexiforest fork tracks current browser
   versions every few weeks), or retry from a different network: at that point
   the block is IP reputation, not fingerprint.
4. **Stream URLs 403 in mpv?** That is CDN `Referer` enforcement or an expired
   signed URL, not Cloudflare on the API host — check the headers Kunai passes
   to mpv, not this document.
