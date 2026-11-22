import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
  type JsonObject,
  type JsonValue,
  type LooseJsonValue,
} from "./json-value";

export type ProviderHotfixEntry = {
  readonly baseUrl?: string;
  readonly mirrors?: readonly string[];
  readonly deadServers?: readonly string[];
  readonly disabled?: boolean;
  readonly cryptoOverrides?: Readonly<Record<string, string>>;
};

export type ProviderHotfixManifest = {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly lanePriorities?: {
    readonly anime?: readonly string[];
    readonly series?: readonly string[];
    readonly movie?: readonly string[];
    readonly youtube?: readonly string[];
  };
  readonly providers: Readonly<Record<string, ProviderHotfixEntry>>;
};

export type SignedProviderManifestEnvelope = {
  readonly keyId: string;
  readonly signature: string;
  readonly manifest: ProviderHotfixManifest;
};

export type ManifestVerificationResult =
  | {
      readonly ok: true;
      readonly manifest: ProviderHotfixManifest;
      readonly keyId: string;
      readonly signature: string;
    }
  | { readonly ok: false; readonly reason: string };

export const MAX_MANIFEST_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SAFE_PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BANNED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isPrivateIpv4Octets(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateOrLoopbackHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (host.includes(":")) {
    if (
      host === "::1" ||
      host === "::" ||
      host.startsWith("fe80:") ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    ) {
      return true;
    }
    const mappedDotted = /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (mappedDotted) {
      return isPrivateIpv4Octets(Number(mappedDotted[1]), Number(mappedDotted[2]));
    }
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mappedHex?.[1]) {
      const hi = Number.parseInt(mappedHex[1], 16);
      return isPrivateIpv4Octets((hi >> 8) & 0xff, hi & 0xff);
    }
    return false;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  return isPrivateIpv4Octets(Number(ipv4[1]), Number(ipv4[2]));
}

/** Rejects non-HTTPS, credentialed, control-char, or private/loopback URLs. */
export function isSafeManifestHttpsUrl(value: string): boolean {
  if (!value || value.length > 2048 || hasControlChars(value)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (!parsed.hostname || isPrivateOrLoopbackHost(parsed.hostname)) return false;
  return true;
}

function isSafeProviderId(value: string): boolean {
  return !BANNED_KEYS.has(value) && SAFE_PROVIDER_ID_RE.test(value);
}

function isJsonBoolean(value: LooseJsonValue): value is boolean {
  return value === true || value === false;
}

function isStringArray(value: LooseJsonValue): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => isJsonString(item));
}

function isSafeProviderIdList(value: LooseJsonValue): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every((item) => isJsonString(item) && isSafeProviderId(item))
  );
}

function isSafeCryptoOverrides(value: LooseJsonValue): value is Readonly<Record<string, string>> {
  if (!isJsonObject(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > 32) return false;
  return entries.every(
    ([k, v]) =>
      !BANNED_KEYS.has(k) &&
      k.length > 0 &&
      k.length <= 64 &&
      !hasControlChars(k) &&
      isJsonString(v) &&
      v.length <= 256 &&
      !hasControlChars(v),
  );
}

function isValidHotfixEntry(value: LooseJsonValue): value is ProviderHotfixEntry {
  if (!isJsonObject(value)) return false;
  if (
    value.baseUrl !== undefined &&
    (!isJsonString(value.baseUrl) || !isSafeManifestHttpsUrl(value.baseUrl))
  ) {
    return false;
  }
  if (
    value.mirrors !== undefined &&
    (!isStringArray(value.mirrors) ||
      value.mirrors.length > 32 ||
      !value.mirrors.every((m) => isSafeManifestHttpsUrl(m)))
  ) {
    return false;
  }
  if (
    value.deadServers !== undefined &&
    (!isStringArray(value.deadServers) ||
      value.deadServers.length > 64 ||
      !value.deadServers.every((d) => d.length > 0 && d.length <= 2048 && !hasControlChars(d)))
  ) {
    return false;
  }
  if (value.disabled !== undefined && !isJsonBoolean(value.disabled)) return false;
  if (value.cryptoOverrides !== undefined && !isSafeCryptoOverrides(value.cryptoOverrides)) {
    return false;
  }
  return true;
}

export function isValidProviderHotfixManifest(
  value: LooseJsonValue,
): value is ProviderHotfixManifest {
  if (!isJsonObject(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (!isJsonNumber(value.revision) || !Number.isInteger(value.revision) || value.revision < 1) {
    return false;
  }
  if (!isJsonString(value.generatedAt) || Number.isNaN(Date.parse(value.generatedAt))) {
    return false;
  }
  if (!isJsonString(value.expiresAt) || Number.isNaN(Date.parse(value.expiresAt))) {
    return false;
  }
  const generatedMs = Date.parse(value.generatedAt);
  const expiresMs = Date.parse(value.expiresAt);
  if (expiresMs <= generatedMs || expiresMs - generatedMs > MAX_MANIFEST_LIFETIME_MS) {
    return false;
  }
  if (value.lanePriorities !== undefined) {
    if (!isJsonObject(value.lanePriorities)) return false;
    for (const lane of ["anime", "series", "movie", "youtube"] as const) {
      const list = value.lanePriorities[lane];
      if (list !== undefined && !isSafeProviderIdList(list)) return false;
    }
  }
  if (!isJsonObject(value.providers)) return false;
  const providerEntries = Object.entries(value.providers);
  if (providerEntries.length > 128) return false;
  for (const [id, entry] of providerEntries) {
    if (!isSafeProviderId(id)) return false;
    if (!isValidHotfixEntry(entry)) return false;
  }
  return true;
}

function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isJsonObject(value)) return value;
  const entries: [string, JsonValue][] = [];
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item !== undefined) entries.push([key, sortJsonValue(item)]);
  }
  // SAFETY: Every entry value is a validated JsonValue; Object.fromEntries produces a plain JsonObject.
  return Object.fromEntries(entries) as JsonObject;
}

/** Deterministic UTF-8 bytes used as the Ed25519 signing payload. */
export function canonicalizeManifestPayload(manifest: ProviderHotfixManifest): Uint8Array {
  // SAFETY: JSON.parse(JSON.stringify(manifest)) always produces a valid JsonValue tree.
  const normalized = JSON.parse(JSON.stringify(manifest)) as JsonValue;
  return new TextEncoder().encode(JSON.stringify(sortJsonValue(normalized)));
}

export function signProviderManifest(
  manifest: ProviderHotfixManifest,
  privateKeyPem: string,
  keyId: string,
): SignedProviderManifestEnvelope {
  const payload = canonicalizeManifestPayload(manifest);
  const key = createPrivateKey(privateKeyPem);
  const signature = sign(null, payload, key).toString("base64");
  return { keyId, signature, manifest };
}

/**
 * Fails closed if the envelope is malformed, signed with an unknown/invalid key,
 * tampered with, future-dated past clock skew, or expired relative to `nowMs`.
 */
export function verifySignedProviderManifest(
  raw: LooseJsonValue | SignedProviderManifestEnvelope,
  trustedPublicKeysById: Readonly<Record<string, string>>,
  nowMs: number = Date.now(),
): ManifestVerificationResult {
  if (!isJsonObject(raw)) return { ok: false, reason: "Envelope is not an object" };
  if (
    !isJsonString(raw.keyId) ||
    !raw.keyId ||
    raw.keyId.length > 64 ||
    hasControlChars(raw.keyId)
  ) {
    return { ok: false, reason: "Missing or invalid signing keyId" };
  }
  if (!isJsonString(raw.signature) || !raw.signature || raw.signature.length > 256) {
    return { ok: false, reason: "Missing Ed25519 signature" };
  }
  const publicKeyPem = Object.hasOwn(trustedPublicKeysById, raw.keyId)
    ? trustedPublicKeysById[raw.keyId]
    : undefined;
  if (!publicKeyPem) {
    return { ok: false, reason: `Untrusted signing keyId: ${raw.keyId}` };
  }
  if (!isValidProviderHotfixManifest(raw.manifest)) {
    return { ok: false, reason: "Manifest failed schema validation" };
  }
  const generatedAtMs = Date.parse(raw.manifest.generatedAt);
  if (generatedAtMs > nowMs + MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: "Manifest generatedAt is in the future" };
  }
  const expiresAtMs = Date.parse(raw.manifest.expiresAt);
  if (expiresAtMs <= nowMs) {
    return { ok: false, reason: "Manifest has expired" };
  }
  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(raw.signature, "base64");
  } catch {
    return { ok: false, reason: "Signature is not valid base64" };
  }
  if (signatureBytes.length !== 64) {
    return { ok: false, reason: "Ed25519 signature must be 64 bytes" };
  }
  try {
    const publicKey = createPublicKey(publicKeyPem);
    const payload = canonicalizeManifestPayload(raw.manifest);
    const valid = verify(null, payload, publicKey, signatureBytes);
    if (!valid) return { ok: false, reason: "Ed25519 signature verification failed" };
    return { ok: true, manifest: raw.manifest, keyId: raw.keyId, signature: raw.signature };
  } catch {
    return { ok: false, reason: "Ed25519 verification threw" };
  }
}

export function resolveProviderHotfixEntry(
  manifest: ProviderHotfixManifest | null | undefined,
  providerId: string,
): ProviderHotfixEntry | null {
  if (!manifest) return null;
  return manifest.providers[providerId] ?? null;
}

export function normalizeMirrorUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const trimmedPath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin.toLowerCase()}${trimmedPath}${parsed.search}`;
  } catch {
    return value.trim().replace(/\/+$/, "").toLowerCase();
  }
}

export function mergeProviderMirrors(
  bundledMirrors: readonly string[],
  hotfix: ProviderHotfixEntry | null,
): readonly string[] {
  if (!hotfix) return bundledMirrors;
  const dead = new Set((hotfix.deadServers ?? []).map(normalizeMirrorUrl));
  const combined = [
    ...(hotfix.baseUrl ? [hotfix.baseUrl] : []),
    ...(hotfix.mirrors ?? []),
    ...bundledMirrors,
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of combined) {
    const key = normalizeMirrorUrl(url);
    if (!url || dead.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(url);
  }
  return result;
}
