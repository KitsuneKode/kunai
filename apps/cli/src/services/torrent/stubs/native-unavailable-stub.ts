// Build stub for optional native WebSocket helpers (`utf-8-validate`,
// `bufferutil`, pulled in via webtorrent → ws).
//
// Both only accelerate validation; `ws` falls back to pure JS when the import
// throws. Their prebuilt binaries use NAPI calls Bun does not support, so
// letting them load crashes the process — throwing here is the safe path.
throw new Error("kunai: native module disabled, ws uses its JS fallback");
