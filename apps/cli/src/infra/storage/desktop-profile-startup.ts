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
): Promise<boolean> {
  if (process.env.KUNAI_CONFIG_DIR === undefined) return true;
  const { checkDesktopProfile, DesktopProfileError, getKunaiPaths } =
    await import("@kunai/storage");
  try {
    const command = argv[0] ?? "";
    const maintenance = maintenanceCommands.has(command);
    if (command === "uninstall" || (!maintenance && argv.includes("--install-protocol-handler"))) {
      getKunaiPaths();
    } else {
      const readOnly =
        ["doctor", "capabilities", "completion", "diagnostics"].includes(command) ||
        (command === "rollback" && (argv.includes("--list") || argv.includes("--dry-run"))) ||
        (command === "upgrade" && argv.includes("--check")) ||
        (!maintenance && (fastPath || argv.includes("--dry-run")));
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
