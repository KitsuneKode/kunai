# Kunai Relay Server

Deploy this app when provider metadata APIs are geo-blocked from your local network. It is a user-owned RPC relay for small provider JSON/text requests. It is not a public proxy and does not relay video by default.

## Local Development

```sh
bun run dev:relay
```

The dev server listens on `http://127.0.0.1:8787`.

Run the opt-in smoke:

```sh
export KUNAI_RELAY_BASE_URL=http://127.0.0.1:8787
bun run test:live:relay-allanime
```

When `KUNAI_RELAY_BASE_URL` is unset, the smoke exits successfully with a skipped payload.

## Vercel Deployment

Deploy from this directory:

```sh
vercel build --yes
bun run vercel:bundle-output
vercel deploy --prebuilt
```

For production:

```sh
vercel build --prod --yes
bun run vercel:bundle-output
vercel deploy --prebuilt --prod
```

The bundle step is required because this app imports Bun workspace packages
(`@kunai/relay`, `@kunai/providers`). It replaces Vercel's generated function
handlers with standalone bundled handlers before `--prebuilt` upload.

This app pins `typescript@5.9.3` in `package.json`: Vercel's `@vercel/node`
builder crashes ("Cannot read properties of undefined (reading 'readFile')")
on the repo-wide TypeScript 7 catalog entry. Keep the pin; `packages/relay`
code is kept TS 5.9-compatible for the same reason (no `Headers.entries()`).

**Redeploy after provider manifest host changes.** The RPC registry is built
from `@kunai/providers` manifests at deploy time. If a provider's
`relayProfile.upstreamHosts` changes upstream, an already-deployed relay keeps
rejecting the new hosts with `host-not-allowed` until it is redeployed. After
deploying, run the drift check to confirm the live registry matches the
current manifests:

```sh
KUNAI_RELAY_BASE_URL=https://your-relay.vercel.app \
KUNAI_RELAY_TOKEN=same-token-as-RELAY_TOKEN \
bun run verify:deploy
```

The `registry-matches-current-manifests` check probes one upstream host per
provider and fails loudly if the deployed registry still rejects it.

`vercel.json` rewrites `/rpc/:providerId` to the Vercel function and pins execution to `iad1`. Change the region only if you know the provider works better from another Vercel region.

Set `RELAY_TOKEN` for internet deployments:

```sh
vercel env add RELAY_TOKEN
```

Then configure Kunai locally:

```json
{
  "providerRelay": {
    "baseUrl": "https://your-relay.vercel.app",
    "token": "same-token-as-RELAY_TOKEN",
    "fallbackToDirect": true
  }
}
```

You can also avoid writing secrets to config:

```sh
export KUNAI_RELAY_BASE_URL=https://your-relay.vercel.app
export KUNAI_RELAY_TOKEN=...
```

## Safety Model

- Only `POST /rpc/:providerId` and `GET /health` are implemented in v1.
- Internet deployments reject missing, duplicate, or incorrect bearer credentials
  before reading the RPC request body. `OPTIONS` remains a body-free CORS preflight.
- Upstream URLs must match the selected provider manifest `relayProfile`.
- Private, loopback, link-local, localhost, and non-HTTP(S) upstreams are rejected
  before a socket opens. DNS names are resolved once per hop, the complete answer
  set is rejected if any address is non-public, and the connection is pinned to a
  vetted address while retaining the original HTTP `Host` and TLS SNI.
- Client relay credentials, cookies, `Host`, and `X-Forwarded-*` headers are never
  forwarded upstream. Provider credentials required by an initial request are
  stripped if a redirect changes origin.
- Redirects are followed only after each target is validated against the same
  provider allowlist and receives a fresh pinned DNS lookup. HTTPS-to-HTTP
  redirects are rejected.
- GET and HEAD may try another already-vetted DNS address after a connection-level
  failure before any response. POST is never replayed after an ambiguous attempt.
- Metadata request bodies default to 64 KiB max; metadata responses default to 2 MiB max.
- The upstream deadline covers DNS resolution and socket/response work.
- Relay-generated errors are structured JSON with stable `error.code` values for CLI diagnostics.
- Server diagnostics contain only stable provider/hostname/phase/family/count/error
  fields. URL paths, queries, addresses, headers, bodies, tokens, and raw errors are
  never logged. Upstream response cookies remain filtered from the RPC response.
- Stream/video relaying is intentionally not active by default. mpv receives the final CDN URL and fetches directly.

This app is fail-closed. If a provider host is missing from `relayProfile`, update
the provider manifest and tests instead of adding a server-side exception route.

## Rollout And Rollback

Relay use is controlled by client config, not a server default:

- Empty `providerRelay.baseUrl` means direct provider fetches only.
- `fallbackToDirect: true` lets a broken user relay degrade back to direct
  fetches in non-geo-blocked regions.
- Per-provider `providerRelay.providers[providerId].enabled = false` disables
  relay routing for one provider without changing the relay deployment.
- Clearing `providerRelay.baseUrl` or unsetting `KUNAI_RELAY_BASE_URL` is the
  rollback path.

Acceptance before sharing a relay URL:

```sh
bun run --cwd packages/relay test
bun run --cwd apps/relay-server test
bun run --cwd apps/relay-server typecheck
bun run fmt:check
```

For a Vercel preview, also verify `/health`, an unauthorized RPC when
`RELAY_TOKEN` is configured, a disallowed-host RPC, and the opt-in live smoke.

## Post-Deploy Smoke

1. `GET /health` returns `200`.
2. Unauthorized RPC returns `401` when `RELAY_TOKEN` is set.
3. Disallowed hosts return `403 host-not-allowed`.
4. `KUNAI_RELAY_BASE_URL=<preview-url> bun run test:live:relay-allanime` resolves a stream.
