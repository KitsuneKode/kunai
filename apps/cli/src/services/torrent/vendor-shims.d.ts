// Minimal ambient shape for the `webtorrent` package — only what Kunai's
// torrent engine uses. webtorrent ships no types; a full @types package would
// pin an unrelated version's API, so this file declares the verified surface
// (exercised live against webtorrent@3 under Bun, TCP loopback pair).
declare module "webtorrent" {
  export interface WebTorrentFile {
    readonly name: string;
    readonly length: number;
    readonly downloaded: number;
    select(): void;
    deselect(): void;
    createReadStream(opts?: {
      readonly start?: number;
      readonly end?: number;
    }): AsyncIterable<Uint8Array> & { destroy(err?: Error): void };
  }

  export interface WebTorrentWire {
    readonly peerId: string | undefined;
  }

  export interface WebTorrentTorrent {
    readonly infoHash: string;
    readonly magnetURI: string;
    readonly name: string | undefined;
    readonly files: readonly WebTorrentFile[];
    readonly pieces: readonly unknown[];
    readonly pieceLength: number;
    readonly downloaded: number;
    readonly uploaded: number;
    readonly downloadSpeed: number;
    readonly numPeers: number;
    readonly done: boolean;
    readonly ready: boolean;
    on(event: "metadata", listener: () => void): this;
    on(event: "ready", listener: () => void): this;
    on(event: "infoHash", listener: (infoHash: string) => void): this;
    on(event: "download", listener: () => void): this;
    on(event: "done", listener: () => void): this;
    on(event: "wire", listener: (wire: WebTorrentWire) => void): this;
    on(event: "warning" | "error", listener: (err: Error) => void): this;
    off(event: "metadata" | "ready" | "infoHash", listener: () => void): this;
    off(event: "error", listener: (err: Error) => void): this;
    select(start: number, end: number, priority?: number): void;
    deselect(start: number, end: number, priority?: number): void;
    addPeer(peer: string): boolean;
    destroy(): void;
  }

  export interface WebTorrentOptions {
    readonly torrentPort?: number;
    readonly dht?: boolean | object;
    readonly tracker?: boolean | object;
    readonly lsd?: boolean;
    readonly utp?: boolean;
    readonly natUpnp?: boolean;
    readonly downloadLimit?: number;
    readonly uploadLimit?: number;
  }

  export interface WebTorrentAddOptions {
    readonly destroyStoreOnDestroy?: boolean;
    readonly deselect?: boolean;
    readonly path?: string;
  }

  export default class WebTorrent {
    static readonly WEBRTC_SUPPORT: boolean;
    constructor(opts?: WebTorrentOptions);
    address(): { readonly port: number } | null;
    seed(
      input: string | Buffer | Uint8Array,
      onseed?: (torrent: WebTorrentTorrent) => void,
    ): WebTorrentTorrent;
    add(
      torrentId: string | Buffer | Uint8Array,
      opts?: WebTorrentAddOptions,
      ontorrent?: (torrent: WebTorrentTorrent) => void,
    ): WebTorrentTorrent;
    remove(torrent: string | WebTorrentTorrent): void;
    destroy(): void;
    on(event: "error" | "warning", listener: (err: Error) => void): this;
  }
}

declare module "parse-torrent" {
  export interface ParsedTorrent {
    readonly infoHash: string;
    readonly name?: string | undefined;
    readonly announce?: readonly string[] | undefined;
    readonly urlList?: readonly string[] | undefined;
    readonly length?: number | undefined;
  }

  export default function parseTorrent(
    torrentId: string | Buffer | Uint8Array,
  ): Promise<ParsedTorrent>;
}
