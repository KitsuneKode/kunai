/**
 * README quick-start extraction + fixture-assets execution harness.
 *
 * Parses the canonical Quick Start Install bash block (order + text must match
 * README). Fixture mode executes the extracted command strings for
 * version/mpv/setup/search. The only documented command rewrite is appending
 * non-interactive install.sh flags (`bash -s -- --yes --skip-deps --version`);
 * release download endpoints are substituted via KUNAI_DL_BASE /
 * KUNAI_RELEASES_API + a curl shim for raw.githubusercontent.com install.sh.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type ReadmeCommandMode = "fixture-assets" | "published-assets";

export interface ReadmeCommandVerification {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly commitSha: string;
  readonly mode: ReadmeCommandMode;
  readonly commands: readonly {
    readonly id: string;
    readonly command: string;
    readonly exitCode: number;
    readonly passed: boolean;
  }[];
}

export const README_QUICK_START_IDS = [
  "install",
  "version",
  "mpv-version",
  "setup",
  "first-search",
] as const;

export type ReadmeQuickStartId = (typeof README_QUICK_START_IDS)[number];

const CANONICAL_INSTALL =
  "curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash";

/**
 * Extract the canonical Quick Start Install bash commands from README markdown.
 * Prefers the `### Install` section under Quick Start; falls back to the first
 * bash fence that contains the native install curl line.
 */
export function extractReadmeQuickStart(readme: string): readonly string[] {
  const installSection = readme.match(
    /## Quick Start[\s\S]*?### Install([\s\S]*?)(?=\n### |\n## |$)/,
  );
  const searchIn = installSection?.[1] ?? readme;
  const fenceMatch = searchIn.match(/```bash\n([\s\S]*?)```/);
  if (!fenceMatch) {
    throw new Error("extractReadmeQuickStart: no ```bash fence found in Quick Start Install");
  }
  const body = fenceMatch[1]!;
  if (!body.includes(CANONICAL_INSTALL)) {
    throw new Error(
      "extractReadmeQuickStart: Install bash fence does not contain the canonical curl|bash install",
    );
  }
  const lines = body
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.trimStart().startsWith("#"));
  if (lines.length === 0) {
    throw new Error("extractReadmeQuickStart: Install bash fence has no command lines");
  }
  return lines;
}

export function commitShaShort(cwd = process.cwd()): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) return "unknown";
  return result.stdout.trim();
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export type FixtureReleaseTree = {
  readonly root: string;
  readonly assetName: string;
  readonly version: string;
  cleanup: () => void;
};

/** Build a mock GitHub Releases tree (same layout as prepare-fixture.sh). */
export function prepareReadmeFixtureRelease(options: {
  readonly binaryPath: string;
  readonly version: string;
  readonly assetName?: string;
  readonly installShPath: string;
}): FixtureReleaseTree {
  const root = mkdtempSync(join(tmpdir(), "kunai-readme-fixture-"));
  const assetName = options.assetName ?? "kunai-linux-x64";
  const version = options.version.replace(/^v/, "");
  const dest = join(root, "download", `v${version}`);
  mkdirSync(dest, { recursive: true });
  copyFileSync(options.binaryPath, join(dest, assetName));
  chmodSync(join(dest, assetName), 0o755);
  const hash = sha256File(join(dest, assetName));
  writeFileSync(join(dest, "SHA256SUMS"), `${hash}  ${assetName}\n`);
  mkdirSync(join(root, "releases"), { recursive: true });
  writeFileSync(
    join(root, "releases", "latest.json"),
    JSON.stringify({ tag_name: `v${version}`, name: `v${version}` }),
  );
  copyFileSync(options.installShPath, join(root, "install.sh"));
  // Path that mirrors raw.githubusercontent.com so a curl shim can rewrite.
  const rawDir = join(root, "raw", "KitsuneKode", "kunai", "main");
  mkdirSync(rawDir, { recursive: true });
  copyFileSync(options.installShPath, join(rawDir, "install.sh"));
  return {
    root,
    assetName,
    version,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export type IsolatedReadmeProfile = {
  readonly root: string;
  readonly home: string;
  readonly binDir: string;
  readonly shimDir: string;
  readonly configDir: string;
  readonly dataDir: string;
  readonly cacheDir: string;
  cleanup: () => void;
};

export function createIsolatedReadmeProfile(label = "readme"): IsolatedReadmeProfile {
  const root = mkdtempSync(join(tmpdir(), `kunai-${label}-`));
  const home = join(root, "home");
  const binDir = join(home, ".local", "bin");
  const shimDir = join(root, "shims");
  const configDir = join(home, ".config", "kunai");
  const dataDir = join(home, ".local", "share", "kunai");
  const cacheDir = join(home, ".cache", "kunai");
  for (const dir of [home, binDir, shimDir, configDir, dataDir, cacheDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return {
    root,
    home,
    binDir,
    shimDir,
    configDir,
    dataDir,
    cacheDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Minimal mpv stub: --version works; other invocations exit 0. */
export function installFakeMpv(shimDir: string): string {
  const path = join(shimDir, "mpv");
  writeFileSync(
    path,
    `#!/bin/sh
# kunai readme-command harness fake mpv
if [ "$1" = "--version" ]; then
  echo "mpv 0.37.0-kunai-fake Copyright © harness"
  exit 0
fi
# Record argv for later assertions (IPC smoke is Task 6).
echo "$*" >> "$(dirname "$0")/mpv-invocations.log" 2>/dev/null || true
exit 0
`,
    { mode: 0o755 },
  );
  return path;
}

/**
 * curl shim: rewrite raw.githubusercontent.com kunai install.sh URLs to the
 * local fixture HTTP server. All other URLs pass through to real curl.
 */
export function installCurlShim(shimDir: string, fixtureBaseUrl: string): void {
  const realCurl = Bun.which("curl");
  if (!realCurl) throw new Error("curl is required for README install verification");
  const path = join(shimDir, "curl");
  writeFileSync(
    path,
    `#!/bin/sh
REAL_CURL=${JSON.stringify(realCurl)}
FIXTURE=${JSON.stringify(fixtureBaseUrl.replace(/\/$/, ""))}
rewritten=0
args=
for arg in "$@"; do
  case "$arg" in
    https://raw.githubusercontent.com/KitsuneKode/kunai/*/install.sh)
      arg="$FIXTURE/install.sh"
      rewritten=1
      ;;
  esac
  # shellcheck disable=SC2089
  args="$args $(printf '%q' "$arg")"
done
# When fetching the installer script, append non-interactive fixture flags via
# bash -s if the caller pipes to bash with no args (exact README shape).
eval "exec \\"$REAL_CURL\\" $args"
`,
    { mode: 0o755 },
  );
}

async function startFixtureServer(fixtureRoot: string): Promise<{
  readonly baseUrl: string;
  stop: () => void;
}> {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname = pathname.slice(0, -1);
      if (pathname === "") pathname = "/";
      const rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
      const filePath = join(fixtureRoot, rel);
      if (!filePath.startsWith(fixtureRoot) || !existsSync(filePath)) {
        return new Response("not found", { status: 404 });
      }
      const file = Bun.file(filePath);
      return new Response(file);
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

function profileEnv(
  profile: IsolatedReadmeProfile,
  extras: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const pathParts = [profile.binDir, profile.shimDir, "/usr/bin", "/bin"];
  return {
    ...process.env,
    ...extras,
    HOME: profile.home,
    USERPROFILE: profile.home,
    KUNAI_BIN_DIR: profile.binDir,
    KUNAI_CONFIG_DIR: profile.configDir,
    KUNAI_DATA_DIR: profile.dataDir,
    KUNAI_CACHE_DIR: profile.cacheDir,
    XDG_CONFIG_HOME: join(profile.home, ".config"),
    XDG_DATA_HOME: join(profile.home, ".local", "share"),
    XDG_CACHE_HOME: join(profile.home, ".cache"),
    PATH: pathParts.join(":"),
    CI: "1",
    DO_NOT_TRACK: "1",
    // Avoid host TERM quirks; script(1) still allocates a PTY.
    TERM: "xterm-256color",
  };
}

type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

async function runShell(
  command: string,
  env: NodeJS.ProcessEnv,
  options: { readonly cwd?: string; readonly timeoutMs?: number } = {},
): Promise<CommandResult> {
  const proc = Bun.spawn(["bash", "-lc", command], {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeoutMs = options.timeoutMs ?? 120_000;
  const timedOut = AbortSignal.timeout(timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      Promise.race([
        proc.exited,
        new Promise<number>((_, reject) => {
          timedOut.addEventListener("abort", () => {
            try {
              proc.kill();
            } catch {
              // ignore
            }
            reject(new Error(`command timed out after ${timeoutMs}ms: ${command}`));
          });
        }),
      ]),
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    // no-op
  }
}

/**
 * Run an extracted README shell command under `script(1)` so Ink gets a PTY.
 * Ready = process still alive after settleMs (UI mounted and waiting for input).
 * Ink often does not echo into util-linux `script` typescripts on this host, so
 * we do not require transcript text matches.
 *
 * `command` must be the extracted README text (e.g. `kunai --setup`); PATH from
 * the isolated profile resolves `kunai` / `mpv`.
 */
async function runCommandUnderPty(options: {
  readonly command: string;
  readonly env: NodeJS.ProcessEnv;
  readonly settleMs?: number;
  readonly timeoutMs?: number;
  readonly transcriptPath: string;
}): Promise<CommandResult & { readonly ready: boolean }> {
  const settleMs = options.settleMs ?? 2500;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const proc = Bun.spawn(["script", "-qec", options.command, options.transcriptPath], {
    env: options.env,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

  const deadline = Date.now() + timeoutMs;
  let ready = false;
  // Wait for settle window — process still running means the TUI mounted.
  const settleUntil = Date.now() + settleMs;
  while (Date.now() < settleUntil && Date.now() < deadline) {
    await Bun.sleep(100);
    if (proc.exitCode !== null) break;
  }
  if (proc.exitCode === null) {
    ready = true;
    // Hold briefly so callers can observe a stable mount.
    await Bun.sleep(Math.min(500, Math.max(0, deadline - Date.now())));
  }

  try {
    proc.kill("SIGTERM");
  } catch {
    // already exited
  }
  const exitCode = await Promise.race([
    proc.exited,
    Bun.sleep(3_000).then(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      return 1;
    }),
  ]);
  const transcript = existsSync(options.transcriptPath)
    ? readFileSync(options.transcriptPath, "utf8")
    : "";
  return {
    exitCode: typeof exitCode === "number" ? exitCode : 1,
    stdout: transcript,
    stderr: "",
    ready,
  };
}

export type VerifyReadmeCommandsInput = {
  readonly mode: ReadmeCommandMode;
  readonly version: string;
  readonly binaryPath: string;
  readonly repoRoot: string;
  readonly readmePath?: string;
  readonly commitSha?: string;
};

/**
 * Execute the exact README quick-start sequence against fixture (or published) assets.
 */
export async function verifyReadmeCommands(
  input: VerifyReadmeCommandsInput,
): Promise<ReadmeCommandVerification> {
  const repoRoot = resolve(input.repoRoot);
  const readmePath = input.readmePath ?? join(repoRoot, "README.md");
  const readme = readFileSync(readmePath, "utf8");
  const commands = extractReadmeQuickStart(readme);
  if (commands.length !== README_QUICK_START_IDS.length) {
    throw new Error(
      `expected ${README_QUICK_START_IDS.length} quick-start commands, got ${commands.length}: ${JSON.stringify(commands)}`,
    );
  }

  const commitSha = input.commitSha ?? commitShaShort(repoRoot);
  const version = input.version.replace(/^v/, "");

  if (input.mode === "published-assets") {
    throw new Error(
      "published-assets mode requires a live GitHub Release; use --mode fixture-assets for local/CI verification",
    );
  }

  if (!existsSync(input.binaryPath)) {
    throw new Error(`binary not found: ${input.binaryPath}`);
  }

  const profile = createIsolatedReadmeProfile("readme-verify");
  const fixture = prepareReadmeFixtureRelease({
    binaryPath: resolve(input.binaryPath),
    version,
    installShPath: join(repoRoot, "install.sh"),
  });
  const server = await startFixtureServer(fixture.root);

  const results: {
    id: string;
    command: string;
    exitCode: number;
    passed: boolean;
  }[] = [];

  try {
    installCurlShim(profile.shimDir, server.baseUrl);
    // Install step: no fake mpv yet — proves later that setup works without mpv.
    const installEnv = profileEnv(profile, {
      KUNAI_DL_BASE: server.baseUrl,
      KUNAI_RELEASES_API: `${server.baseUrl}/releases/latest.json`,
    });

    // Exact README install shape (curl|bash). Only documented rewrite: append
    // non-interactive fixture flags via `bash -s -- …` (endpoint substitution is
    // env/shim only). Reported command text stays the exact README curl|bash line.
    const installPipeline = commands[0]!.replace(
      /\| bash\s*$/,
      `| bash -s -- --yes --skip-deps --version ${version}`,
    );
    const installResult = await runShell(installPipeline, installEnv, { timeoutMs: 180_000 });
    const kunaiBin = join(profile.binDir, "kunai");
    const installPassed =
      installResult.exitCode === 0 &&
      existsSync(kunaiBin) &&
      existsSync(join(profile.configDir, "install.json"));
    results.push({
      id: "install",
      command: commands[0]!,
      exitCode: installResult.exitCode,
      passed: installPassed,
    });
    if (!installPassed) {
      throw new Error(
        `install failed (exit ${installResult.exitCode}):\n${installResult.stdout}\n${installResult.stderr}`,
      );
    }

    // Execute extracted README text (not hardcoded argv). PATH resolves `kunai`.
    const versionCmd = commands[1]!;
    const versionResult = await runShell(versionCmd, installEnv);
    const versionOk =
      versionResult.exitCode === 0 && /kunai\s+\d+\.\d+\.\d+/i.test(versionResult.stdout);
    results.push({
      id: "version",
      command: versionCmd,
      exitCode: versionResult.exitCode,
      passed: versionOk,
    });

    // Harness probe (not a README line): setup still mounts when mpv is absent.
    const setupNoMpvTranscript = join(profile.root, "setup-no-mpv.log");
    const setupNoMpv = await runCommandUnderPty({
      command: "kunai --setup",
      env: installEnv,
      settleMs: 2500,
      timeoutMs: 30_000,
      transcriptPath: setupNoMpvTranscript,
    });
    const setupWithoutMpvOk = setupNoMpv.ready;

    // mpv --version with fake mpv on PATH — extracted README text.
    const fakeMpvPath = installFakeMpv(profile.shimDir);
    const withMpvEnv = profileEnv(profile, {
      KUNAI_DL_BASE: server.baseUrl,
      KUNAI_RELEASES_API: `${server.baseUrl}/releases/latest.json`,
    });
    const mpvCmd = commands[2]!;
    const mpvResult = await runShell(mpvCmd, withMpvEnv);
    const mpvOk = mpvResult.exitCode === 0 && /mpv/i.test(mpvResult.stdout);
    results.push({
      id: "mpv-version",
      command: mpvCmd,
      exitCode: mpvResult.exitCode,
      passed: mpvOk,
    });

    // README kunai --setup (extracted text) with fake mpv available.
    const setupTranscript = join(profile.root, "setup.log");
    // Reset onboarding so --setup actually runs.
    writeFileSync(
      join(profile.configDir, "config.json"),
      `${JSON.stringify({ onboardingVersion: 0, downloadOnboardingDismissed: false })}\n`,
    );
    const setupCmd = commands[3]!;
    const setupResult = await runCommandUnderPty({
      command: setupCmd,
      env: withMpvEnv,
      settleMs: 2500,
      timeoutMs: 30_000,
      transcriptPath: setupTranscript,
    });
    const setupOk = setupWithoutMpvOk && setupResult.ready;
    results.push({
      id: "setup",
      command: setupCmd,
      exitCode: setupResult.exitCode,
      passed: setupOk,
    });

    // First search — execute extracted README text under PTY; fake mpv on PATH.
    writeFileSync(
      join(profile.configDir, "config.json"),
      `${JSON.stringify({ onboardingVersion: 2, downloadOnboardingDismissed: true })}\n`,
    );
    const searchTranscript = join(profile.root, "search.log");
    const searchCmd = commands[4]!;
    const searchResult = await runCommandUnderPty({
      command: searchCmd,
      env: withMpvEnv,
      settleMs: 3500,
      timeoutMs: 45_000,
      transcriptPath: searchTranscript,
    });
    // Task 5 scope: README search command boots in the fixture profile with fake
    // mpv resolvable on PATH (after setup-without-mpv already succeeded).
    // Fixture-provider reach and fake-mpv IPC / invocation evidence are Task 6.
    const whichMpv = await runShell("command -v mpv", withMpvEnv);
    const fakeMpvOnPath =
      whichMpv.exitCode === 0 && whichMpv.stdout.trim() === fakeMpvPath && existsSync(fakeMpvPath);
    results.push({
      id: "first-search",
      command: searchCmd,
      exitCode: searchResult.exitCode,
      passed: searchResult.ready && fakeMpvOnPath && setupWithoutMpvOk,
    });

    return {
      schemaVersion: 1,
      version,
      commitSha,
      mode: input.mode,
      commands: results,
    };
  } finally {
    server.stop();
    fixture.cleanup();
    profile.cleanup();
  }
}

export function allReadmeCommandsPassed(report: ReadmeCommandVerification): boolean {
  return report.commands.length > 0 && report.commands.every((c) => c.passed);
}
