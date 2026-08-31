import type { MobileHttpRequest } from "../../application/contracts";
import { requirePortableHttpUrl } from "../../application/portable-url";

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label}`);
  return value;
}

function quoteCurlConfig(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function encodeCurlConfig(request: MobileHttpRequest): string {
  const rawUrl = requirePortableHttpUrl(request.url, "Probe URL");
  const timeoutMs = requirePositiveInteger(request.timeoutMs, "timeout");
  const maxBytes = requirePositiveInteger(request.maxBytes, "response cap");
  const normalizedUrl = new URL(rawUrl).href;
  return [
    `url = ${quoteCurlConfig(normalizedUrl)}`,
    `request = ${quoteCurlConfig(request.method)}`,
    `max-time = ${timeoutMs / 1_000}`,
    `max-filesize = ${maxBytes}`,
    "",
  ].join("\n");
}
