/**
 * Point the Neon HTTP driver at a non-default `/sql` endpoint.
 *
 * The store talks to Neon over HTTP rather than the Postgres wire protocol, so
 * running against a local Postgres needs a proxy terminating that endpoint —
 * see `docker-compose.yml`. `neonConfig.fetchEndpoint` is global-only, with no
 * per-client override, so this runs as an import side effect and must be
 * imported before any store or migration client is constructed.
 *
 * A no-op unless `NEON_FETCH_ENDPOINT` is set, so the deployed path is
 * untouched: nothing here can redirect a run that did not ask for it. Every
 * entry point that builds a client imports this one module, so the test and
 * migration paths cannot drift apart — the migration reaching a different
 * database than the tests is precisely the bug worth designing out.
 */

import { neonConfig } from "@neondatabase/serverless";

export const NEON_FETCH_ENDPOINT = process.env.NEON_FETCH_ENDPOINT?.trim() ?? "";

if (NEON_FETCH_ENDPOINT) {
  neonConfig.fetchEndpoint = NEON_FETCH_ENDPOINT;
}
