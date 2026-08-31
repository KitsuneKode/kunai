import { expect, test } from "bun:test";

import { buildCliHelpText, parseCliArgs as parseArgs } from "@/cli-args";

test("buildCliHelpText describes canonical launch flags", () => {
  const help = buildCliHelpText("0.0.0-test");

  expect(help).toContain("Kunai 0.0.0-test");
  expect(help).toContain("-S, --search <query>");
  expect(help).toContain("--continue, --resume");
  expect(help).toContain("--install-protocol-handler");
  expect(help).toContain("--player <auto|mpv|vlc>");
  expect(help).toContain("Register the Linux-only kunai:// URL handler");
  expect(help).toContain("-y, --youtube");
  expect(help).toContain("--debug                Verbose redacted logging to ./logs.txt");
  expect(help).toContain(
    "--jump <n>             Auto-pick the n-th search result (1-based, with -S)",
  );
  expect(help).toContain("kunai doctor");
  expect(help).toContain("kunai doctor --json");
  expect(help).toContain("kunai rollback");
  expect(help).toContain("kunai rollback --list");
  expect(help).toContain("kunai rollback --to <ver>");
  expect(help).toContain("kunai rollback --dry-run");
  expect(help).toContain("kunai install");
  expect(help).toContain("kunai upgrade");
  expect(help).toContain("kunai upgrade --check");
  expect(help).toContain("kunai uninstall");
});

test("parseArgs exposes an explicit player choice with an auto default", () => {
  expect(parseArgs([]).player).toBe("auto");
  expect(parseArgs(["--player", "auto"]).player).toBe("auto");
  expect(parseArgs(["--player", "mpv"]).player).toBe("mpv");
  expect(parseArgs(["--player", "vlc"]).player).toBe("vlc");
});

test("parseArgs rejects unknown player choices", () => {
  expect(() => parseArgs(["--player", "potato"])).toThrow(/--player.*auto.*mpv.*vlc/i);
});

test("parseArgs treats --json as a known maintenance flag", () => {
  const args = parseArgs(["--json"]);
  // Doctor is routed in runCli before parseArgs; --json must not warn as unknown.
  expect(args).toBeDefined();
});

test("parseArgs treats rollback maintenance flags as known", () => {
  const listed = parseArgs(["--list"]);
  const toVersion = parseArgs(["--to", "1.2.3"]);
  // Rollback is routed in runCli before parseArgs; flags must not warn as unknown.
  expect(listed).toBeDefined();
  expect(toVersion).toBeDefined();
});

test("parseArgs supports --youtube launch mode", () => {
  const args = parseArgs(["--youtube", "-S", "lofi"]);

  expect(args.youtube).toBe(true);
  expect(args.anime).toBe(false);
  expect(args.search).toBe("lofi");
});

test("parseArgs prefers --youtube over --anime when both are set", () => {
  const args = parseArgs(["--youtube", "--anime"]);

  expect(args.youtube).toBe(true);
  expect(args.anime).toBe(false);
});

test("parseArgs supports download-only mode", () => {
  const args = parseArgs(["--download", "-S", "Dune", "--download-path", "/tmp/kunai"]);

  expect(args.download).toBe(true);
  expect(args.downloadPath).toBe("/tmp/kunai");
  expect(args.search).toBe("Dune");
});

test("parseArgs accepts tv as the TMDB series type alias", () => {
  const args = parseArgs(["-i", "76479", "-t", "tv"]);

  expect(args.id).toBe("76479");
  expect(args.type).toBe("series");
});

test("parseArgs supports startup entry routes", () => {
  const resume = parseArgs(["--resume"]);
  const continuePlayback = parseArgs(["--continue"]);
  const history = parseArgs(["--history"]);
  const offline = parseArgs(["--offline"]);
  const calendar = parseArgs(["--calendar"]);
  const random = parseArgs(["--random"]);
  const discover = parseArgs(["--discover"]);

  expect(resume.continuePlayback).toBe(true);
  expect(continuePlayback.continuePlayback).toBe(true);
  expect(history.history).toBe(true);
  expect(offline.offline).toBe(true);
  expect(calendar.initialRoute).toBe("calendar");
  expect(random.initialRoute).toBe("random");
  expect(discover.initialRoute).toBe("recommendation");
});

test("parseArgs supports structured debug traces", () => {
  const args = parseArgs(["--debug-json"]);

  expect(args.debug).toBe(true);
  expect(args.debugJson).toBe(true);
  expect(args.debugSession).toBe(false);
});

test("parseArgs supports developer debug session mode", () => {
  const args = parseArgs(["--debug-session", "-S", "Dune"]);

  expect(args.debug).toBe(true);
  expect(args.debugJson).toBe(true);
  expect(args.debugSession).toBe(true);
  expect(args.search).toBe("Dune");
});

/**
 * Deliberate behaviour change: `--zen` no longer implies `--quick`.
 *
 * This test previously asserted `args.quick === true`. `--quick` is not a
 * layout flag — `bootstrap-intent` reads it as "auto-pick result #1" — so zen
 * silently skipped the result list and played the top hit, while both `--help`
 * ("Zen mode (bare, ani-cli-style)") and `docs/users/cli-reference.mdx`
 * describe zen as layout and list only `--jump`/`--quick` as auto-playing.
 *
 * Zen now sets chrome only. `--zen --quick` still composes for anyone who
 * wants both.
 */
test("parseArgs treats zen as layout only, not auto-selection", () => {
  const args = parseArgs(["--zen", "-S", "Dune"]);

  expect(args.zen).toBe(true);
  expect(args.minimal).toBe(true);
  expect(args.quick).toBe(false);
  expect(args.shellChrome).toBe("minimal");
});

test("parseArgs still composes zen with an explicit --quick", () => {
  const args = parseArgs(["--zen", "--quick", "-S", "Dune"]);

  expect(args.minimal).toBe(true);
  expect(args.quick).toBe(true);
  expect(args.shellChrome).toBe("minimal");
});

test("parseArgs accepts a protocol handoff URL without executing it", () => {
  const args = parseArgs(["--handoff-url", "kunai://play?cat=tmdb%3A438631&kind=movie"]);

  expect(args.handoffUrl).toBe("kunai://play?cat=tmdb%3A438631&kind=movie");
  expect(args.search).toBeUndefined();
});

test("parseArgs accepts a trusted --open share URL", () => {
  const args = parseArgs(["--open", "kunai://play?cat=tmdb%3A1399&kind=series&s=1&e=3&t=83"]);

  expect(args.openUrl).toBe("kunai://play?cat=tmdb%3A1399&kind=series&s=1&e=3&t=83");
  expect(args.handoffUrl).toBeUndefined();
});

test("parseArgs supports explicit local protocol handler installation", () => {
  const args = parseArgs(["--install-protocol-handler"]);

  expect(args.installProtocolHandler).toBe(true);
});

test("parseArgs supports dry-run protocol handler inspection", () => {
  const args = parseArgs(["--install-protocol-handler", "--dry-run"]);

  expect(args.installProtocolHandler).toBe(true);
  expect(args.dryRun).toBe(true);
});

test("parseArgs supports --jump <n> for hands-off first-result playback", () => {
  const args = parseArgs(["-S", "Dune", "--jump", "1"]);

  expect(args.search).toBe("Dune");
  expect(args.jump).toBe(1);
});

test("parseArgs parses a positive --jump index", () => {
  const args = parseArgs(["-S", "Dune", "--jump", "3"]);

  expect(args.jump).toBe(3);
});

test("parseArgs supports -q / --quick as hands-off first-result", () => {
  const quickShort = parseArgs(["-S", "Dune", "-q"]);
  const quickLong = parseArgs(["-S", "Dune", "--quick"]);

  expect(quickShort.search).toBe("Dune");
  expect(quickShort.quick).toBe(true);
  expect(quickLong.quick).toBe(true);
});

test("parseArgs ignores invalid --jump values without crashing", () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = ((message: string) => warnings.push(message)) as typeof console.warn;

  try {
    const negative = parseArgs(["-S", "Dune", "--jump", "-1"]);
    warnings.length = 0;
    const zero = parseArgs(["-S", "Dune", "--jump", "0"]);
    warnings.length = 0;
    const nonNumeric = parseArgs(["-S", "Dune", "--jump", "abc"]);
    warnings.length = 0;
    const missing = parseArgs(["-S", "Dune", "--jump"]);

    expect(negative.jump).toBeUndefined();
    expect(zero.jump).toBeUndefined();
    expect(nonNumeric.jump).toBeUndefined();
    expect(missing.jump).toBeUndefined();

    warnings.length = 0;
    parseArgs(["-S", "Dune", "--jump", "0"]);
    expect(warnings.join("; ")).toContain("--jump expects a positive result index; ignoring");

    warnings.length = 0;
    parseArgs(["-S", "Dune", "--jump", "abc"]);
    expect(warnings.join("; ")).toContain("--jump expects a positive result index; ignoring");
  } finally {
    console.warn = originalWarn;
  }
});

test("parseArgs treats a bare argument as a search query", () => {
  const single = parseArgs(["Dune"]);
  const multi = parseArgs(["Cowboy", "Bebop"]);

  expect(single.search).toBe("Dune");
  expect(multi.search).toBe("Cowboy Bebop");
});

test("parseArgs prefers an explicit -S over bare positionals", () => {
  const args = parseArgs(["-S", "Dune", "-a"]);

  expect(args.search).toBe("Dune");
  expect(args.anime).toBe(true);
});

test("parseArgs does not let a value flag swallow a following known flag", () => {
  // `-S` with no value before `--anime` must NOT capture "--anime" as the query.
  const args = parseArgs(["-S", "--anime"]);

  expect(args.search).toBeUndefined();
  expect(args.anime).toBe(true);
});

test("parseArgs still consumes negative-looking values for --jump", () => {
  // `-1` is not a known flag, so it is consumed as the (invalid) jump value.
  const args = parseArgs(["--jump", "-1", "Dune"]);

  expect(args.jump).toBeUndefined();
  expect(args.search).toBe("Dune");
});

test("parseArgs ignores unknown flags without dropping valid ones", () => {
  const args = parseArgs(["--definitely-not-a-flag", "-S", "Dune", "-a"]);

  expect(args.search).toBe("Dune");
  expect(args.anime).toBe(true);
});

test("parseArgs routes --history / --offline / --continue to their bootstrap surfaces", () => {
  const history = parseArgs(["--history"]);
  const offline = parseArgs(["--offline"]);
  const continuePlayback = parseArgs(["--continue"]);

  // The boot path is the user-facing contract documented in the smoke matrix:
  // --history opens the history picker at startup, --offline opens the
  // completed-downloads picker, --continue resumes the newest unfinished
  // history entry. Each must set exactly one boolean so the bootstrap
  // dispatch is unambiguous.
  expect(history.history).toBe(true);
  expect(history.offline).toBe(false);
  expect(history.continuePlayback).toBe(false);

  expect(offline.offline).toBe(true);
  expect(offline.history).toBe(false);
  expect(offline.continuePlayback).toBe(false);

  expect(continuePlayback.continuePlayback).toBe(true);
  expect(continuePlayback.history).toBe(false);
  expect(continuePlayback.offline).toBe(false);
});

test("--no-user-mpv-config reaches mpv as noUserConfig", () => {
  // Commander treats `--no-x` as the negation of `x`, so this option lands as
  // `userMpvConfig: false` — never `noUserMpvConfig`. Reading the wrong key made
  // the flag a permanent no-op while three docs surfaces advertised it.
  const args = parseArgs(["node", "kunai", "--no-user-mpv-config"]);
  expect(args.mpv?.noUserConfig).toBe(true);
});

test("mpv config flags are independent and default to unset", () => {
  expect(parseArgs(["node", "kunai"]).mpv?.noUserConfig).toBeUndefined();
  expect(parseArgs(["node", "kunai", "--mpv-clean"]).mpv?.clean).toBe(true);
  expect(parseArgs(["node", "kunai", "--mpv-clean"]).mpv?.noUserConfig).toBeUndefined();
});
