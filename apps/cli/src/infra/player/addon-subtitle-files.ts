import { rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SubtitleTrack } from "@/domain/types";
import { createKeyedJoiner } from "@/infra/concurrency/keyed-joiner";
import { createPrivateTempDir } from "@/infra/fs/temp-dir";
import { isAllowedMpvUrl, type MpvUrlKind } from "@/infra/player/mpv-playback-url";
import {
  fetchStremioSubtitle,
  type StremioSubtitleFile,
} from "@/services/playback/stremio-subtitle-download";

/** Upper bound on distinct remote subtitle URLs localized in one scope. */
const MAX_SUBTITLE_URLS = 64;
/** Parallel guarded downloads for launch preparation. */
const LOCALIZE_CONCURRENCY = 8;

type Downloader = (
  url: string,
  options: { readonly signal?: AbortSignal },
) => Promise<StremioSubtitleFile | null>;

/**
 * Owns the local files an addon subtitle resolves to for one playback scope
 * (one launch, one persistent cycle set). Every remote addon subtitle URL is
 * downloaded once — guarded — then written under a private temp dir with a
 * numeric name; the URL never appears in a path, mpv argv, or IPC command.
 * A URL that fails the guard resolves to `null` and the track is skipped:
 * there is no raw-URL fallback.
 */
export class AddonSubtitleFiles {
  private readonly abort = new AbortController();
  // Shared dedup for in-flight downloads (one worker per URL); a caller that
  // leaves early lets the download finish so the result still warms the scope.
  private readonly joiner = createKeyedJoiner<string | null>({
    whenAbandoned: "finish",
  });
  /** Settled outcomes, `null` included — a refused URL is not retried. */
  private readonly results = new Map<string, string | null>();
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly paths = new Map<string, string>();
  private dirPromise: Promise<string> | null = null;
  private nextIndex = 0;
  private closed = false;

  constructor(private readonly download: Downloader = fetchStremioSubtitle) {}

  private dir(): Promise<string> {
    this.dirPromise ??= createPrivateTempDir("addon-subs");
    return this.dirPromise;
  }

  /** Local path for `url` once localized, or `undefined` if not yet resolved. */
  existingPath(url: string): string | undefined {
    return this.paths.get(url);
  }

  /**
   * Resolve a remote addon subtitle to an owned local file path, or `null`
   * when the guarded download refuses it. One in-flight job per URL; results
   * (including `null`) are cached for the scope's lifetime.
   */
  localize(url: string, callerSignal?: AbortSignal): Promise<string | null> {
    if (this.closed || this.abort.signal.aborted) return Promise.resolve(null);
    if (this.results.has(url)) return Promise.resolve(this.results.get(url) ?? null);
    if (this.results.size + this.joiner.size() >= MAX_SUBTITLE_URLS) {
      return Promise.resolve(null);
    }
    // The caller's own abort only detaches it; the shared download continues
    // for other waiters (whenAbandoned: "finish").
    return this.joiner
      .join(url, (upstream) => this.track(url, upstream), { signal: callerSignal })
      .catch(() => null);
  }

  private async track(url: string, upstream: AbortSignal): Promise<string | null> {
    const work = this.localizeOnce(url, upstream);
    this.inFlight.add(work);
    try {
      const path = await work;
      this.results.set(url, path);
      return path;
    } finally {
      this.inFlight.delete(work);
    }
  }

  private async localizeOnce(url: string, upstream: AbortSignal): Promise<string | null> {
    const signal = AbortSignal.any([this.abort.signal, upstream]);
    if (signal.aborted || this.closed) return null;
    const file = await this.download(url, { signal }).catch(() => null);
    if (!file || signal.aborted || this.closed) return null;
    // A temp-dir failure is just another refusal — the track skips.
    const dir = await this.dir().catch(() => null);
    if (!dir || signal.aborted || this.closed) return null;
    const index = this.nextIndex++;
    const path = join(dir, `${index}.${file.extension}`);
    try {
      await writeFile(path, file.text, { mode: 0o600, flag: "wx" });
    } catch {
      return null;
    }
    if (signal.aborted || this.closed) {
      await unlink(path).catch(() => {});
      return null;
    }
    this.paths.set(url, path);
    return path;
  }

  /** Abort in-flight work, then delete only the files this scope created. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    this.joiner.clear();
    await Promise.allSettled([...this.inFlight]);
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
  readonly stremioAddon?: boolean;
  readonly abortSignal?: AbortSignal;
}

export interface PreparedLaunchSubtitles {
  readonly subtitle: string | null;
  readonly subtitleUrlKind?: MpvUrlKind;
  readonly subtitleTracks?: readonly SubtitleTrack[];
  /** Local files owned by the scope; argv may reference these as `local`. */
  readonly localSubtitlePaths: ReadonlySet<string>;
}

/**
 * Rewrite a launch subtitle selection so every addon-guarded remote URL
 * becomes an owned local path. Tracks that fail the guard drop out; metadata
 * (display/language) rides along unchanged. Non-addon streams are untouched.
 */
export async function prepareLaunchSubtitles(
  input: LaunchSubtitleInput,
  files: AddonSubtitleFiles,
): Promise<PreparedLaunchSubtitles> {
  const localSubtitlePaths = new Set<string>();
  const guardedUrls = new Set(
    input.subtitleTracks?.filter((track) => track.guardedAddon).map((track) => track.url) ?? [],
  );
  // A marked track stays guarded even when the playback is not addon — the
  // provider that produced the URL is what makes it untrusted.
  const shouldLocalize = (url: string) =>
    (input.stremioAddon || guardedUrls.has(url)) && isAllowedMpvUrl(url, "remote");
  if (!input.stremioAddon && guardedUrls.size === 0) {
    return {
      subtitle: input.subtitle,
      subtitleUrlKind: input.subtitleUrlKind,
      subtitleTracks: input.subtitleTracks,
      localSubtitlePaths,
    };
  }

  const urls = new Set<string>();
  if (input.subtitle && shouldLocalize(input.subtitle)) urls.add(input.subtitle);
  for (const track of input.subtitleTracks ?? []) {
    if (shouldLocalize(track.url)) urls.add(track.url);
  }

  const ordered = [...urls];
  const localized = new Map<string, string | null>();
  for (let i = 0; i < ordered.length; i += LOCALIZE_CONCURRENCY) {
    const batch = ordered.slice(i, i + LOCALIZE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (url): Promise<readonly [string, string | null]> => [
        url,
        await files.localize(url, input.abortSignal),
      ]),
    );
    for (const [url, path] of results) localized.set(url, path);
    if (input.abortSignal?.aborted) break;
  }

  let subtitle = input.subtitle;
  let subtitleUrlKind = input.subtitleUrlKind;
  if (subtitle && shouldLocalize(subtitle)) {
    const path = localized.get(subtitle) ?? null;
    if (!path) {
      subtitle = null;
    } else {
      localSubtitlePaths.add(path);
      subtitle = path;
      subtitleUrlKind = "local";
    }
  } else if (subtitle && (input.stremioAddon || guardedUrls.has(subtitle))) {
    // A guarded or addon primary that is not an owned local file never
    // survives — a "local" kind flag is not proof the URL is local.
    const kind = input.subtitleUrlKind ?? "remote";
    if (
      kind !== "local" ||
      !isAllowedMpvUrl(subtitle, "local") ||
      isAllowedMpvUrl(subtitle, "remote")
    ) {
      subtitle = null;
    }
  }

  const subtitleTracks = input.subtitleTracks
    ?.map((track) => {
      if (shouldLocalize(track.url)) {
        const path = localized.get(track.url);
        if (!path) return null;
        localSubtitlePaths.add(path);
        return { ...track, url: path };
      }
      if (input.stremioAddon || track.guardedAddon) return null;
      return track;
    })
    .filter((track): track is SubtitleTrack => track !== null);

  return { subtitle, subtitleUrlKind, subtitleTracks, localSubtitlePaths };
}

/**
 * Resolve one subtitle URL to what mpv may receive. Addon playbacks only ever
 * get files the scope owns; non-addon playbacks keep the existing
 * literal-safety check. `null` means "skip this track".
 */
export async function resolvePlayerSubtitle(
  url: string,
  kind: MpvUrlKind,
  stremioAddon: boolean,
  track: SubtitleTrack | undefined,
  files: AddonSubtitleFiles,
  signal?: AbortSignal,
): Promise<string | null> {
  // A remote URL under a "local" kind is still remote — localize or refuse.
  if ((stremioAddon || track?.guardedAddon) && isAllowedMpvUrl(url, "remote")) {
    return files.localize(url, signal);
  }
  return isAllowedMpvUrl(url, kind) ? url : null;
}
