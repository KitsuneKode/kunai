import type { ShellChrome } from "@/container";
import {
  AUDIO_PREFERENCE_OPTIONS,
  PROVIDER_QUALITY_PREFERENCE_OPTIONS,
  SUBTITLE_PREFERENCE_OPTIONS,
} from "@/domain/media/media-preferences";
import { parsePlayerChoice, type PlayerChoice } from "@/domain/playback/player-choice";
import type { MpvRuntimeOptions } from "@/infra/player/mpv-runtime-options";
import { HDR_MODES, isHdrMode, type HdrMode } from "@kunai/config";
import { isMpvHwdecMode, MPV_HWDEC_MODES, type MpvHwdecMode } from "@kunai/config";

/**
 * A malformed invocation — unknown flag, missing value, mistyped subcommand,
 * unreadable `-i` id. `runCli` prints the message plus a help pointer and
 * exits 2, the usage-error code `kunai completion` already uses. Warnings
 * (`--jump 0`, `--youtube` overriding `--anime`) still parse; errors do not —
 * a script must be able to tell "I typo'd a flag" apart from success.
 */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export type CliArgs = {
  search?: string;
  id?: string;
  type?: string;
  anime: boolean;
  youtube: boolean;
  debug: boolean;
  debugJson: boolean;
  debugSession: boolean;
  supportBundle: boolean;
  zen: boolean;
  mpv: MpvRuntimeOptions;
  player: PlayerChoice | undefined;
  minimal: boolean;
  plain: boolean;
  quick: boolean;
  jump?: number;
  episode?: number;
  season?: number;
  quality?: string;
  audio?: string;
  subtitle?: string;
  hdr?: HdrMode;
  mpvHwdec?: MpvHwdecMode;
  mpvAvsyncRecovery?: boolean;
  setup: boolean;
  offline: boolean;
  history: boolean;
  continuePlayback: boolean;
  download: boolean;
  downloadPath?: string;
  handoffUrl?: string;
  openUrl?: string;
  installProtocolHandler: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
  version: boolean;
  initialRoute?: "recommendation" | "calendar" | "random";
  shellChrome: ShellChrome;
};

/** `--help` output. Grouped by purpose; mirrors the flags parsed in parseCliArgs. */
export function buildCliHelpText(version: string): string {
  return `Kunai ${version} — terminal-first anime & series streaming.

USAGE
  kunai [options]            Launch the interactive shell
  kunai -S "Dune"            Search straight away
  kunai -i 438631 -t movie   Open a known TMDB id
  kunai -i anilist:21        Open a known AniList id (anime lane)
  kunai -a                   Start in anime mode
  kunai -y                   Start in YouTube mode

LAUNCH
  -S, --search <query>       Search for a title on launch
  -i, --id <id>              Open a specific title id or namespaced catalog id
                             (bare = TMDB; or anilist:<id>, mal:<id>,
                             tmdb:<id>, youtube:<id>)
  -t, --type <movie|tv>      Content type for --id (tv = series)
  -a, --anime                Anime mode (HiAnime default with provider fallback)
  -y, --youtube              YouTube mode (YouTube provider)
      --continue, --resume   Jump into Continue Watching
      --history              Open watch history
      --offline              Offline library only (no provider calls)
      --discover             Open recommendations
      --calendar             Open the release calendar
      --random               Open the random picks tray
      --download             Download a title without playback (-S or -i required)
      --onboarding, --setup  Run the guided onboarding wizard

DISPLAY
  -m, --minimal              Minimal chrome
  -z, --zen                  Zen mode (bare, ani-cli-style)
      --plain                Plain / screen-reader mode (no animation, no box art, text state)
  -q, --quick                Quick layout
      --jump <n>             Auto-pick the n-th search result (1-based, with -S)

PLAYBACK PICKS (this run only — config.json untouched)
  -e, --episode <n>        Start at episode n (anime: absolute; series: S1)
      --season <n>         Season for --episode (series only)
      --quality <q>        Stream quality: best | 2160p | 1440p | 1080p | 720p | 480p
      --audio <lang>       Audio track: original | en | ja | hi | pt | es | fr | de | dub
      --sub <lang>         Subtitles: en | interactive | none | hi | pt | ar | de | es | fr | ja
      --dub                Shortcut for --audio dub
      --hdr <mode>         HDR mode: auto | passthrough | tone-map | sdr-only
      --mpv-hwdec <mode>   Hardware decode: auto | auto-safe | auto-copy | off | backend
      --mpv-avsync-recovery <on|off>
                           Correct sustained mpv audio/video drift

PLAYER
      --player <mode>        Player backend: desktop <auto|mpv|vlc>; Android/Termux <auto|mpv|vlc>

mpv
      --mpv-debug            Verbose mpv logging
      --mpv-clean            Ignore your mpv config for this run
      --no-user-mpv-config   Same, explicit
      --mpv-log-file <path>  Write the mpv log to a file

PATHS & INTEGRATION
      --download-path <dir>  Override the download directory
      --open <url>           Open a trusted kunai:// share link
      --install-protocol-handler  Register the Linux-only kunai:// URL handler
      --handoff-url <url>    Internal: open a kunai:// deep link
      --dry-run              Print what would happen, change nothing

DIAGNOSTICS
      --json                 Machine-readable JSON output (with -S, doctor, capabilities)
      --debug                Verbose redacted logging to ./logs.txt
      --debug-json           Debug + JSON event stream
      --debug-session        Debug + full session trace
      --support-bundle       Write a redacted local support bundle and exit
  -h, --help                 Show this help
  -v, --version              Print the version

MAINTENANCE
  kunai install                Install or reinstall Kunai (binary default)
  kunai upgrade                Update to the latest release (channel-aware)
  kunai upgrade --check        Report whether an update is available
  kunai rollback               Roll back to the previous verified local version
  kunai rollback --list        List local verified rollback candidates
  kunai rollback --to <ver>    Roll back to an explicit local verified version
  kunai rollback --dry-run     Show the planned rollback without changing state
  kunai doctor                 Read-only install health report (PATH, ownership)
  kunai doctor --json          Print the same report as JSON (add --strict to fail on warnings)
  kunai capabilities --json    Machine-readable CLI/provider contract for agents & scripts
  kunai providers status       Inspect production providers and signed hotfix manifest state
  kunai providers update       Fetch & verify an Ed25519-signed manifest (--url, --dry-run, --force)
  kunai providers verify       Check the cached manifest and AllManga crypto freshness (--json)
  kunai providers rollback     Restore the previous verified hotfix manifest backup
  kunai providers reset        Remove cached hotfix manifest and return to bundled defaults
  kunai addons list            List the Stremio addons you added (--json)
  kunai addons enable          Turn the experimental addon feature on
                               (--accept-risk acknowledges the warning non-interactively)
  kunai addons disable         Turn it off; installed addons stay listed
  kunai addons add <url>       Add a Stremio addon by its https manifest.json URL
                               (--stdin reads the URL from stdin, keeping it out of argv)
  kunai addons remove <n>      Remove an addon by its number in the list
  kunai addons check [n]       Ask each addon for its manifest and report problems (--json)
  kunai uninstall              Remove kunai (add --purge to also delete user data)
  kunai diagnostics recent     Print recent redacted diagnostics from the local cache DB
                               (--format pretty|jsonl|markdown, --limit N, --no-color)
  kunai analytics log          The last 50 usage pings, exactly as sent (--json)
  kunai analytics preview      The payload the next ping would send; sends nothing (--json)
  kunai completion <shell>     Print a shell completion script (bash|zsh|fish|powershell)

Inside the app, press / for the command palette and ? for keyboard help.
`;
}

/**
 * Every `kunai <word>` maintenance subcommand dispatched in `runCli` before the
 * shell boots. Shell completions are generated from this list, so a new
 * subcommand becomes completable by being added here rather than by editing
 * four shell scripts by hand.
 */
export const CLI_SUBCOMMANDS: readonly string[] = [
  "install",
  "upgrade",
  "rollback",
  "doctor",
  "capabilities",
  "providers",
  "addons",
  "uninstall",
  "diagnostics",
  "analytics",
  "completion",
];

/** `kunai addons <action>`. The command and the shell completions share this list. */
export const ADDONS_SUBCOMMANDS = ["list", "add", "remove", "check", "enable", "disable"] as const;

// Every recognized flag token. Used so a value-consuming flag (e.g. `-S`) never
// swallows a following *flag* as its value, and so unknown options are rejected
// instead of being silently dropped. Includes `--check`/`--purge`/`--json`/
// `--list`/`--to` (read by runCli, not here) to avoid false "unknown option" errors.
export const KNOWN_FLAGS: ReadonlySet<string> = new Set([
  "-S",
  "--search",
  "-i",
  "--id",
  "-t",
  "--type",
  "-a",
  "--anime",
  "-y",
  "--youtube",
  "-m",
  "--minimal",
  "-z",
  "--zen",
  "--plain",
  "-q",
  "--quick",
  "--jump",
  "-e",
  "--episode",
  "--season",
  "--quality",
  "--audio",
  "--sub",
  "--dub",
  "--debug",
  "--debug-json",
  "--debug-session",
  "--support-bundle",
  "--onboarding",
  "--setup",
  "--offline",
  "--discover",
  "--calendar",
  "--random",
  "--history",
  "--continue",
  "--resume",
  "--download",
  "--download-path",
  "--open",
  "--handoff-url",
  "--install-protocol-handler",
  "--dry-run",
  "--mpv-debug",
  "--mpv-clean",
  "--no-user-mpv-config",
  "--mpv-log-file",
  "--player",
  "--hdr",
  "--mpv-hwdec",
  "--mpv-avsync-recovery",
  "-h",
  "--help",
  "-v",
  "--version",
  "--purge",
  "--check",
  "--json",
  "--strict",
  "--format",
  "--limit",
  "--no-color",
  "--url",
  "--force",
  "--list",
  "--to",
  "--stdin",
]);

export const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-S",
  "--search",
  "-i",
  "--id",
  "-t",
  "--type",
  "--jump",
  "-e",
  "--episode",
  "--season",
  "--quality",
  "--audio",
  "--sub",
  "--download-path",
  "--open",
  "--handoff-url",
  "--mpv-log-file",
  "--player",
  "--hdr",
  "--mpv-hwdec",
  "--mpv-avsync-recovery",
  "--format",
  "--limit",
  "--url",
  "--to",
]);

type CliFlagOptions = {
  readonly search?: string;
  readonly id?: string;
  readonly type?: string;
  readonly anime?: boolean;
  readonly youtube?: boolean;
  readonly minimal?: boolean;
  readonly zen?: boolean;
  readonly plain?: boolean;
  readonly quick?: boolean;
  readonly jump?: string;
  readonly episode?: string;
  readonly season?: string;
  readonly quality?: string;
  readonly audio?: string;
  readonly sub?: string;
  readonly dub?: boolean;
  readonly hdr?: string;
  readonly mpvHwdec?: string;
  readonly mpvAvsyncRecovery?: string;
  readonly debug?: boolean;
  readonly debugJson?: boolean;
  readonly debugSession?: boolean;
  readonly supportBundle?: boolean;
  readonly onboarding?: boolean;
  readonly setup?: boolean;
  readonly offline?: boolean;
  readonly discover?: boolean;
  readonly calendar?: boolean;
  readonly random?: boolean;
  readonly history?: boolean;
  readonly continue?: boolean;
  readonly resume?: boolean;
  readonly download?: boolean;
  readonly downloadPath?: string;
  readonly handoffUrl?: string;
  readonly open?: string;
  readonly installProtocolHandler?: boolean;
  readonly dryRun?: boolean;
  readonly json?: boolean;
  readonly mpvDebug?: boolean;
  readonly mpvClean?: boolean;
  /**
   * From `--no-user-mpv-config`: `readFlagTokens` stores it under the positive
   * key as `false`, never as `noUserMpvConfig`. Reading the negative name is
   * what once let the flag silently no-op.
   */
  readonly userMpvConfig?: boolean;
  readonly mpvLogFile?: string;
  readonly player?: string;
  readonly help?: boolean;
  readonly version?: boolean;
};

type FlagTokenRead = {
  readonly options: CliFlagOptions;
  readonly positionals: readonly string[];
};

/** Short flags, as their long form. */
const SHORT_FLAG_ALIASES: ReadonlyMap<string, string> = new Map([
  ["-S", "--search"],
  ["-i", "--id"],
  ["-t", "--type"],
  ["-a", "--anime"],
  ["-y", "--youtube"],
  ["-m", "--minimal"],
  ["-z", "--zen"],
  ["-q", "--quick"],
  ["-e", "--episode"],
  ["-h", "--help"],
  ["-v", "--version"],
]);

/** The launch flags this parser reads into `CliFlagOptions`; the rest belong to subcommands. */
const LAUNCH_FLAGS: ReadonlySet<string> = new Set([
  "--search",
  "--id",
  "--type",
  "--anime",
  "--youtube",
  "--minimal",
  "--zen",
  "--plain",
  "--quick",
  "--jump",
  "--episode",
  "--season",
  "--quality",
  "--audio",
  "--sub",
  "--dub",
  "--debug",
  "--debug-json",
  "--debug-session",
  "--support-bundle",
  "--onboarding",
  "--setup",
  "--offline",
  "--discover",
  "--calendar",
  "--random",
  "--history",
  "--continue",
  "--resume",
  "--download",
  "--download-path",
  "--open",
  "--handoff-url",
  "--install-protocol-handler",
  "--dry-run",
  "--json",
  "--mpv-debug",
  "--mpv-clean",
  "--no-user-mpv-config",
  "--mpv-log-file",
  "--player",
  "--hdr",
  "--mpv-hwdec",
  "--mpv-avsync-recovery",
  "--help",
  "--version",
]);

/**
 * Read normalized argv into options and positionals. `normalizeCliArgv` has
 * already rejected unknown flags and paired every value flag with exactly one
 * value, so this only maps names: `--debug-json` → `debugJson`, a short flag to
 * its long form, `--no-user-mpv-config` → `userMpvConfig: false`. Subcommand
 * flags (`--check`, `--to`, …) are skipped with their value, never read as a
 * search word.
 */
function readFlagTokens(argv: readonly string[]): FlagTokenRead {
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    const takesValue = VALUE_FLAGS.has(token);
    const value = takesValue ? argv[(index += 1)] : undefined;
    const flag = SHORT_FLAG_ALIASES.get(token) ?? token;
    if (!LAUNCH_FLAGS.has(flag)) continue;
    if (flag === "--no-user-mpv-config") {
      options.userMpvConfig = false;
      continue;
    }
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    options[key] = takesValue ? (value ?? "") : true;
  }
  // SAFETY: keys are camelCased LAUNCH_FLAGS, exactly CliFlagOptions' fields.
  return { options: options as CliFlagOptions, positionals };
}

const SUBCOMMAND_ONLY_FLAGS: ReadonlySet<string> = new Set([
  "--strict",
  "--format",
  "--limit",
  "--no-color",
  "--url",
  "--force",
]);

function normalizeCliArgv(argv: readonly string[]): {
  readonly argv: readonly string[];
  readonly errors: readonly string[];
} {
  const normalized: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (SUBCOMMAND_ONLY_FLAGS.has(arg)) {
      errors.push(`${arg} is only valid with its maintenance subcommand`);
      const next = argv[i + 1];
      if (VALUE_FLAGS.has(arg) && next !== undefined && !KNOWN_FLAGS.has(next)) {
        i += 1;
      }
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      const next = argv[i + 1];
      // A flag token must never become another flag's value — `-S --anime` is
      // a missing value, not the query "--anime". And a value-taking flag that
      // cannot consume exactly one token is a usage error, not a soft drop:
      // the previous warn-and-drop path let `--config /path` turn the path
      // into the search query.
      if (next === undefined || KNOWN_FLAGS.has(next)) {
        errors.push(`${arg} expected a value`);
      } else {
        normalized.push(arg, next);
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("-") && arg !== "-" && !KNOWN_FLAGS.has(arg)) {
      errors.push(`unknown option ${arg}`);
      continue;
    }
    normalized.push(arg);
  }
  return { argv: normalized, errors };
}

/**
 * Levenshtein distance — the typo gate for subcommand near-misses. Seven words
 * of dictionary need no library.
 */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      // Indices are bounded by the loop — the `?? 0`s satisfy
      // noUncheckedIndexedAccess without non-null assertions.
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? a.length;
}

/**
 * A first positional is a query only if it does not look like a mistyped
 * maintenance command. Distance ≤ 2 catches the real typos (`kunai doctro`,
 * `kunai upgarde`); words under 4 chars are exempt so `kunai tv` stays a
 * search. Escaped either way by `-S <query>`.
 */
function nearestSubcommand(word: string): string | undefined {
  if (word.length < 4) return undefined;
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const command of CLI_SUBCOMMANDS) {
    const distance = editDistance(word, command);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = command;
    }
  }
  return bestDistance <= 2 ? best : undefined;
}

// The flag tables above are the parser: `normalizeCliArgv` validates and pairs
// tokens, `readFlagTokens` names them. (Commander used to do the naming; it was
// ~39 KiB of bundle for a job the tables already did.)
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const normalized = normalizeCliArgv(argv);
  if (normalized.errors.length > 0) {
    throw new CliUsageError(normalized.errors.join("; "));
  }
  const { options, positionals } = readFlagTokens(normalized.argv);
  const warnings: string[] = [];

  const args: Omit<CliArgs, "shellChrome"> = {
    anime: false,
    youtube: false,
    debug: false,
    debugJson: false,
    debugSession: false,
    supportBundle: false,
    zen: false,
    mpv: {},
    player: "auto",
    minimal: false,
    plain: false,
    quick: false,
    setup: false,
    offline: false,
    history: false,
    continuePlayback: false,
    download: false,
    installProtocolHandler: false,
    dryRun: false,
    json: false,
    help: false,
    version: false,
  };

  args.search = options.search;
  args.id = options.id;
  if (args.id !== undefined) {
    // Reject only what no downstream grammar can read: a non-numeric bare id
    // or a *known* namespace carrying a non-numeric id (`anilist:abc`). Unknown
    // namespaces pass through — `resolveDirectTitle` reports them as
    // `id-unknown-namespace` rather than a usage error, and `youtube:` ids are
    // opaque (video or `PL…` playlist), not numeric. The namespace set mirrors
    // `DIRECT_ID_NAMESPACES` in app/bootstrap/bootstrap-intent.ts.
    const id = args.id.trim();
    const nsMatch = /^([a-z]+):(.+)$/i.exec(id);
    if (nsMatch?.[1] && nsMatch[2] !== undefined) {
      const ns = nsMatch[1].toLowerCase();
      const nsId = nsMatch[2].trim();
      if ((ns === "tmdb" || ns === "anilist" || ns === "mal") && !/^[1-9]\d*$/.test(nsId)) {
        throw new CliUsageError(`invalid -i/--id "${args.id}" — ${ns}: ids are positive integers`);
      }
    } else if (!/^[1-9]\d*$/.test(id)) {
      throw new CliUsageError(
        `invalid -i/--id "${args.id}" — accepted forms: <tmdb-id>, tmdb:<id>, anilist:<id>, mal:<id>, youtube:<id>`,
      );
    }
    args.id = id;
  }
  if (options.type !== undefined) args.type = options.type === "tv" ? "series" : options.type;
  args.anime = Boolean(options.anime);
  args.youtube = Boolean(options.youtube);
  if (args.youtube && args.anime) {
    warnings.push("--youtube overrides --anime for startup mode");
    args.anime = false;
  }
  args.minimal = Boolean(options.minimal);
  args.zen = Boolean(options.zen);
  args.plain = Boolean(options.plain);
  args.quick = Boolean(options.quick);
  if (args.zen) {
    // Zen is a *layout*: bare chrome, ani-cli-style. It used to also set
    // `quick`, which is not a layout flag at all — `bootstrap-intent` reads it
    // as "auto-pick result #1", so `-S "Dune" --zen` skipped the result list
    // and started playing the top hit. `cli-reference.mdx` even enumerates the
    // flags that auto-play and does not list `--zen`. Compose them explicitly
    // (`--zen --quick`) to get both.
    args.minimal = true;
  }

  const parsedJump = options.jump ? Number.parseInt(options.jump, 10) : Number.NaN;
  if (Number.isFinite(parsedJump) && parsedJump >= 1) {
    args.jump = parsedJump;
  } else if (options.jump !== undefined) {
    warnings.push("--jump expects a positive result index; ignoring");
  }

  if (options.episode !== undefined) {
    if (!/^[1-9]\d*$/.test(options.episode)) {
      throw new CliUsageError(
        `invalid -e/--episode "${options.episode}" — expected a positive episode number`,
      );
    }
    args.episode = Number.parseInt(options.episode, 10);
  }
  if (options.season !== undefined) {
    if (!/^[1-9]\d*$/.test(options.season)) {
      throw new CliUsageError(
        `invalid --season "${options.season}" — expected a positive season number`,
      );
    }
    if (args.episode === undefined) {
      // `--season 2` alone is ambiguous (S2E1? "browse season 2"?) and silently
      // guessing is the house failure mode — make the user say which episode.
      throw new CliUsageError("--season requires --episode");
    }
    args.season = Number.parseInt(options.season, 10);
  }

  if (options.quality !== undefined) {
    // Forgiving about the "p" — `--quality 1080` and `--quality 1080p` mean the
    // same thing — but an unknown value shapes which stream plays, so it is a
    // usage error, not a warn-and-ignore.
    const quality = /^\d+$/.test(options.quality)
      ? `${options.quality}p`
      : options.quality.toLowerCase();
    if (!PROVIDER_QUALITY_PREFERENCE_OPTIONS.some((o) => o.value === quality)) {
      throw new CliUsageError(
        `invalid --quality "${options.quality}" — one of: ${PROVIDER_QUALITY_PREFERENCE_OPTIONS.map((o) => o.value).join(", ")}`,
      );
    }
    args.quality = quality;
  }
  if (options.dub) {
    if (options.audio !== undefined) {
      throw new CliUsageError("--dub and --audio are mutually exclusive");
    }
    args.audio = "dub";
  }
  if (options.audio !== undefined) {
    const audio = options.audio.toLowerCase();
    if (!AUDIO_PREFERENCE_OPTIONS.some((o) => o.value === audio)) {
      throw new CliUsageError(
        `invalid --audio "${options.audio}" — one of: ${AUDIO_PREFERENCE_OPTIONS.map((o) => o.value).join(", ")}`,
      );
    }
    args.audio = audio;
  }
  if (options.sub !== undefined) {
    const subtitle = options.sub.toLowerCase();
    if (!SUBTITLE_PREFERENCE_OPTIONS.some((o) => o.value === subtitle)) {
      throw new CliUsageError(
        `invalid --sub "${options.sub}" — one of: ${SUBTITLE_PREFERENCE_OPTIONS.map((o) => o.value).join(", ")}`,
      );
    }
    args.subtitle = subtitle;
  }
  if (options.hdr !== undefined) {
    const hdr = options.hdr.toLowerCase();
    if (!isHdrMode(hdr)) {
      throw new CliUsageError(`invalid --hdr "${options.hdr}" — one of: ${HDR_MODES.join(", ")}`);
    }
    args.hdr = hdr;
  }

  if (options.mpvHwdec !== undefined) {
    const mode = options.mpvHwdec.toLowerCase();
    if (!isMpvHwdecMode(mode)) {
      throw new CliUsageError(
        `invalid --mpv-hwdec "${options.mpvHwdec}" — one of: ${MPV_HWDEC_MODES.join(", ")}`,
      );
    }
    args.mpvHwdec = mode;
  }
  if (options.mpvAvsyncRecovery !== undefined) {
    const value = options.mpvAvsyncRecovery.toLowerCase();
    if (value !== "on" && value !== "off") {
      throw new CliUsageError(
        `invalid --mpv-avsync-recovery "${options.mpvAvsyncRecovery}" — one of: on, off`,
      );
    }
    args.mpvAvsyncRecovery = value === "on";
  }

  args.debug = Boolean(options.debug || options.debugJson || options.debugSession);
  args.debugJson = Boolean(options.debugJson || options.debugSession);
  args.debugSession = Boolean(options.debugSession);
  args.supportBundle = Boolean(options.supportBundle);
  args.setup = Boolean(options.setup || options.onboarding);
  args.offline = Boolean(options.offline);
  if (options.discover) args.initialRoute = "recommendation";
  if (options.calendar) args.initialRoute = "calendar";
  if (options.random) args.initialRoute = "random";
  args.history = Boolean(options.history);
  args.continuePlayback = Boolean(options.continue || options.resume);
  args.download = Boolean(options.download);
  args.downloadPath = options.downloadPath;
  args.openUrl = options.open;
  args.handoffUrl = options.handoffUrl;
  if (args.openUrl && args.handoffUrl) {
    // `--open` is the trusted local channel and `--handoff-url` the untrusted
    // desktop-handler one; accepting both would silently upgrade whichever a
    // tokenizing launcher smuggled into argv.
    throw new CliUsageError("--open and --handoff-url are mutually exclusive");
  }
  if (args.handoffUrl && /\s/.test(args.handoffUrl)) {
    // A kunai:// URL never contains whitespace; finding any means something
    // tokenized extra argv into the value — refuse rather than risk a
    // smuggled flag.
    throw new CliUsageError("invalid kunai:// handoff URL");
  }
  args.installProtocolHandler = Boolean(options.installProtocolHandler);
  args.dryRun = Boolean(options.dryRun);
  args.json = Boolean(options.json);
  args.mpv = {
    ...(options.mpvDebug ? { debug: true } : {}),
    ...(options.mpvClean ? { clean: true } : {}),
    // `--no-user-mpv-config` arrives as `userMpvConfig: false` — there is never
    // a `noUserMpvConfig` key to read. Only an explicit `false` counts; unset
    // must stay unset.
    ...(options.userMpvConfig === false ? { noUserConfig: true } : {}),
    ...(options.mpvLogFile ? { logFile: options.mpvLogFile } : {}),
  };
  // Unset unless given, so a saved Settings choice can apply (`effectivePlayerChoice`).
  args.player = options.player === undefined ? undefined : parsePlayerChoice(options.player);
  args.help = Boolean(options.help);
  args.version = Boolean(options.version);

  if (args.search === undefined && args.id === undefined && positionals.length > 0) {
    // A lone positional that is a subcommand — or reads like a typo of one —
    // must not silently become a search. `runCli` only dispatches a
    // subcommand in argv[0], so `kunai --debug doctor` and `kunai doctro`
    // both landed here as queries before.
    const suggestion =
      positionals.length === 1 && positionals[0] !== undefined
        ? nearestSubcommand(positionals[0])
        : undefined;
    if (suggestion !== undefined) {
      throw new CliUsageError(
        suggestion === positionals[0]
          ? `"${suggestion}" is a maintenance command — run "kunai ${suggestion}" directly`
          : `unknown command "${positionals[0]}" — did you mean "kunai ${suggestion}"?`,
      );
    }
    args.search = positionals.join(" ");
  } else {
    for (const positional of positionals) warnings.push(`ignored argument ${positional}`);
  }
  if (warnings.length > 0) {
    console.warn(`kunai: ${warnings.join("; ")}`);
  }
  const shellChrome: ShellChrome =
    args.minimal || args.zen ? "minimal" : args.quick ? "quick" : "default";
  return { ...args, shellChrome };
}
