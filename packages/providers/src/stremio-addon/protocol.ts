import { z } from "zod";

/**
 * The public Stremio addon protocol, as far as Kunai reads it.
 *
 * An addon is an HTTPS server the user chose. It answers `GET /manifest.json`
 * and `GET /{resource}/{type}/{id}.json` with JSON; nothing it sends is ever
 * executed. Every field Kunai reads is checked here, with a length or count
 * bound, before any other code sees it. Unknown fields are ignored rather than
 * rejected: addons add their own, and a field Kunai never reads cannot hurt.
 * Optional fields may also be `null`, which several addons send for "absent".
 *
 * Reference: https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api
 */

/** Limits on what an addon may send. A response past any of them is refused. */
export const STREMIO_ADDON_LIMITS = {
  /** `manifest.json` body. Manifests with long catalog lists reach tens of KiB. */
  manifestBytes: 512 * 1024,
  /** One `/stream/…` body. Busy addons answer a few hundred KiB. */
  streamResponseBytes: 2 * 1024 * 1024,
  /** Streams read from one response; the rest are counted, not processed. */
  streamsPerResponse: 200,
  subtitlesPerStream: 64,
  headersPerStream: 24,
  urlLength: 4096,
  shortText: 256,
  longText: 4096,
} as const;

/**
 * Text from an addon, made safe to print. Control characters can move a
 * terminal's cursor or recolor a line, so each becomes a space; runs of
 * whitespace then collapse to one. `undefined` when nothing printable is left.
 */
export function toDisplayText(
  value: string | null | undefined,
  maxLength: number = STREMIO_ADDON_LIMITS.shortText,
): string | undefined {
  if (!value) return undefined;
  const text = Array.from(value, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : char;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, maxLength) : undefined;
}

const shortText = z.string().max(STREMIO_ADDON_LIMITS.shortText);
const longText = z.string().max(STREMIO_ADDON_LIMITS.longText);
const urlText = z.string().min(1).max(STREMIO_ADDON_LIMITS.urlLength);

const resourceObjectSchema = z.object({
  name: shortText,
  types: z.array(shortText).max(64).nullish(),
  idPrefixes: z.array(shortText).max(64).nullish(),
});

/**
 * A resource is either a bare name or an object carrying its own `types` and
 * `idPrefixes`. Both are read into the object form here, so no later code has
 * to ask which one it was given: a bare name is an object with neither, and
 * inherits the manifest's.
 */
const resourceDescriptorSchema = z.union([
  shortText.transform((name): z.infer<typeof resourceObjectSchema> => ({ name })),
  resourceObjectSchema,
]);

export const stremioManifestSchema = z.object({
  id: shortText.min(1),
  name: shortText.min(1),
  version: shortText.nullish(),
  description: longText.nullish(),
  resources: z.array(resourceDescriptorSchema).max(64),
  types: z.array(shortText).max(64),
  idPrefixes: z.array(shortText).max(64).nullish(),
  behaviorHints: z
    .object({
      adult: z.boolean().nullish(),
      p2p: z.boolean().nullish(),
      configurable: z.boolean().nullish(),
      configurationRequired: z.boolean().nullish(),
    })
    .nullish(),
});

export type StremioManifest = z.infer<typeof stremioManifestSchema>;

const headerMapSchema = z
  .record(z.string().max(128), z.string().max(STREMIO_ADDON_LIMITS.longText))
  .refine((headers) => Object.keys(headers).length <= STREMIO_ADDON_LIMITS.headersPerStream, {
    message: "too many proxy headers",
  });

const streamSubtitleSchema = z.object({
  id: shortText.nullish(),
  url: urlText,
  lang: shortText.nullish(),
});

export const stremioStreamSchema = z.object({
  url: urlText.nullish(),
  ytId: shortText.nullish(),
  infoHash: shortText.nullish(),
  fileIdx: z.number().nullish(),
  externalUrl: urlText.nullish(),
  name: longText.nullish(),
  title: longText.nullish(),
  description: longText.nullish(),
  subtitles: z
    // Capped at the envelope so a stream cannot make the reader walk more
    // entries than the limit allows — `readStreamSubtitles` trusts this.
    .custom<readonly unknown[]>(Array.isArray)
    .transform((all) => all.slice(0, STREMIO_ADDON_LIMITS.subtitlesPerStream))
    .nullish(),
  behaviorHints: z
    .object({
      notWebReady: z.boolean().nullish(),
      bingeGroup: shortText.nullish(),
      proxyHeaders: z
        .object({
          request: headerMapSchema.nullish(),
          response: headerMapSchema.nullish(),
        })
        .nullish(),
      filename: longText.nullish(),
      videoSize: z.number().nonnegative().nullish(),
    })
    .nullish(),
});

export type StremioStream = z.infer<typeof stremioStreamSchema>;
export type StremioStreamSubtitle = z.infer<typeof streamSubtitleSchema>;

/**
 * The envelope only. Each entry is validated on its own afterwards, so one
 * malformed stream is reported as invalid instead of discarding the others.
 */
export const stremioStreamResponseSchema = z.object({
  // Truncate inside the schema so entries past the cap are never handed to
  // the caller at all — `Array.isArray` reads no element.
  streams: z.custom<readonly unknown[]>(Array.isArray).transform((all) => ({
    entries: all.slice(0, STREMIO_ADDON_LIMITS.streamsPerResponse),
    truncated: Math.max(0, all.length - STREMIO_ADDON_LIMITS.streamsPerResponse),
  })),
});

export type StremioContentType = "movie" | "series";

/** Subtitles of a validated stream; entries that fail the schema are left out. */
export function readStreamSubtitles(stream: StremioStream): StremioStreamSubtitle[] {
  const subtitles: StremioStreamSubtitle[] = [];
  for (const entry of stream.subtitles ?? []) {
    const parsed = streamSubtitleSchema.safeParse(entry);
    if (parsed.success) subtitles.push(parsed.data);
  }
  return subtitles;
}

/**
 * Whether the manifest says the addon answers `/stream/{type}/{id}.json`.
 *
 * A resource is either a bare name, which inherits the manifest's `types` and
 * `idPrefixes`, or an object carrying its own. `idPrefixes` is optional; when
 * it is absent the addon accepts any id of a supported type.
 */
export function manifestServesStream(
  manifest: StremioManifest,
  type: StremioContentType,
  id: string,
): { readonly served: true } | { readonly served: false; readonly reason: string } {
  let sawStreamResource = false;
  let sawType = false;
  for (const resource of manifest.resources) {
    if (resource.name !== "stream") continue;
    sawStreamResource = true;
    const types = resource.types ?? manifest.types;
    if (!types.includes(type)) continue;
    sawType = true;
    const idPrefixes = resource.idPrefixes ?? manifest.idPrefixes;
    if (!idPrefixes || idPrefixes.some((prefix) => prefix.length > 0 && id.startsWith(prefix))) {
      return { served: true };
    }
  }
  if (!sawStreamResource) return { served: false, reason: "the addon does not provide streams" };
  if (!sawType) return { served: false, reason: `the addon has no ${type} streams` };
  return { served: false, reason: "the addon does not accept IMDb ids" };
}

/** What an addon's manifest says it offers. */
export interface StremioManifestResources {
  /** Content types the addon answers `/stream/…` for. */
  readonly streamTypes: readonly string[];
  /** Every resource other than `stream`, by name. */
  readonly otherResources: readonly string[];
}

/** What the addon offers, for `kunai addons list` and the settings check. */
export function describeManifestResources(manifest: StremioManifest): StremioManifestResources {
  const streamTypes = new Set<string>();
  const otherResources = new Set<string>();
  for (const resource of manifest.resources) {
    if (resource.name !== "stream") {
      otherResources.add(resource.name);
      continue;
    }
    for (const type of resource.types ?? manifest.types) streamTypes.add(type);
  }
  return { streamTypes: [...streamTypes], otherResources: [...otherResources] };
}
