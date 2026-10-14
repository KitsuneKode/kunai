import { join } from "node:path";

import type { BunPlugin } from "bun";

/**
 * Native modules in the webtorrent graph that Kunai never uses, mapped to
 * local stubs. One map feeds the release bundler (build-shared.ts) and the
 * dev/test runtime preload (torrent-preload.ts) so the three contexts cannot
 * drift: a stub added here but wired in only one place is a no-op there.
 *
 * Only specifiers that Bun's resolver actually routes through plugins are
 * listed: bare imports from cache-realpath files (like webrtc-polyfill,
 * imported deep inside simple-peer) bypass onResolve, so the stub sits one
 * level up at `@thaunknown/simple-peer/lite.js` — the single import that
 * pulls the native `node-datachannel` module into the graph.
 *
 * - `@thaunknown/simple-peer/lite.js` → fail-closed stub. Web peers are out
 *   of scope (swarms run TCP/UDP); without this, the chain breaks
 *   `bun build --compile` (native addons do not bundle) and crashes Bun at
 *   runtime (unsupported libuv).
 * - `utf-8-validate` / `bufferutil` → throwing stubs. Both only accelerate
 *   WebSocket validation and `ws` falls back to pure JS when the import
 *   throws; letting their prebuilds load crashes the process under Bun.
 */
export const TORRENT_NATIVE_STUBS = {
  "@thaunknown/simple-peer/lite.js": "simple-peer-stub.ts",
  "utf-8-validate": "native-unavailable-stub.ts",
  bufferutil: "native-unavailable-stub.ts",
} satisfies Record<string, string>;

export function torrentNativeStubPlugin(stubsDir: string): BunPlugin {
  return {
    name: "kunai-torrent-native-stubs",
    setup(build) {
      for (const [moduleName, stubFile] of Object.entries(TORRENT_NATIVE_STUBS)) {
        const stub = join(stubsDir, stubFile);
        const pattern = new RegExp(`^${moduleName.replace(/[^a-zA-Z0-9]/g, "\\$&")}$`);
        build.onResolve({ filter: pattern }, () => ({ path: stub }));
      }
    },
  };
}
