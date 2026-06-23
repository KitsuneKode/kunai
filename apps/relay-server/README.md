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
- Upstream URLs must match the selected provider manifest `relayProfile`.
- Private, loopback, link-local, localhost, and non-HTTP(S) upstreams are rejected before fetch.
- Unsafe headers such as `Authorization`, `Cookie`, `Host`, and `X-Forwarded-*` are never forwarded upstream.
- Redirects are followed only after each target is validated against the same provider allowlist.
- Metadata request bodies default to 64 KiB max; metadata responses default to 2 MiB max.
- Relay-generated errors are structured JSON with stable `error.code` values for CLI diagnostics.
- Upstream response cookies and bodies are not logged or exposed beyond the filtered RPC response.
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
