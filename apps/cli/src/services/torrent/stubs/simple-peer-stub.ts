// Build stub for `@thaunknown/simple-peer/lite.js` (imported by webtorrent's
// client and by bittorrent-tracker's websocket tracker).
//
// Only this specifier needs stubbing: it is the single import that pulls the
// native `node-datachannel` module into the graph (via webrtc-polyfill),
// which breaks `bun build --compile` (native addons do not bundle) and
// crashes Bun at runtime (unsupported libuv calls).
//
// Web peers are out of scope — swarms run TCP/UDP (DHT, HTTP/UDP trackers,
// PEX, LSD) — so the constructor fails closed with a clear message instead
// of silently misbehaving. This matches stock Node behavior without a WebRTC
// implementation, where constructing a web peer already throws. The static is
// read by webtorrent at startup (`WebTorrent.WEBRTC_SUPPORT`).
export default class SimplePeerDisabled {
  static readonly WEBRTC_SUPPORT = false;

  constructor() {
    throw new Error("kunai: WebRTC peers are disabled — TCP/UDP swarm only");
  }
}
