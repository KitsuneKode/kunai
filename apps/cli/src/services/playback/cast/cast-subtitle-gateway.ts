import { randomBytes } from "node:crypto";

import type { SubtitleTrack } from "@/domain/types";

import { receiverFacingAddress } from "./session-media-gateway";

const MAX_TRACKS = 32;

export type CastSubtitleRoute = {
  readonly trackId: number;
  readonly url: string;
  readonly name: string;
  readonly language?: string;
};

export type CastSubtitleGatewayHandle = {
  readonly tracks: readonly CastSubtitleRoute[];
  close(): Promise<void>;
};

export type CastSubtitleGatewayFactory = {
  start(input: {
    readonly tracks: readonly SubtitleTrack[];
    readonly receiverHost: string;
    readonly headers: Readonly<Record<string, string>>;
  }): Promise<CastSubtitleGatewayHandle>;
};

function timestampDots(line: string): string {
  return line.replace(
    /(\d{1,2}:\d{2}:\d{2}),(\d{3})(\s+-->\s+\d{1,2}:\d{2}:\d{2}),(\d{3})/,
    "$1.$2$3.$4",
  );
}

function assTimestamp(value: string): string | null {
  const match = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = match[1];
  if (!hours) return null;
  return `${hours.padStart(2, "0")}:${match[2]}:${match[3]}.${match[4]}0`;
}

function assToVtt(source: string): string {
  const cues: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.startsWith("Dialogue:")) continue;
    const fields = line.slice("Dialogue:".length).split(",");
    if (fields.length < 10) continue;
    const start = assTimestamp(fields[1] ?? "");
    const end = assTimestamp(fields[2] ?? "");
    if (!start || !end) continue;
    const text = fields
      .slice(9)
      .join(",")
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\N/g, "\n")
      .trim();
    if (text) cues.push(`${start} --> ${end}\n${text}`);
  }
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export function convertSubtitleToWebVtt(source: string): string {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (/^WEBVTT(?:\s|$)/.test(normalized)) return normalized;
  if (/^\s*\[Script Info\]/i.test(normalized) || /^Dialogue:/m.test(normalized)) {
    return assToVtt(normalized);
  }
  const lines = normalized.split("\n");
  const converted = lines
    .filter((line, index) => {
      if (!/^\d+$/.test(line.trim())) return true;
      return !/-->/.test(lines[index + 1] ?? "");
    })
    .map(timestampDots)
    .join("\n")
    .trim();
  return `WEBVTT\n\n${converted}\n`;
}

function safeHeaders(headers: Readonly<Record<string, string>>): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    const cleanName = name.replace(/[\r\n:]/g, "").trim();
    const cleanValue = value.replace(/[\r\n]+/g, " ").trim();
    if (cleanName && cleanValue) result.set(cleanName, cleanValue);
  }
  return result;
}

export class CastSubtitleGateway implements CastSubtitleGatewayFactory {
  async start(input: {
    readonly tracks: readonly SubtitleTrack[];
    readonly receiverHost: string;
    readonly headers: Readonly<Record<string, string>>;
  }): Promise<CastSubtitleGatewayHandle> {
    const hostname = await receiverFacingAddress(input.receiverHost);
    const token = randomBytes(32).toString("base64url");
    const tracks = input.tracks.slice(0, MAX_TRACKS).map((track, index) => ({
      source: track,
      trackId: index + 1,
      name: track.display ?? track.language ?? `Subtitle ${index + 1}`,
    }));
    let closed = false;
    const server = Bun.serve({
      hostname,
      port: 0,
      fetch: async (request) => {
        if (closed) return new Response("not found", { status: 404 });
        const url = new URL(request.url);
        const match = new RegExp(`^/cast-subtitles/${token}/(\\d+)\\.vtt$`).exec(url.pathname);
        const track = match ? tracks.find(({ trackId }) => trackId === Number(match[1])) : null;
        if (!track) return new Response("not found", { status: 404 });
        if (request.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-methods": "GET, HEAD, OPTIONS",
            },
          });
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response("method not allowed", { status: 405 });
        }
        const responseHeaders = {
          "access-control-allow-origin": "*",
          "cache-control": "private, max-age=3600",
          "content-type": "text/vtt; charset=utf-8",
        };
        if (request.method === "HEAD") return new Response(null, { headers: responseHeaders });
        try {
          const upstream = await fetch(track.source.url, { headers: safeHeaders(input.headers) });
          if (!upstream.ok) return new Response("subtitle unavailable", { status: 502 });
          return new Response(convertSubtitleToWebVtt(await upstream.text()), {
            headers: responseHeaders,
          });
        } catch {
          return new Response("subtitle unavailable", { status: 502 });
        }
      },
    });
    return {
      tracks: tracks.map(({ source, trackId, name }) => ({
        trackId,
        name,
        language: source.language,
        url: `http://${hostname}:${server.port}/cast-subtitles/${token}/${trackId}.vtt`,
      })),
      close: async () => {
        if (closed) return;
        closed = true;
        server.stop(true);
      },
    };
  }
}
