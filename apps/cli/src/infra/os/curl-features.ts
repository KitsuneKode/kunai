/**
 * What the bare `curl` on PATH can actually do.
 *
 * Windows ships a Schannel `curl.exe` built without nghttp2. It does not
 * negotiate HTTP/2 down when asked — it refuses the flag outright:
 *
 *     curl: option --http2: the installed libcurl version doesn't support this
 *
 * and exits 4 before a single byte is sent. So anything that spawns the literal
 * `curl` has to ask before passing `--http2`, or it turns a working HTTP/1.1
 * request into a hard failure on the most common Windows install.
 *
 * This deliberately does not reuse the impersonate resolver in
 * `packages/providers`: `infra` may not import provider packages
 * (`apps/cli/test/unit/architecture/boundary-imports.test.ts`), and the two
 * answer different questions anyway. That one picks a TLS-fingerprint build to
 * clear Cloudflare; this one asks whether the plain binary understands a flag.
 * An impersonate build being present says nothing about `curl.exe`.
 */

/** Probe seam. Tests supply their own so an assertion never depends on the host's curl. */
export type CurlFeatureEnvironment = {
  /** `curl --version` stdout, or `null` when curl is absent or cannot run. */
  readonly probeVersion: () => string | null;
};

/**
 * curl prints its feature list on the third line as space-separated tokens
 * (`Features: alt-svc AsynchDNS HSTS HTTP2 HTTPS-proxy ...`). Matching the bare
 * word avoids `HTTP2-only`-style substrings in a future release note and,
 * more to the point, avoids matching the `HTTP3` token beside it.
 */
export function parseCurlHttp2Support(versionOutput: string | null): boolean {
  if (!versionOutput) return false;
  return /\bHTTP2\b/i.test(versionOutput);
}

function defaultProbeVersion(): string | null {
  try {
    const proc = Bun.spawnSync(["curl", "--version"]);
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString();
  } catch {
    // No curl on PATH, or it is a shim that cannot exec. Both mean "assume not".
    return null;
  }
}

/**
 * PATH does not change under a running process and this is read per relay
 * request, so the subprocess is paid once. Injected environments bypass the
 * cache — a test must never see another test's answer.
 */
let cachedHttp2Support: boolean | null = null;

export function curlSupportsHttp2(environment: Partial<CurlFeatureEnvironment> = {}): boolean {
  if (environment.probeVersion) return parseCurlHttp2Support(environment.probeVersion());
  cachedHttp2Support ??= parseCurlHttp2Support(defaultProbeVersion());
  return cachedHttp2Support;
}

/** Test-only: drop the memoized probe. */
export const __testing = {
  resetHttp2Cache(): void {
    cachedHttp2Support = null;
  },
  defaultProbeVersion,
};
