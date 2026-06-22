import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StreamInfo } from "@/domain/types";
import {
  releaseAllMangaAkDeferredLocator,
  resolveAllMangaAkDeferredLocator,
  type AllMangaAkDeferredDescriptor,
  type AllMangaAkRepresentation,
} from "@kunai/providers";

export type MaterializedDeferredMedia = {
  readonly stream: StreamInfo;
  readonly cleanup: () => Promise<void>;
};

export async function materializeDeferredMediaForPlayback(
  stream: StreamInfo,
): Promise<MaterializedDeferredMedia> {
  if (!stream.deferredLocator) {
    return { stream, cleanup: async () => {} };
  }

  if (stream.deferredLocator.startsWith("allmanga-ak:")) {
    const descriptor = resolveAllMangaAkDeferredLocator(stream.deferredLocator);
    if (!descriptor) {
      throw new Error("Deferred AllManga Ak media expired before playback");
    }
    const dir = await createTempDir();
    const mpdPath = join(dir, "stream.mpd");
    await writeFile(mpdPath, buildAllMangaAkMpd(descriptor));
    return {
      stream: {
        ...stream,
        url: mpdPath,
        headers: {},
      },
      cleanup: async () => {
        releaseAllMangaAkDeferredLocator(stream.deferredLocator ?? "");
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  throw new Error(`Unsupported deferred media locator: ${stream.deferredLocator.split(":")[0]}`);
}

async function createTempDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `kunai-media-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

function buildAllMangaAkMpd(descriptor: AllMangaAkDeferredDescriptor): string {
  const duration =
    Number.isFinite(descriptor.duration) && descriptor.duration
      ? ` mediaPresentationDuration="PT${descriptor.duration}S"`
      : "";
  const periodDuration =
    Number.isFinite(descriptor.duration) && descriptor.duration
      ? ` duration="PT${descriptor.duration}S"`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" minBufferTime="PT1.5S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"${duration}>
  <Period${periodDuration}>
    ${adaptationSet("video", descriptor.video)}
    ${adaptationSet("audio", descriptor.audio)}
  </Period>
</MPD>
`;
}

function adaptationSet(kind: "video" | "audio", rep: AllMangaAkRepresentation): string {
  const attrs =
    kind === "video"
      ? `mimeType="${escapeXml(rep.mimeType ?? "video/mp4")}" contentType="video"${numberAttr("width", rep.width)}${numberAttr("height", rep.height)}${stringAttr("frameRate", rep.frameRate)}`
      : `mimeType="${escapeXml(rep.mimeType ?? "audio/mp4")}" contentType="audio"${stringAttr("lang", rep.language ?? "und")}`;
  const codecs = rep.codecs ? ` codecs="${escapeXml(rep.codecs)}"` : "";
  const audioRate =
    kind === "audio" && rep.audioSamplingRate
      ? ` audioSamplingRate="${rep.audioSamplingRate}"`
      : "";
  const segmentBase =
    rep.indexRange || rep.initializationRange
      ? `<SegmentBase${stringAttr("indexRange", rep.indexRange)}>${rep.initializationRange ? `<Initialization range="${escapeXml(rep.initializationRange)}"/>` : ""}</SegmentBase>`
      : "<SegmentBase/>";

  return `<AdaptationSet ${attrs}${codecs}${audioRate}>
      <Representation id="${kind}-1" bandwidth="${rep.bandwidth ?? 1}"${numberAttr("width", kind === "video" ? rep.width : undefined)}${numberAttr("height", kind === "video" ? rep.height : undefined)}>
        <BaseURL>${escapeXml(rep.url)}</BaseURL>
        ${segmentBase}
      </Representation>
    </AdaptationSet>`;
}

function numberAttr(name: string, value: number | undefined): string {
  return typeof value === "number" ? ` ${name}="${value}"` : "";
}

function stringAttr(name: string, value: string | number | undefined): string {
  return value === undefined || value === "" ? "" : ` ${name}="${escapeXml(String(value))}"`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
