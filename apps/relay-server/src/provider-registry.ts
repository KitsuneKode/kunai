import { PRODUCTION_PROVIDER_MODULES } from "@kunai/providers/production-modules";
import { buildProviderRelayRegistry } from "@kunai/relay";

/**
 * Every production provider whose manifest declares `relayProfile` registers
 * here automatically. This used to be a hand-picked list, which is how a relay
 * deployed with six providers answered `unknown-provider` for the six the CLI
 * had already grown to — a refusal the client then misread as an upstream
 * verdict. `buildProviderRelayRegistry` does the manifest filtering, so the
 * deployment roster moves with `PRODUCTION_PROVIDER_MODULES` and nothing else.
 */
export const relayRegistry = buildProviderRelayRegistry(PRODUCTION_PROVIDER_MODULES);
