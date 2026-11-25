import { rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SubtitleTrack } from "@/domain/types";
import { createKeyedJoiner } from "@/infra/concurrency/keyed-joiner";
import { createPrivateTempDir } from "@/infra/fs/temp-dir";
import { dbg } from "@/logger";
import {
  fetchRemoteSubtitle,
  type RemoteSubtitleFile,
  type SubtitleMediaRequest,
} from "@/services/playback/remote-subtitle-download";

import { isAllowedMpvUrl, isLocalSubtitlePath, type MpvUrlKind } from "./mpv-playback-url";
import { collectLaunchSubtitleFiles } from "./mpv-subtitle-tracks";

export type { SubtitleMediaRequest };

/** Upper bound on distinct remote subtitle URLs localized in one scope. */
const MAX_SUBTITLE_URLS = 64;
/** Parallel guarded downloads for launch preparation. */
const LOCALIZE_CONCURRENCY = 8;

type Downloader = (
  url: string,
  options: { readonly signal?: AbortSignal; readonly media?: SubtitleMediaRequest },
) => Promise<RemoteSubtitleFile | null>;

/**
 * Owns files for remote subtitles in one playback scope
 * (one launch, one persistent cycle set). Every subtitle URL is
 * downloaded once — guarded — then written under a private temp dir with a
 * numeric name; the URL never appears in a path, mpv argv, or IPC command.
 * A URL that fails the guard resolves to `null` and the track is skipped:
 * there is no raw-URL fallback.
 */
export class SubtitleFiles {
  private readonly abort = new AbortController();
  private readonly joiner = createKeyedJoiner<string | null>();
  /** Settled outcomes, `null` included — a refused URL is not retried. */
  private readonly results = new Map<string, string | null>();
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly paths = new Map<string, string>();
  private dirPromise: Promise<string> | null = null;
  private nextIndex = 0;
  private closed = false;

  constructor(
    private readonly download: Downloader = fetchRemoteSubtitle,
    private readonly media?: SubtitleMediaRequest,
  ) {}

  private dir(): Promise<string> {
    this.dirPromise ??= createPrivateTempDir("subtitles");
    return this.dirPromise;
  }

  /** Local path for `url` once localized, or `undefined` if not yet resolved. */
  existingPath(url: string): string | undefined {
    return this.paths.get(url);
  }

  /**
   * Resolve a remote subtitle to an owned local file path, or `null`
   * when the guarded download refuses it. One in-flight job per URL; results
   * (including `null`) are cached for the scope's lifetime.
   */
  localize(url: string, callerSignal?: AbortSignal): Promise<string | null> {
    if (this.closed || callerSignal?.aborted) return Promise.resolve(null);
    if (this.results.has(url)) return Promise.resolve(this.results.get(url) ?? null);
    if (!this.joiner.has(url) && this.results.size + this.inFlight.size >= MAX_SUBTITLE_URLS) {
      dbg("mpv", "subtitle-target-rejected", { reason: "scope-limit" });
      return Promise.resolve(null);
    }
    return this.joiner
      .join(url, (upstream) => this.track(url, upstream), { signal: callerSignal })
      .catch(() => null);
  }

  private async track(url: string, upstream: AbortSignal): Promise<string | null> {
    const work = this.localizeOnce(url, upstream).then(async (path) => {
      if (upstream.aborted || this.closed) {
        if (path) await unlink(path).catch(() => {});
        return null;
      }
      this.results.set(url, path);
      if (path) this.paths.set(url, path);
      else dbg("mpv", "subtitle-target-rejected", { reason: "download-refused" });
      return path;
    });
    this.inFlight.add(work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(work);
    }
  }

  private async localizeOnce(url: string, upstream: AbortSignal): Promise<string | null> {
    const signal = AbortSignal.any([this.abort.signal, upstream]);
    if (signal.aborted || this.closed) return null;
    const file = await this.download(url, { signal, media: this.media }).catch(() => null);
    if (!file || signal.aborted || this.closed) return null;
    // A temp-dir failure is just another refusal — the track skips.
    const dir = await this.dir().catch(() => null);
    if (!dir || signal.aborted || this.closed) return null;
    const index = this.nextIndex++;
    const path = join(dir, `${index}.${file.extension}`);
    try {
      await writeFile(path, file.text, { mode: 0o600, flag: "wx" });
    } catch {
      await unlink(path).catch(() => {});
      return null;
    }
    return path;
  }

  /** Abort in-flight work, then delete only the files this scope created. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    this.joiner.clear();
    await Promise.allSettled(this.inFlight);
    for (const path of this.paths.values()) {
      await unlink(path).catch(() => {});
    }
    this.paths.clear();
    if (this.dirPromise) {
      const dir = await this.dirPromise.catch(() => null);
      // The directory only ever holds files we created and already removed.
      if (dir) await rmdir(dir).catch(() => {});
      this.dirPromise = null;
    }
  }
}

export interface LaunchSubtitleInput {
  readonly subtitle: string | null;
  readonly subtitleTracks?: readonly SubtitleTrack[];
  readonly subtitleUrlKind?: MpvUrlKind;
  readonly abortSignal?: AbortSignal;
}

export interface PreparedLaunchSubtitles {
  readonly subtitle: string | null;
  readonly subtitleTracks?: readonly SubtitleTrack[];
  readonly subtitleUrlKind?: MpvUrlKind;
  readonly localSubtitlePaths: ReadonlySet<string>;
}

export function resolvePlayerSubtitle(
  url: string,
  kind: MpvUrlKind,
  files: SubtitleFiles,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) return Promise.resolve(null);
  if (isAllowedMpvUrl(url, "remote")) return files.localize(url, signal);
  if (kind === "local" && isLocalSubtitlePath(url)) return Promise.resolve(url);
  dbg("mpv", "subtitle-target-rejected", { reason: "unsupported-target" });
  return Promise.resolve(null);
}

/** Localize the primary and alternatives before building mpv argv. */
export async function prepareLaunchSubtitles(
  input: LaunchSubtitleInput,
  files: SubtitleFiles,
): Promise<PreparedLaunchSubtitles> {
  const { subtitle, subtitleTracks, subtitleUrlKind, abortSignal } = input;
  const primaryKind = subtitleUrlKind ?? "remote";
  const resolve = (url: string) =>
    resolvePlayerSubtitle(url, url === subtitle ? primaryKind : "remote", files, abortSignal);
  const orderedUrls = collectLaunchSubtitleFiles(subtitle, subtitleTracks);
  const localized = new Map<string, string>();
  for (let i = 0; i < orderedUrls.length; i += LOCALIZE_CONCURRENCY) {
    if (abortSignal?.aborted) break;
    const batch = orderedUrls.slice(i, i + LOCALIZE_CONCURRENCY);
    const paths = await Promise.all(batch.map(resolve));
    for (const [index, url] of batch.entries()) {
      const path = paths[index];
      if (path) localized.set(url, path);
    }
  }
  return {
    subtitle: subtitle ? (localized.get(subtitle) ?? null) : null,
    subtitleUrlKind: "local",
    subtitleTracks: subtitleTracks?.flatMap((track) => {
      const path = localized.get(track.url);
      return path ? [{ ...track, url: path }] : [];
    }),
    localSubtitlePaths: new Set(localized.values()),
  };
}
