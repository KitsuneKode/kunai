import type { StreamInfo } from "@/domain/types";

export type CastCompatibility =
  | { readonly kind: "direct"; readonly contentType: string }
  | {
      readonly kind: "gateway-required";
      readonly reasons: readonly ("headers" | "local-file" | "deferred-media")[];
    }
  | {
      readonly kind: "unsupported";
      readonly reasons: readonly ("unsupported-protocol" | "youtube-extractor")[];
    };

export function assessDirectCastCompatibility(stream: StreamInfo): CastCompatibility {
  if (stream.requiresYtdl) return { kind: "unsupported", reasons: ["youtube-extractor"] };
  const url = URL.parse(stream.url);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    if (stream.url.startsWith("file:") || stream.url.startsWith("/")) {
      return { kind: "gateway-required", reasons: ["local-file"] };
    }
    return { kind: "unsupported", reasons: ["unsupported-protocol"] };
  }
  const gatewayReasons: Array<"headers" | "deferred-media"> = [];
  if (Object.keys(stream.headers).length > 0) gatewayReasons.push("headers");
  if (stream.deferredLocator) gatewayReasons.push("deferred-media");
  if (gatewayReasons.length > 0) return { kind: "gateway-required", reasons: gatewayReasons };

  const path = url.pathname.toLowerCase();
  const contentType = path.endsWith(".m3u8")
    ? "application/x-mpegURL"
    : path.endsWith(".mpd")
      ? "application/dash+xml"
      : path.endsWith(".webm")
        ? "video/webm"
        : path.endsWith(".mp3")
          ? "audio/mpeg"
          : "video/mp4";
  return { kind: "direct", contentType };
}
