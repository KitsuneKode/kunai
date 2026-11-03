import type { ProviderRuntimeContext } from "@kunai/types";

export type DebridServiceId = "real-debrid" | "all-debrid";

export interface DebridAccountInfo {
  username: string;
  email?: string;
  premium: boolean;
  expirationDate?: string;
  points?: number;
}

export interface DebridStream {
  url: string;
  filename: string;
  filesize: number;
  quality?: string;
  streamable: boolean;
}

export interface DebridResolveResult {
  stream: DebridStream;
  cached: boolean;
  service: DebridServiceId;
}

export interface DebridClient {
  readonly serviceId: DebridServiceId;
  getUser(): Promise<DebridAccountInfo>;
  resolveStream(
    magnetOrLink: string,
    context?: ProviderRuntimeContext,
  ): Promise<DebridResolveResult>;
}

export type DebridFetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface DebridErrorOptions {
  readonly service: DebridServiceId;
  readonly statusCode?: number;
  readonly code?: string;
  readonly cause?: unknown;
}

export class DebridError extends Error {
  readonly service: DebridServiceId;
  readonly statusCode?: number;
  readonly code?: string;

  constructor(message: string, options: DebridErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "DebridError";
    this.service = options.service;
    this.statusCode = options.statusCode;
    this.code = options.code;
  }
}

export class DebridAuthError extends DebridError {
  constructor(message: string, options: DebridErrorOptions) {
    super(message, options);
    this.name = "DebridAuthError";
  }
}

export class DebridSubscriptionExpiredError extends DebridError {
  constructor(message: string, options: DebridErrorOptions) {
    super(message, options);
    this.name = "DebridSubscriptionExpiredError";
  }
}

export class DebridRateLimitError extends DebridError {
  constructor(message: string, options: DebridErrorOptions) {
    super(message, options);
    this.name = "DebridRateLimitError";
  }
}

export class DebridNotCachedError extends DebridError {
  constructor(message: string, options: DebridErrorOptions) {
    super(message, options);
    this.name = "DebridNotCachedError";
  }
}

/**
 * Extracts a normalized video resolution label from a filename (e.g. "1080p", "720p", "2160p").
 */
export function extractQuality(filename: string): string | undefined {
  const match = filename.match(
    /(?:^|[^a-zA-Z0-9])(2160p|4k|uhd|1080p|fhd|720p|hd|480p|sd|360p)(?:$|[^a-zA-Z0-9])/i,
  );
  const matched = match?.[1];
  if (!matched) return undefined;
  const raw = matched.toLowerCase();
  if (raw === "4k" || raw === "uhd") return "2160p";
  if (raw === "fhd") return "1080p";
  if (raw === "hd") return "720p";
  if (raw === "sd") return "480p";
  return raw;
}

/**
 * Extracts the BTIH info hash from a magnet URI or returns the hash if already bare.
 */
export function extractTorrentHash(magnetOrHash: string): string | null {
  const trimmed = magnetOrHash.trim();
  if (/^[0-9a-fA-F]{40}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (/^[2-7a-zA-Z]{32}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const match = trimmed.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
  return match?.[1] ? match[1].toLowerCase() : null;
}
