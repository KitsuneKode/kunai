/**
 * True only for a bare `kunai --version` / `kunai -v`. install.ps1 smoke-runs a
 * fresh versioned payload exactly that way before install.json exists, and
 * version output never writes storage, so it must not demand profile or
 * install evidence. Any other argument keeps inference: in `kunai -S -v` the
 * `-v` is search text and the shell opens, so skipping would run a profile
 * payload against the default profile.
 */
export function versionRequestSkipsWindowsProfileInference(
  argv: readonly string[],
  maintenanceCommands: ReadonlySet<string>,
): boolean {
  const only = argv.length === 1 ? argv[0] : undefined;
  if (only === undefined || maintenanceCommands.has(only)) return false;
  return only === "--version" || only === "-v";
}

type StorageModule = typeof import("@kunai/storage");

export type PrepareCliProfileDeps = {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly storage?: Pick<
    StorageModule,
    | "checkDesktopProfile"
    | "DesktopProfileError"
    | "getKunaiPaths"
    | "inferWindowsProfileFromExecutable"
  >;
};

/**
 * Startup validation for a dedicated desktop profile (`KUNAI_CONFIG_DIR`).
 *
 * Runs before every other `startCli` branch so a malformed or unowned profile
 * root exits 2 with the typed error instead of letting a later code path
 * create or trust files under it.
 *
 * Uninstall and protocol-handler registration run their own ownership or
 * policy check; here only the lexical resolution has to succeed. Flag
 * sniffing only applies to real subcommands — a bare `--dry-run` or
 * `--install-protocol-handler` with no command stays the fast path.
 *
 * Returns false when the caller must return early (exit code already set).
 */
export async function prepareCliProfile(
  argv: readonly string[],
  maintenanceCommands: ReadonlySet<string>,
  fastPath: boolean,
  deps: PrepareCliProfileDeps = {},
): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  if (env.KUNAI_CONFIG_DIR === undefined && platform !== "win32") return true;
  const storage = deps.storage ?? (await import("@kunai/storage"));
  const {
    checkDesktopProfile,
    DesktopProfileError,
    getKunaiPaths,
    inferWindowsProfileFromExecutable,
  } = storage;
  try {
    // A payload running from an owned profile's version store inherits that
    // profile even when the invoking shell carried no override. Anything the
    // shell did set — including an empty value — keeps its existing meaning.
    const inferredRoot = versionRequestSkipsWindowsProfileInference(argv, maintenanceCommands)
      ? undefined
      : inferWindowsProfileFromExecutable(undefined, env);
    if (inferredRoot !== undefined) env.KUNAI_CONFIG_DIR = inferredRoot;
    if (env.KUNAI_CONFIG_DIR === undefined) return true;
    const command = argv[0] ?? "";
    const maintenance = maintenanceCommands.has(command);
    if (command === "uninstall" || (!maintenance && argv.includes("--install-protocol-handler"))) {
      getKunaiPaths();
    } else {
      // `diagnostics recent` migrates and writes its cache, so it is not one
      // of the read-only commands that may only inspect a profile.
      const writesDiagnostics = command === "diagnostics" && argv[1] === "recent";
      const readOnly =
        !writesDiagnostics &&
        (["doctor", "capabilities", "completion", "diagnostics"].includes(command) ||
          (command === "rollback" && (argv.includes("--list") || argv.includes("--dry-run"))) ||
          (command === "upgrade" && argv.includes("--check")) ||
          (!maintenance && (fastPath || argv.includes("--dry-run"))));
      checkDesktopProfile(readOnly ? "inspect" : "prepare");
    }
    return true;
  } catch (error) {
    if (!(error instanceof DesktopProfileError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return false;
  }
}
