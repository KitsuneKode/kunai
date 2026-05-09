export type DownloadStreamPolicy = {
  readonly headers: Record<string, string>;
  readonly ffmpegArgs: readonly string[];
};

export function buildDownloadStreamPolicy(headers: Record<string, string>): DownloadStreamPolicy {
  const normalized = normalizeHeaders(headers);
  const args: string[] = [
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_on_network_error",
    "1",
    "-reconnect_delay_max",
    "10",
    "-rw_timeout",
    "15000000",
  ];
  const headerLines = Object.entries(normalized)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\r\n");
  if (headerLines.length > 0) {
    args.unshift("-headers", `${headerLines}\r\n`);
  }
  return { headers: normalized, ffmpegArgs: args };
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(headers)) {
    if (!value) continue;
    const key = canonicalHeaderKey(rawKey);
    output[key] = value;
  }
  const referer = output["Referer"] ?? output["referer"];
  if (referer) output.Referer = referer;
  const userAgent = output["User-Agent"] ?? output["user-agent"];
  if (userAgent) output["User-Agent"] = userAgent;
  const origin = output.Origin ?? output.origin;
  if (origin) output.Origin = origin;
  return output;
}

function canonicalHeaderKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === "user-agent") return "User-Agent";
  if (lower === "referer") return "Referer";
  if (lower === "origin") return "Origin";
  if (lower === "accept") return "Accept";
  if (lower === "accept-language") return "Accept-Language";
  return key;
}
