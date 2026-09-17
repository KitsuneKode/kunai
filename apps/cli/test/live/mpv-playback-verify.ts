/**
 * Headless mpv playback verifier for live smokes — proves decode, not just probe 200.
 *
 * Opt-in only (needs network + mpv). Uses the same header split as production
 * (`normalizeStreamHttpHeaders` in `src/infra/player/mpv-stream-http-headers.ts`):
 * referer/user-agent via dedicated options, everything else via
 * `http-header-fields`. Values containing commas are dropped because mpv
 * splits that list on commas with no escape.
 *
 * Isolated by construction: callers resolve through `createProviderSmokeProfile`
 * + `resolveProviderSmokeStream`, so no live config/data/cache is touched.
 * Output is redacted (no URLs, cookies, or /tmp paths in the returned reason).
 */

export type MpvPlaybackHeaders = Record<string, string>;

export type MpvPlaybackVerifyResult =
  | { readonly ok: true; readonly exitCode: number; readonly frames: number }
  | { readonly ok: false; readonly exitCode: number | null; readonly reason: string };

function sanitizeMpvArg(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

function pickHeader(headers: MpvPlaybackHeaders, ...names: string[]): string | undefined {
  for (const name of names) {
    const hit = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
    const value = hit?.[1]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Pure arg builder — unit-tested without spawning mpv. Returns argv *after*
 * the binary so tests assert exact forwarding.
 */
export function buildMpvPlaybackVerifyArgs(input: {
  readonly url: string;
  readonly headers?: MpvPlaybackHeaders;
  readonly frames?: number;
  readonly timeoutMs?: number;
}): string[] {
  const headers = input.headers ?? {};
  const referer = pickHeader(headers, "referer");
  const userAgent = pickHeader(headers, "user-agent");
  const origin = pickHeader(headers, "origin");
  const extraFields: string[] = [];
  if (origin && !origin.includes(",")) extraFields.push(`Origin: ${origin}`);
  for (const [name, raw] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === "referer" || lower === "user-agent" || lower === "origin") continue;
    const value = raw?.trim();
    if (!value || value.includes(",")) continue;
    extraFields.push(`${name}: ${value}`);
  }

  const args = [
    "--no-config",
    "--force-window=no",
    "--vo=null",
    "--ao=null",
    "--really-quiet",
    `--frames=${input.frames ?? 30}`,
    "--cache=yes",
  ];
  if (referer) args.push(`--referrer=${sanitizeMpvArg(referer)}`);
  if (userAgent) args.push(`--user-agent=${sanitizeMpvArg(userAgent)}`);
  if (extraFields.length > 0)
    args.push(`--http-header-fields=${sanitizeMpvArg(extraFields.join(","))}`);
  if (/mp4upload\.com$/i.test(safeHostname(input.url))) args.push("--tls-verify=no");
  args.push("--", input.url);
  return args;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Redacted argv shape for logs: cookie/signature values never leave the spawn. */
export function redactMpvArgsForLog(args: readonly string[]): string[] {
  return args.map((arg) =>
    /^--http-header-fields=/i.test(arg) ? arg.replace(/(cookie[^,]*)/gi, "Cookie: REDACTED") : arg,
  );
}

function redactReason(reason: string): string {
  return reason
    .replace(/https?:\/\/[^\s"'\\]+/gi, "https://REDACTED")
    .replace(/\/tmp\/[^\s"'\\]+/gi, "/tmp/REDACTED")
    .slice(0, 500);
}

/**
 * Spawn headless mpv and wait for decode. Success is exit 0 after decoding
 * up to `frames` frames. Non-zero exit, stderr `error`, or timeout kill is
 * evidence the stream does not play even if the HTTP probe was reachable.
 */
export async function verifyStreamPlaysInMpv(input: {
  readonly mpvBinary?: string;
  readonly url: string;
  readonly headers?: MpvPlaybackHeaders;
  readonly frames?: number;
  readonly timeoutMs?: number;
}): Promise<MpvPlaybackVerifyResult> {
  const mpvBinary = input.mpvBinary ?? Bun.which("mpv") ?? "mpv";
  if (!Bun.which(mpvBinary) && mpvBinary === "mpv") {
    return { ok: false, exitCode: null, reason: "mpv missing on PATH" };
  }
  const timeoutMs = input.timeoutMs ?? 20_000;
  const args = buildMpvPlaybackVerifyArgs(input);
  const proc = Bun.spawn([mpvBinary, ...args], { stdout: "pipe", stderr: "pipe" });

  const stderrChunks: string[] = [];
  const reader = proc.stderr.getReader();
  const readStderr = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        stderrChunks.push(new TextDecoder().decode(value));
      }
    } catch {
      // Stderr is diagnostic only; a read failure must not fail verification.
    } finally {
      reader.releaseLock();
    }
  })();

  const exitPromise = proc.exited.then((code) => ({ type: "exit" as const, code }));
  const timeoutPromise = Bun.sleep(timeoutMs).then(() => ({ type: "timeout" as const }));
  const outcome = await Promise.race([exitPromise, timeoutPromise]);
  if (outcome.type === "timeout") {
    try {
      proc.kill("SIGTERM");
    } catch {
      // Already exited between the race and the kill.
    }
    await readStderr;
    return { ok: false, exitCode: null, reason: "mpv verify timed out without decoding" };
  }
  await readStderr;
  if (outcome.code === 0) {
    return { ok: true, exitCode: 0, frames: input.frames ?? 30 };
  }
  return {
    ok: false,
    exitCode: outcome.code,
    reason: redactReason(stderrChunks.join("").trim() || `mpv exited with code ${outcome.code}`),
  };
}
