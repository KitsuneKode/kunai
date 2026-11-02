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
  DebridSubscriptionExpiredError,
  extractQuality,
} from "./types";

export interface AllDebridClientOptions {
  readonly apiKey?: string;
  readonly token?: string;
  readonly agent?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly fetch?: DebridFetchFunction;
}

export interface AllDebridApiResponse<T> {
  status: "success" | "error";
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface AllDebridUserResponseData {
  user: {
    username: string;
    email?: string;
    isSubscribed: boolean;
    isTrial: boolean;
    premiumUntil?: number;
  };
}

export interface AllDebridInstantMagnet {
  magnet: string;
  hash?: string;
  instant: boolean;
  files?: Array<{ n: string; s: number }>;
}

export interface AllDebridUploadedMagnet {
  magnet: string;
  hash?: string;
  name?: string;
  id: number;
  ready?: boolean;
  error?: { code: string; message: string };
}

export interface AllDebridMagnetFileLink {
  link: string;
  filename: string;
  size: number;
}

export interface AllDebridMagnetStatus {
  id: number;
  filename: string;
  size: number;
  status: string;
  statusCode: number;
  downloaded?: number;
  uploaded?: number;
  seeders?: number;
  downloadSpeed?: number;
  processingPerc?: number;
  uploadDate?: number;
  completionDate?: number;
  links?: AllDebridMagnetFileLink[];
}

export interface AllDebridUnlockedLink {
  link: string;
  host: string;
  filename: string;
  filesize: number;
  download: string;
  streams?: unknown[];
  p2p?: boolean;
}

const DEFAULT_ALL_DEBRID_BASE_URL = "https://api.alldebrid.com/v4";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_AGENT = "kunai";

function isRetryableNetworkError(err: Error): boolean {
  if (err.name === "AbortError" || err.name === "TimeoutError") return false;
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(
    err.message,
  );
}

export class AllDebridClient implements DebridClient {
  readonly serviceId: DebridServiceId = "all-debrid";

  private readonly apiKey: string;
  private readonly agent: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly customFetch?: DebridFetchFunction;

  constructor(apiKeyOrOptions: string | AllDebridClientOptions) {
    if (apiKeyOrOptions instanceof Object) {
      const candidateKey = apiKeyOrOptions.apiKey ?? apiKeyOrOptions.token;
      this.apiKey = candidateKey?.trim() ?? "";
      this.agent = apiKeyOrOptions.agent?.trim() || DEFAULT_AGENT;
      this.baseUrl = apiKeyOrOptions.baseUrl?.replace(/\/+$/, "") ?? DEFAULT_ALL_DEBRID_BASE_URL;
      this.timeoutMs = apiKeyOrOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      this.maxRetries = apiKeyOrOptions.maxRetries ?? DEFAULT_MAX_RETRIES;
      this.customFetch = apiKeyOrOptions.fetch;
    } else {
      this.apiKey = String(apiKeyOrOptions).trim();
      this.agent = DEFAULT_AGENT;
      this.baseUrl = DEFAULT_ALL_DEBRID_BASE_URL;
      this.timeoutMs = DEFAULT_TIMEOUT_MS;
      this.maxRetries = DEFAULT_MAX_RETRIES;
    }

    if (!this.apiKey) {
      throw new DebridAuthError("AllDebrid API key is required", {
        service: "all-debrid",
        code: "MISSING_APIKEY",
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
          throw new DebridError(`Request to AllDebrid timed out after ${this.timeoutMs}ms`, {
            service: "all-debrid",
            code: "TIMEOUT",
            cause: err,
          });
        }

        throw new DebridError(
          `Network error communicating with AllDebrid: ${err instanceof Error ? err.message : String(err)}`,
          {
            service: "all-debrid",
            code: "NETWORK_ERROR",
            cause: err,
          },
        );
      }
    }
  }

  private buildUrl(path: string, extraParams?: Record<string, string>): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${cleanPath}`);
    url.searchParams.set("agent", this.agent);
    url.searchParams.set("apikey", this.apiKey);
    if (extraParams) {
      for (const [key, value] of Object.entries(extraParams)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    extraParams?: Record<string, string>,
  ): Promise<T> {
    const fullUrl = this.buildUrl(path, extraParams);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);

    const res = await this.fetchWithRetry(fullUrl, {
      ...init,
      headers,
    });

    let json: AllDebridApiResponse<T> | undefined;
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // Non-JSON response
      }
    }

    if (!res.ok || json?.status === "error") {
      const errCode = json?.error?.code;
      const errMsg =
        json?.error?.message || (text.length > 0 && text.length < 200 ? text : res.statusText);

      if (
        errCode === "AUTH_BAD_APIKEY" ||
        errCode === "AUTH_MISSING_APIKEY" ||
        errCode === "AUTH_BLOCKED" ||
        errCode === "AUTH_USER_BANNED" ||
        res.status === 401 ||
        res.status === 403
      ) {
        throw new DebridAuthError(errMsg || "Invalid or unauthorized AllDebrid API key", {
          service: "all-debrid",
          statusCode: res.status,
          code: errCode ?? "BAD_APIKEY",
        });
      }

      if (errCode === "MUST_BE_PREMIUM") {
        throw new DebridSubscriptionExpiredError(
          errMsg || "AllDebrid active premium subscription required",
          {
            service: "all-debrid",
            statusCode: res.status,
            code: errCode,
          },
        );
      }

      if (errCode === "FREE_TRIAL_LIMIT_REACHED" || res.status === 429) {
        throw new DebridRateLimitError(errMsg || "AllDebrid rate limit reached", {
          service: "all-debrid",
          statusCode: 429,
          code: errCode ?? "RATE_LIMITED",
        });
      }

      throw new DebridError(`AllDebrid API error (${res.status}): ${errMsg || "Unknown error"}`, {
        service: "all-debrid",
        statusCode: res.status,
        code: errCode,
      });
    }

    if (!json?.data) {
      // SAFETY: Endpoints without a data payload return undefined matching void/undefined generic type T.
      return undefined as T;
    }

    return json.data;
  }

  async getUser(): Promise<DebridAccountInfo> {
    const data = await this.request<AllDebridUserResponseData>("/user");

    if (!data?.user) {
      throw new DebridError("Unexpected AllDebrid /user response format", {
        service: "all-debrid",
        code: "INVALID_RESPONSE",
      });
    }

    const isSubscribed = Boolean(data.user.isSubscribed);
    const notExpired = data.user.premiumUntil
      ? data.user.premiumUntil * 1000 > Date.now()
      : isSubscribed;

    const premium = isSubscribed && notExpired;

    return {
      username: data.user.username,
      email: data.user.email,
      premium,
      expirationDate: data.user.premiumUntil
        ? new Date(data.user.premiumUntil * 1000).toISOString()
        : undefined,
    };
  }

  async checkInstantAvailability(magnets: string[]): Promise<AllDebridInstantMagnet[]> {
    if (!Array.isArray(magnets)) {
      throw new DebridError("Expected an array of magnet links", {
        service: "all-debrid",
        code: "INVALID_INPUT",
      });
    }

    const cleaned = magnets.map((m) => m.trim()).filter((m) => m.length > 0);
    if (cleaned.length === 0) {
      return [];
    }

    const body = cleaned.map((m) => `magnets[]=${encodeURIComponent(m)}`).join("&");
    const data = await this.request<{ magnets: AllDebridInstantMagnet[] }>("/magnet/instant", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    return data?.magnets ?? [];
  }

  async uploadMagnet(magnets: string[]): Promise<AllDebridUploadedMagnet[]> {
    if (!Array.isArray(magnets) || magnets.length === 0) {
      throw new DebridError("At least one magnet link is required", {
        service: "all-debrid",
        code: "INVALID_INPUT",
      });
    }

    const cleaned = magnets.map((m) => m.trim()).filter((m) => m.length > 0);
    if (cleaned.length === 0) {
      throw new DebridError("No valid magnet links provided", {
        service: "all-debrid",
        code: "INVALID_INPUT",
      });
    }

    const body = cleaned.map((m) => `magnets[]=${encodeURIComponent(m)}`).join("&");
    const data = await this.request<{ magnets: AllDebridUploadedMagnet[] }>("/magnet/upload", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    return data?.magnets ?? [];
  }

  async getMagnetStatus(id: number): Promise<AllDebridMagnetStatus> {
    if (!Number.isFinite(id) || Number.isNaN(id)) {
      throw new DebridError("Valid numeric magnet ID is required", {
        service: "all-debrid",
        code: "INVALID_INPUT",
      });
    }

    const data = await this.request<{
      magnets: AllDebridMagnetStatus | AllDebridMagnetStatus[];
    }>("/magnet/status", {}, { id: String(id) });

    if (!data?.magnets) {
      throw new DebridError(`Magnet with ID ${id} not found on AllDebrid`, {
        service: "all-debrid",
        code: "MAGNET_NOT_FOUND",
      });
    }

    const item = Array.isArray(data.magnets) ? data.magnets[0] : data.magnets;
    if (!item) {
      throw new DebridError(`Magnet with ID ${id} not found on AllDebrid`, {
        service: "all-debrid",
        code: "MAGNET_NOT_FOUND",
      });
    }

    return item;
  }

  async unlockLink(link: string, password?: string): Promise<AllDebridUnlockedLink> {
    if (!link || link.trim().length === 0) {
      throw new DebridError("Link is required", {
        service: "all-debrid",
        code: "INVALID_INPUT",
      });
    }

    if (!/^https?:\/\//i.test(link)) {
      throw new DebridError("Invalid link format: must be HTTP or HTTPS URL", {
        service: "all-debrid",
        code: "INVALID_LINK",
      });
    }

    const body = new URLSearchParams({ link });
    if (password) {
      body.set("password", password);
    }

    return await this.request<AllDebridUnlockedLink>("/link/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  }

  async resolveStream(magnetOrLink: string): Promise<DebridResolveResult> {
    if (!magnetOrLink || magnetOrLink.trim().length === 0) {
      throw new DebridError("Invalid magnet or link provided", {
        service: "all-debrid",
        code: "INVALID_INPUT",
      });
    }

    const trimmed = magnetOrLink.trim();

    if (trimmed.startsWith("magnet:?")) {
      let isCached = false;
      try {
        const instantCheck = await this.checkInstantAvailability([trimmed]);
        const first = instantCheck[0];
        if (first && first.instant) {
          isCached = true;
        }
      } catch {
        // Non-fatal availability check failure
      }

      const uploadedList = await this.uploadMagnet([trimmed]);
      const uploadItem = uploadedList[0];

      if (!uploadItem) {
        throw new DebridError("Failed to upload magnet to AllDebrid: empty response", {
          service: "all-debrid",
          code: "UPLOAD_EMPTY",
        });
      }

      if (uploadItem.error) {
        if (uploadItem.error.code === "MUST_BE_PREMIUM") {
          throw new DebridSubscriptionExpiredError(
            uploadItem.error.message || "AllDebrid active premium required to upload magnets",
            {
              service: "all-debrid",
              code: uploadItem.error.code,
            },
          );
        }
        throw new DebridError(uploadItem.error.message || "Failed to upload magnet to AllDebrid", {
          service: "all-debrid",
          code: uploadItem.error.code,
        });
      }

      const status = await this.getMagnetStatus(uploadItem.id);

      // StatusCode 4: Ready
      if (status.statusCode === 4) {
        if (!status.links || status.links.length === 0) {
          throw new DebridError("Magnet is marked ready but contains no downloadable links", {
            service: "all-debrid",
            code: "NO_LINKS",
          });
        }

        // Pick largest file link
        const sorted = [...status.links].sort((a, b) => b.size - a.size);
        const bestLink = sorted[0]?.link;

        if (!bestLink) {
          throw new DebridError("No valid link found to unlock", {
            service: "all-debrid",
            code: "NO_LINKS",
          });
        }

        const unlocked = await this.unlockLink(bestLink);

        return {
          stream: {
            url: unlocked.download,
            filename: unlocked.filename,
            filesize: unlocked.filesize,
            quality: extractQuality(unlocked.filename),
            streamable: true,
          },
          cached: isCached,
          service: "all-debrid",
        };
      }

      // Status codes 0 to 3: in progress (not cached/ready)
      // 0 = Processing, 1 = Downloading, 2 = Compressing, 3 = Uploading
      if (status.statusCode >= 0 && status.statusCode <= 3) {
        throw new DebridNotCachedError(
          `Torrent is not cached on AllDebrid (status: ${status.status}, statusCode: ${status.statusCode})`,
          {
            service: "all-debrid",
            code: "NOT_READY",
          },
        );
      }

      // Status codes 5 to 11: known error states
      // 5: Upload fail, 6: Error, 7: Too big, 8: Archive not allowed, etc.
      if (status.statusCode >= 5 && status.statusCode <= 11) {
        throw new DebridError(
          `AllDebrid magnet processing failed: ${status.status} (code: ${status.statusCode})`,
          {
            service: "all-debrid",
            code: `MAGNET_ERROR_${status.statusCode}`,
          },
        );
      }

      // Unhandled / unknown status code
      throw new DebridError(
        `Unhandled AllDebrid magnet status: ${status.status} (statusCode: ${status.statusCode})`,
        {
          service: "all-debrid",
          code: "UNHANDLED_STATUS",
        },
      );
    }

    if (/^https?:\/\//i.test(trimmed)) {
      const unlocked = await this.unlockLink(trimmed);

      return {
        stream: {
          url: unlocked.download,
          filename: unlocked.filename,
          filesize: unlocked.filesize,
          quality: extractQuality(unlocked.filename),
          streamable: true,
        },
        cached: true,
        service: "all-debrid",
      };
    }

    throw new DebridError(
      "Unsupported input: expected magnet link (magnet:?) or HTTP/HTTPS hoster link",
      {
        service: "all-debrid",
        code: "UNSUPPORTED_INPUT",
      },
    );
  }
}
