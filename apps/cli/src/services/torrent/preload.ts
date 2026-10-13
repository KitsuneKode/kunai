import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { plugin } from "bun";

import { torrentNativeStubPlugin } from "./torrent-native-stubs";

// Dev/test runtime resolution for the webtorrent graph's native modules (see
// services/torrent/torrent-native-stubs.ts). Loaded via --preload (dev) and
// the test preload array so the stubs are registered before any import of
// webtorrent — ES imports resolve before module bodies run, so calling this
// from main.ts would already be too late. Release builds use the same plugin
// through build-shared.ts.
plugin(torrentNativeStubPlugin(join(dirname(fileURLToPath(import.meta.url)), "stubs")));
