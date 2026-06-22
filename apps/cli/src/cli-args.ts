import type { ShellChrome } from "@/container";
import type { MpvRuntimeOptions } from "@/infra/player/mpv-runtime-options";

export type CliArgs = {
  search?: string;
  id?: string;
  type?: string;
  anime: boolean;
  debug: boolean;
  debugJson: boolean;
  debugSession: boolean;
  zen: boolean;
  mpv: MpvRuntimeOptions;
  minimal: boolean;
  quick: boolean;
  jump?: number;
  setup: boolean;
  offline: boolean;
  history: boolean;
  continuePlayback: boolean;
  download: boolean;
  downloadPath?: string;
  handoffUrl?: string;
  installProtocolHandler: boolean;
  dryRun: boolean;
  help: boolean;
  version: boolean;
  uninstall: boolean;
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
  kunai -a                   Start in anime mode

LAUNCH
  -S, --search <query>       Search for a title on launch
  -i, --id <id>              Open a specific title id
  -t, --type <movie|tv>      Content type for --id (tv = series)
  -a, --anime                Anime mode (AllAnime providers)
      --continue, --resume   Jump into Continue Watching
      --history              Open watch history
      --offline              Offline library only (no provider calls)
      --discover             Open recommendations
      --calendar             Open the release calendar
      --random               Open the random picks tray
      --download             Download a title without playback (-S or -i required)
      --setup                Run the setup wizard

DISPLAY
  -m, --minimal              Minimal chrome
  -z, --zen                  Zen mode (bare, ani-cli-style)
  -q, --quick                Quick layout
      --jump <n>             Resume/seek to episode n

mpv
      --mpv-debug            Verbose mpv logging
      --mpv-clean            Ignore your mpv config for this run
      --no-user-mpv-config   Same, explicit
      --mpv-log-file <path>  Write the mpv log to a file

PATHS & INTEGRATION
      --download-path <dir>  Override the download directory
      --install-protocol-handler  Register the kunai:// URL handler
      --handoff-url <url>    Internal: open a kunai:// deep link
      --dry-run              Print what would happen, change nothing

DIAGNOSTICS
      --debug                Verbose logging to ./logs.txt
      --debug-json           Debug + JSON event stream
      --debug-session        Debug + full session trace
  -h, --help                 Show this help
  -v, --version              Print the version

MAINTENANCE
  kunai upgrade              Update to the latest release (channel-aware)
  kunai upgrade --check      Report whether an update is available
      --uninstall            Remove kunai (add --purge to also delete user data)

Inside the app, press / for the command palette and ? for keyboard help.
`;
}

// Every recognized flag token. Used so a value-consuming flag (e.g. `-S`) never
// swallows a following *flag* as its value, and so unknown options surface a
// warning instead of being silently dropped. Includes `--check`/`--purge` (read
// by runCli, not here) to avoid false "unknown option" warnings.
const KNOWN_FLAGS: ReadonlySet<string> = new Set([
  "-S",
  "--search",
  "-i",
  "--id",
  "-t",
  "--type",
  "-a",
  "--anime",
  "-m",
  "--minimal",
  "-z",
  "--zen",
  "-q",
  "--quick",
  "--jump",
  "--debug",
  "--debug-json",
  "--debug-session",
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
  "--handoff-url",
  "--install-protocol-handler",
  "--dry-run",
  "--mpv-debug",
  "--mpv-clean",
  "--no-user-mpv-config",
  "--mpv-log-file",
  "-h",
  "--help",
  "-v",
  "--version",
  "--uninstall",
  "--purge",
  "--check",
]);

// Simple CLI arg parser. Commander remains a reasonable future parser, but this
// module keeps the current behavior isolated and tested until that migration is
// worth the extra dependency.
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: Omit<CliArgs, "shellChrome"> = {
    anime: false,
    debug: false,
    debugJson: false,
    debugSession: false,
    zen: false,
    mpv: {},
    minimal: false,
    quick: false,
    setup: false,
    offline: false,
    history: false,
    continuePlayback: false,
    download: false,
    installProtocolHandler: false,
    dryRun: false,
    help: false,
    version: false,
    uninstall: false,
  };
  const warnings: string[] = [];
  const positionals: string[] = [];
  let i = 0;
  const takeValue = (flag: string): string | undefined => {
    const next = argv[i + 1];
    if (next === undefined || KNOWN_FLAGS.has(next)) {
      warnings.push(`${flag} expected a value`);
      return undefined;
    }
    i += 1;
    return next;
  };

  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-S" || arg === "--search") {
      args.search = takeValue(arg);
    } else if (arg === "-i" || arg === "--id") {
      args.id = takeValue(arg);
    } else if (arg === "-t" || arg === "--type") {
      const rawType = takeValue(arg);
      args.type = rawType === "tv" ? "series" : rawType;
    } else if (arg === "-a" || arg === "--anime") {
      args.anime = true;
    } else if (arg === "-m" || arg === "--minimal") {
      args.minimal = true;
    } else if (arg === "-z" || arg === "--zen") {
      args.zen = true;
      args.minimal = true;
      args.quick = true;
    } else if (arg === "-q" || arg === "--quick") {
      args.quick = true;
    } else if (arg === "--jump") {
      const raw = takeValue(arg);
      const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
      if (Number.isFinite(parsed) && parsed >= 1) {
        args.jump = parsed;
      }
    } else if (arg === "--debug") {
      args.debug = true;
    } else if (arg === "--debug-json") {
      args.debug = true;
      args.debugJson = true;
    } else if (arg === "--debug-session") {
      args.debug = true;
      args.debugJson = true;
      args.debugSession = true;
    } else if (arg === "--setup") {
      args.setup = true;
    } else if (arg === "--offline") {
      args.offline = true;
    } else if (arg === "--discover") {
      args.initialRoute = "recommendation";
    } else if (arg === "--calendar") {
      args.initialRoute = "calendar";
    } else if (arg === "--random") {
      args.initialRoute = "random";
    } else if (arg === "--history") {
      args.history = true;
    } else if (arg === "--continue" || arg === "--resume") {
      args.continuePlayback = true;
    } else if (arg === "--download") {
      args.download = true;
    } else if (arg === "--download-path") {
      args.downloadPath = takeValue(arg);
    } else if (arg === "--handoff-url") {
      args.handoffUrl = takeValue(arg);
    } else if (arg === "--install-protocol-handler") {
      args.installProtocolHandler = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--mpv-debug") {
      args.mpv = { ...args.mpv, debug: true };
    } else if (arg === "--mpv-clean") {
      args.mpv = { ...args.mpv, clean: true };
    } else if (arg === "--no-user-mpv-config") {
      args.mpv = { ...args.mpv, noUserConfig: true };
    } else if (arg === "--mpv-log-file") {
      const value = takeValue(arg);
      if (value) args.mpv = { ...args.mpv, logFile: value };
    } else if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "-v" || arg === "--version") {
      args.version = true;
    } else if (arg === "--uninstall") {
      args.uninstall = true;
    } else if (arg !== undefined && arg.startsWith("-") && arg !== "-") {
      warnings.push(`unknown option ${arg}`);
    } else if (arg !== undefined) {
      positionals.push(arg);
    }
  }

  if (args.search === undefined && args.id === undefined && positionals.length > 0) {
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
