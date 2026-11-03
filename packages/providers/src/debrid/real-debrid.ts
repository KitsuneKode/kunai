import type { ProviderRuntimeContext } from "@kunai/types";

import { verifyCandidateStream } from "../shared/resolve-gate";
import { createTimeoutSignal } from "../shared/timeout-signal";
import {
  type DebridAccountInfo,
  type DebridClient,
  type DebridFetchFunction,
  type DebridResolveResult,
  type DebridServiceId,
  DebridAuthError,
  DebridError,
  DebridNotCachedError,
  DebridRateLimitError,
  extractQuality,
  extractTorrentHash,
} from "./types";

export interface RealDebridClientOptions {
  readonly apiKey?: string;
  readonly token?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly fetch?: DebridFetchFunction;
}

export interface RealDebridUserResponse {
  id: number;
  username: string;
  email?: string;
  points?: number;
  locale?: string;
  avatar?: string;
  type: "premium" | "free" | string;
  premium?: number;
  expiration?: string;
}

export interface RealDebridInstantFile {
  filename: string;
  filesize: number;
}

export type RealDebridInstantAvailability = Record<
  string,
  {
    rd?: Array<Record<string, RealDebridInstantFile>>;
  }
>;

export interface RealDebridAddMagnetResponse {
  id: string;
  uri: string;
}

export interface RealDebridTorrentFile {
  id: number;
  path: string;
  bytes: number;
  selected: number;
}

export interface RealDebridTorrentInfo {
  id: string;
  filename: string;
  original_filename: string;
  hash: string;
  bytes: number;
  original_bytes: number;
  host: string;
  split: number;
  progress: number;
  status:
    | "magnet_error"
    | "waiting_files_selection"
    | "queued"
    | "downloading"
    | "downloaded"
    | "error"
    | "virus"
    | "compressing"
    | "uploading"
    | "dead"
    | string;
  added: string;
  files: RealDebridTorrentFile[];
  links: string[];
  ended?: string;
  speed?: number;
  seeders?: number;
}

export interface RealDebridUnrestrictResult {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string;
  host: string;
  chunks: number;
  crc: number;
  download: string;
  streamable: number;
}

const DEFAULT_REAL_DEBRID_BASE_URL = "https://api.real-debrid.com/rest/1.0";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;

function isRetryableNetworkError(err: Error): boolean {
  if (err.name === "AbortError" || err.name === "TimeoutError") return false;
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(
    err.message,
  );
}

export class RealDebridClient implements DebridClient {
  readonly serviceId: DebridServiceId = "real-debrid";

  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly customFetch?: DebridFetchFunction;

  constructor(tokenOrOptions: string | RealDebridClientOptions) {
    if (tokenOrOptions instanceof Object) {
      const candidateToken = tokenOrOptions.apiKey ?? tokenOrOptions.token;
      this.token = candidateToken?.trim() ?? "";
      this.baseUrl = tokenOrOptions.baseUrl?.replace(/\/+$/, "") ?? DEFAULT_REAL_DEBRID_BASE_URL;
      this.timeoutMs = tokenOrOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      this.maxRetries = tokenOrOptions.maxRetries ?? DEFAULT_MAX_RETRIES;
      this.customFetch = tokenOrOptions.fetch;
    } else {
      this.token = String(tokenOrOptions).trim();
      this.baseUrl = DEFAULT_REAL_DEBRID_BASE_URL;
      this.timeoutMs = DEFAULT_TIMEOUT_MS;
      this.maxRetries = DEFAULT_MAX_RETRIES;
    }

    if (!this.token) {
      throw new DebridAuthError("Real-Debrid API token is required", {
        service: "real-debrid",
        code: "MISSING_TOKEN",
      });
    }
  }

  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    let attempt = 0;
    const fetchFn = this.customFetch ?? globalThis.fetch;

    while (true) {
      try {
        const signal = createTimeoutSignal(init?.signal ?? undefined, this.timeoutMs);
        const res = await fetchFn(url, { ...init, signal });

        if (
          (res.status === 502 || res.status === 503 || res.status === 504) &&
          attempt < this.maxRetries
        ) {
          attempt++;
          await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
          continue;
        }

        return res;
      } catch (err: unknown) {
        if (attempt < this.maxRetries && err instanceof Error && isRetryableNetworkError(err)) {
          attempt++;
          await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
          continue;
        }

        if (err instanceof Error && err.name === "TimeoutError") {
          throw new DebridError(`Request to Real-Debrid timed out after ${this.timeoutMs}ms`, {
            service: "real-debrid",
            code: "TIMEOUT",
            cause: err,
          });
        }

        throw new DebridError(
          `Network error communicating with Real-Debrid: ${err instanceof Error ? err.message : String(err)}`,
          {
            service: "real-debrid",
            code: "NETWORK_ERROR",
            cause: err,
          },
        );
      }
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);

    const res = await this.fetchWithRetry(url, {
      ...init,
      headers,
    });

    if (res.status === 204) {
      // SAFETY: Real-Debrid HTTP 204 No Content endpoints deliver no response payload.
      return undefined as T;
    }

    let body: unknown;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!res.ok) {
      // SAFETY: Real-Debrid API error bodies serialize error and error_code properties.
      const errorObj =
        body instanceof Object
          ? (body as { error?: string; message?: string; error_code?: string | number })
          : undefined;
      const errorMessage =
        errorObj?.error ||
        errorObj?.message ||
        (body instanceof Error ? body.message : String(body ?? res.statusText));
      const errorCode =
        errorObj?.error_code !== undefined ? String(errorObj.error_code) : undefined;

      if (res.status === 401) {
        throw new DebridAuthError(errorMessage || "Invalid or expired Real-Debrid token", {
          service: "real-debrid",
          statusCode: res.status,
          code: errorCode ?? "BAD_TOKEN",
        });
      }

      if (res.status === 403) {
        if (errorObj?.error === "bad_token" || errorCode === "8") {
          throw new DebridAuthError(errorMessage || "Invalid Real-Debrid token", {
            service: "real-debrid",
            statusCode: res.status,
            code: errorCode ?? "BAD_TOKEN",
          });
        }
        throw new DebridAuthError(errorMessage || "Real-Debrid permission denied", {
          service: "real-debrid",
          statusCode: res.status,
          code: errorCode ?? "FORBIDDEN",
        });
      }

      if (res.status === 429) {
        throw new DebridRateLimitError("Real-Debrid rate limit exceeded", {
          service: "real-debrid",
          statusCode: 429,
          code: "RATE_LIMITED",
        });
      }

      throw new DebridError(
        `Real-Debrid API error (${res.status}): ${errorMessage || res.statusText}`,
        {
          service: "real-debrid",
          statusCode: res.status,
          code: errorCode,
        },
      );
    }

    // SAFETY: Real-Debrid endpoint responses match caller-provided generic type T on successful status.
    return body as T;
  }

  async getUser(): Promise<DebridAccountInfo> {
    const user = await this.request<RealDebridUserResponse>("/user");

    const isPremiumType = user.type === "premium";
    const notExpired = user.expiration
      ? new Date(user.expiration).getTime() > Date.now()
      : user.premium !== undefined
        ? user.premium > 0
        : isPremiumType;

    const isPremium = isPremiumType && notExpired;

    return {
      username: user.username,
      email: user.email,
      premium: isPremium,
      expirationDate: user.expiration,
      points: user.points,
    };
  }

  async checkInstantAvailability(hashes: string[]): Promise<RealDebridInstantAvailability> {
    if (!Array.isArray(hashes)) {
      throw new DebridError("Expected an array of torrent hashes", {
        service: "real-debrid",
        code: "INVALID_INPUT",
      });
    }

    const cleaned = hashes.map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0);
    if (cleaned.length === 0) {
      return {};
    }

    const path = `/torrents/instantAvailability/${cleaned.join("/")}`;
    return await this.request<RealDebridInstantAvailability>(path);
  }

  async addMagnet(magnet: string): Promise<RealDebridAddMagnetResponse> {
    if (!magnet || magnet.trim().length === 0) {
      throw new DebridError("Magnet link string is required", {
        service: "real-debrid",
        code: "INVALID_INPUT",
      });
    }

    if (!magnet.startsWith("magnet:?")) {
      throw new DebridError("Invalid magnet URI scheme: must start with magnet:?", {
        service: "real-debrid",
        code: "INVALID_MAGNET",
      });
    }

    const body = new URLSearchParams({ magnet });
    return await this.request<RealDebridAddMagnetResponse>("/torrents/addMagnet", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  }

  async getTorrentInfo(id: string): Promise<RealDebridTorrentInfo> {
    if (!id || id.trim().length === 0) {
      throw new DebridError("Torrent ID string is required", {
        service: "real-debrid",
        code: "INVALID_INPUT",
      });
    }

    return await this.request<RealDebridTorrentInfo>(`/torrents/info/${encodeURIComponent(id)}`);
  }

  async selectFiles(id: string, fileIds: string | "all" = "all"): Promise<void> {
    if (!id || id.trim().length === 0) {
      throw new DebridError("Torrent ID string is required", {
        service: "real-debrid",
        code: "INVALID_INPUT",
      });
    }

    if (!fileIds) {
      throw new DebridError("File IDs selection is required", {
        service: "real-debrid",
        code: "INVALID_INPUT",
      });
    }

    const body = new URLSearchParams({ files: fileIds });
    await this.request<void>(`/torrents/selectFiles/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  }

  async unrestrictLink(link: string, password?: string): Promise<RealDebridUnrestrictResult> {
    if (!link || link.trim().length === 0) {
      throw new DebridError("Link is required", {
        service: "real-debrid",
        code: "INVALID_INPUT",
      });
    }

    if (!/^https?:\/\//i.test(link)) {
      throw new DebridError("Invalid link format: must be HTTP or HTTPS URL", {
        service: "real-debrid",
        code: "INVALID_LINK",
      });
    }

    const body = new URLSearchParams({ link });
    if (password) {
      body.set("password", password);
    }

    return await this.request<RealDebridUnrestrictResult>("/unrestrict/link", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  }

  async resolveStream(
    magnetOrLink: string,
    context?: ProviderRuntimeContext,
  ): Promise<DebridResolveResult> {
    if (!magnetOrLink || magnetOrLink.trim().length === 0) {
      throw new DebridError("Invalid magnet or link provided", {
        service: "real-debrid",
        code: "INVALID_INPUT",
      });
    }

    const trimmed = magnetOrLink.trim();

    if (trimmed.startsWith("magnet:?")) {
      const hash = extractTorrentHash(trimmed);
      let isCached = false;

      if (hash) {
        try {
          const availability = await this.checkInstantAvailability([hash]);
          const fileGroups = availability[hash]?.rd;
          if (Array.isArray(fileGroups) && fileGroups.length > 0) {
            isCached = true;
          }
        } catch {
          // Non-fatal availability check failure; continue to addMagnet
        }
      }

      const added = await this.addMagnet(trimmed);
      await this.selectFiles(added.id, "all");
      const info = await this.getTorrentInfo(added.id);

      const terminalErrors = new Set(["magnet_error", "error", "virus", "dead"]);
      if (terminalErrors.has(info.status)) {
        throw new DebridError(`Real-Debrid torrent processing failed: ${info.status}`, {
          service: "real-debrid",
          code: info.status,
        });
      }

      if (info.status !== "downloaded") {
        throw new DebridNotCachedError(
          `Torrent is not cached on Real-Debrid (status: ${info.status})`,
          {
            service: "real-debrid",
            code: info.status,
          },
        );
      }

      if (!info.links || info.links.length === 0) {
        throw new DebridNotCachedError("No download links generated for torrent", {
          service: "real-debrid",
          code: "NO_LINKS",
        });
      }

      // Pick the largest file's link if files information is available
      let selectedLink: string | undefined = info.links[0];
      if (info.files && info.files.length > 0 && info.links.length === info.files.length) {
        let maxBytes = -1;
        let bestIdx = 0;
        info.files.forEach((file, idx) => {
          if (file.bytes > maxBytes) {
            maxBytes = file.bytes;
            bestIdx = idx;
          }
        });
        const candidate = info.links[bestIdx];
        if (candidate) {
          selectedLink = candidate;
        }
      }

      if (!selectedLink) {
        throw new DebridNotCachedError("No valid download link found for torrent", {
          service: "real-debrid",
          code: "NO_LINKS",
        });
      }

      const unrestrict = await this.unrestrictLink(selectedLink);

      if (context) {
        const verdict = await verifyCandidateStream({
          stream: { url: unrestrict.download, headers: {} },
          context,
        });
        if (!verdict.accepted) {
          throw new DebridError(`Stream verification probe rejected: ${verdict.reason}`, {
            service: "real-debrid",
            code: "STREAM_UNREACHABLE",
          });
        }
      }

      return {
        stream: {
          url: unrestrict.download,
          filename: unrestrict.filename,
          filesize: unrestrict.filesize,
          quality: extractQuality(unrestrict.filename),
          streamable: Boolean(unrestrict.streamable),
        },
        cached: isCached || info.status === "downloaded",
        service: "real-debrid",
      };
    }

    if (/^https?:\/\//i.test(trimmed)) {
      const unrestrict = await this.unrestrictLink(trimmed);

      if (context) {
        const verdict = await verifyCandidateStream({
          stream: { url: unrestrict.download, headers: {} },
          context,
        });
        if (!verdict.accepted) {
          throw new DebridError(`Stream verification probe rejected: ${verdict.reason}`, {
            service: "real-debrid",
            code: "STREAM_UNREACHABLE",
          });
        }
      }

      return {
        stream: {
          url: unrestrict.download,
          filename: unrestrict.filename,
          filesize: unrestrict.filesize,
          quality: extractQuality(unrestrict.filename),
          streamable: Boolean(unrestrict.streamable),
        },
        cached: true,
        service: "real-debrid",
      };
    }

    throw new DebridError(
      "Unsupported input: expected magnet link (magnet:?) or HTTP/HTTPS hoster link",
      {
        service: "real-debrid",
        code: "UNSUPPORTED_INPUT",
      },
    );
  }
}
