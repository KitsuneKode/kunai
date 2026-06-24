import type { ShellChrome } from "@/container";
import type { MpvRuntimeOptions } from "@/infra/player/mpv-runtime-options";
import { Command } from "commander";

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
  kunai install                Install or reinstall Kunai (binary default)
  kunai diagnostics recent     Print recent redacted diagnostics from the local cache DB
  kunai upgrade              Update to the latest release (channel-aware)
  kunai upgrade --check      Report whether an update is available
  kunai uninstall            Remove kunai (add --purge to also delete user data)

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
  "--purge",
  "--check",
]);

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-S",
  "--search",
  "-i",
  "--id",
  "-t",
  "--type",
  "--jump",
  "--download-path",
  "--handoff-url",
  "--mpv-log-file",
]);

type CommanderCliOptions = {
  readonly search?: string;
  readonly id?: string;
  readonly type?: string;
  readonly anime?: boolean;
  readonly minimal?: boolean;
  readonly zen?: boolean;
  readonly quick?: boolean;
  readonly jump?: string;
  readonly debug?: boolean;
  readonly debugJson?: boolean;
  readonly debugSession?: boolean;
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
  readonly installProtocolHandler?: boolean;
  readonly dryRun?: boolean;
  readonly mpvDebug?: boolean;
  readonly mpvClean?: boolean;
  readonly noUserMpvConfig?: boolean;
  readonly mpvLogFile?: string;
  readonly help?: boolean;
  readonly version?: boolean;
};

function createCliCommand(): Command {
  return new Command()
    .name("kunai")
    .exitOverride()
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .option("-S, --search <query>")
    .option("-i, --id <id>")
    .option("-t, --type <type>")
    .option("-a, --anime")
    .option("-m, --minimal")
    .option("-z, --zen")
    .option("-q, --quick")
    .option("--jump <n>")
    .option("--debug")
    .option("--debug-json")
    .option("--debug-session")
    .option("--setup")
    .option("--offline")
    .option("--discover")
    .option("--calendar")
    .option("--random")
    .option("--history")
    .option("--continue")
    .option("--resume")
    .option("--download")
    .option("--download-path <dir>")
    .option("--handoff-url <url>")
    .option("--install-protocol-handler")
    .option("--dry-run")
    .option("--mpv-debug")
    .option("--mpv-clean")
    .option("--no-user-mpv-config")
    .option("--mpv-log-file <path>")
    .option("-h, --help")
    .option("-v, --version")
    .argument("[query...]");
}

function normalizeCliArgv(argv: readonly string[]): {
  readonly argv: readonly string[];
  readonly warnings: readonly string[];
} {
  const normalized: string[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (VALUE_FLAGS.has(arg)) {
      const next = argv[i + 1];
      if (next === undefined || KNOWN_FLAGS.has(next)) {
        warnings.push(`${arg} expected a value`);
      } else {
        normalized.push(arg, next);
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("-") && arg !== "-" && !KNOWN_FLAGS.has(arg)) {
      warnings.push(`unknown option ${arg}`);
      continue;
    }
    normalized.push(arg);
  }
  return { argv: normalized, warnings };
}

// Process argv parsing is intentionally delegated to Commander so Kunai does
// not grow a bespoke CLI parser as subcommands and flags mature.
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const normalized = normalizeCliArgv(argv);
  const command = createCliCommand();
  command.configureOutput({
    writeErr: () => {},
    writeOut: () => {},
  });
  command.parse([...normalized.argv], { from: "user" });
  const options = command.opts<CommanderCliOptions>();
  const warnings = [...normalized.warnings];
  const positionals = command.args.filter((arg) => arg !== undefined && !arg.startsWith("-"));

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
  };

  args.search = options.search;
  args.id = options.id;
  if (options.type !== undefined) args.type = options.type === "tv" ? "series" : options.type;
  args.anime = Boolean(options.anime);
  args.minimal = Boolean(options.minimal);
  args.zen = Boolean(options.zen);
  args.quick = Boolean(options.quick);
  if (args.zen) {
    args.minimal = true;
    args.quick = true;
  }

  const parsedJump = options.jump ? Number.parseInt(options.jump, 10) : Number.NaN;
  if (Number.isFinite(parsedJump) && parsedJump >= 1) {
    args.jump = parsedJump;
  }

  args.debug = Boolean(options.debug || options.debugJson || options.debugSession);
  args.debugJson = Boolean(options.debugJson || options.debugSession);
  args.debugSession = Boolean(options.debugSession);
  args.setup = Boolean(options.setup);
  args.offline = Boolean(options.offline);
  if (options.discover) args.initialRoute = "recommendation";
  if (options.calendar) args.initialRoute = "calendar";
  if (options.random) args.initialRoute = "random";
  args.history = Boolean(options.history);
  args.continuePlayback = Boolean(options.continue || options.resume);
  args.download = Boolean(options.download);
  args.downloadPath = options.downloadPath;
  args.handoffUrl = options.handoffUrl;
  args.installProtocolHandler = Boolean(options.installProtocolHandler);
  args.dryRun = Boolean(options.dryRun);
  args.mpv = {
    ...(options.mpvDebug ? { debug: true } : {}),
    ...(options.mpvClean ? { clean: true } : {}),
    ...(options.noUserMpvConfig ? { noUserConfig: true } : {}),
    ...(options.mpvLogFile ? { logFile: options.mpvLogFile } : {}),
  };
  args.help = Boolean(options.help);
  args.version = Boolean(options.version);

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
