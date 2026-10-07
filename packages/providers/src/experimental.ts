// Research-only and fallback provider modules — not part of the production CLI
// runtime graph. Import from `@kunai/providers/experimental` in tests and lab work.
// VidRock is a production provider (`./index.ts` + `loadProductionProviderModules()`)
// and must not be re-exported here: a dup barrel once hid which surface was live.
export * from "./cineby";
export * from "./rgshows/direct";
export * from "./rgshows/manifest";
