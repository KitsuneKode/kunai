import { randomBytes } from "node:crypto";

import type { StreamInfo } from "@/domain/types";

import { receiverFacingAddress } from "./session-media-gateway";

const AUDIO_NAME = "audio.mp3";

export type AudioExtractionGatewayHandle = {
  readonly mediaUrl: string;
  readonly contentType: "audio/mpeg";
  close(): Promise<void>;
};

export type AudioExtractionGatewayFactory = {
  start(input: {
    readonly stream: StreamInfo;
    readonly receiverHost: string;
    readonly startAt?: number;
  }): Promise<AudioExtractionGatewayHandle>;
};

type AudioExtractionRuntime = {
  readonly which: (command: string) => string | null;
  readonly spawn: typeof Bun.spawn;
};

function ffmpegHeaderBlock(headers: Readonly<Record<string, string>>): string | null {
  const fields = Object.entries(headers)
    .map(([name, value]) => [
      name.replace(/[\r\n:]/g, "").trim(),
      value
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ])
    .filter(([name, value]) => Boolean(name && value))
    .map(([name, value]) => `${name}: ${value}`);
  return fields.length > 0 ? `${fields.join("\r\n")}\r\n` : null;
}

export function buildAudioExtractionArgs(stream: StreamInfo, startAt = 0): string[] {
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error"];
  const headerBlock = ffmpegHeaderBlock(stream.headers);
  if (headerBlock) args.push("-headers", headerBlock);
  if (startAt > 0) args.push("-ss", String(startAt));
  args.push("-i", stream.url);
  args.push("-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1");
  return args;
}

export class AudioExtractionGateway implements AudioExtractionGatewayFactory {
  constructor(
    private readonly runtime: AudioExtractionRuntime = {
      which: (command) => Bun.which(command),
      spawn: Bun.spawn,
    },
  ) {}

  async start(input: {
    readonly stream: StreamInfo;
    readonly receiverHost: string;
    readonly startAt?: number;
  }): Promise<AudioExtractionGatewayHandle> {
    const ffmpeg = this.runtime.which("ffmpeg");
    if (!ffmpeg) {
      throw new Error("Split Cast audio requires ffmpeg. Install ffmpeg and try again.");
    }
    const hostname = await receiverFacingAddress(input.receiverHost);
    const token = randomBytes(32).toString("base64url");
    const processes = new Set<ReturnType<typeof Bun.spawn>>();
    let closed = false;
    const server = Bun.serve({
      hostname,
      port: 0,
      fetch: (request) => {
        if (closed) return new Response("not found", { status: 404 });
        const url = new URL(request.url);
        if (url.pathname !== `/cast-audio/${token}/${AUDIO_NAME}`) {
          return new Response("not found", { status: 404 });
        }
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
        const headers = {
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
          "content-type": "audio/mpeg",
        };
        if (request.method === "HEAD") return new Response(null, { status: 200, headers });
        const process = this.runtime.spawn(
          [ffmpeg, ...buildAudioExtractionArgs(input.stream, input.startAt)],
          {
            stdin: "ignore",
            stdout: "pipe",
            stderr: "ignore",
          },
        );
        processes.add(process);
        void process.exited.finally(() => processes.delete(process));
        return new Response(process.stdout, { status: 200, headers });
      },
    });

    return {
      mediaUrl: `http://${hostname}:${server.port}/cast-audio/${token}/${AUDIO_NAME}`,
      contentType: "audio/mpeg",
      close: async () => {
        if (closed) return;
        closed = true;
        server.stop(true);
        for (const process of processes) process.kill("SIGTERM");
        await Promise.allSettled([...processes].map((process) => process.exited));
        processes.clear();
      },
    };
  }
}
