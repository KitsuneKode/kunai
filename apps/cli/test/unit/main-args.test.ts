import { expect, test } from "bun:test";

import { buildCliHelpText, CliUsageError, parseCliArgs as parseArgs } from "@/cli-args";

test("buildCliHelpText describes canonical launch flags", () => {
  const help = buildCliHelpText("0.0.0-test");

  expect(help).toContain("Kunai 0.0.0-test");
  expect(help).toContain("-S, --search <query>");
  expect(help).toContain("--continue, --resume");
  expect(help).toContain("--install-protocol-handler");
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

test("parseArgs rejects --open combined with --handoff-url", () => {
  // Accepting both would silently upgrade whichever a tokenizing launcher
  // smuggled into argv — the untrusted channel must never ride on the trusted
  // one.
  expect(() =>
    parseArgs([
      "--open",
      "kunai://play?cat=tmdb%3A1399",
      "--handoff-url",
      "kunai://play?cat=tmdb%3A438631",
    ]),
  ).toThrow(CliUsageError);
});

test("parseArgs rejects whitespace inside a handoff URL", () => {
  // Whitespace in the value means a launcher tokenized extra argv into it —
  // refuse rather than let a smuggled flag ride in on the URL.
  expect(() => parseArgs(["--handoff-url", "kunai://play?cat=tmdb%3A1 --jump 2"])).toThrow(
    CliUsageError,
  );
  expect(() => parseArgs(["--handoff-url", "kunai://play?cat=tmdb%3A1\t--debug"])).toThrow(
    CliUsageError,
  );
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

    expect(negative.jump).toBeUndefined();
    expect(zero.jump).toBeUndefined();
    expect(nonNumeric.jump).toBeUndefined();
    // A missing value is a usage error — distinct from a consumed-but-invalid one.
    expect(() => parseArgs(["-S", "Dune", "--jump"])).toThrow(/--jump expected a value/);

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

test("parseArgs rejects a value flag followed by a known flag", () => {
  // `-S` with no value before `--anime` is a usage error — it must neither
  // capture "--anime" as the query nor silently drop the missing value.
  expect(() => parseArgs(["-S", "--anime"])).toThrow(CliUsageError);
  expect(() => parseArgs(["-S", "--anime"])).toThrow(/-S expected a value/);
});

test("parseArgs rejects a value flag at end of input", () => {
  expect(() => parseArgs(["--search"])).toThrow(/--search expected a value/);
});

test("parseArgs still consumes negative-looking values for --jump", () => {
  // `-1` is not a known flag, so it is consumed as the (invalid) jump value.
  const args = parseArgs(["--jump", "-1", "Dune"]);

  expect(args.jump).toBeUndefined();
  expect(args.search).toBe("Dune");
});

test("parseArgs rejects an unknown flag as a usage error", () => {
  expect(() => parseArgs(["--definitely-not-a-flag", "-S", "Dune", "-a"])).toThrow(CliUsageError);
  expect(() => parseArgs(["--tpyo", "--dry-run"])).toThrow(/unknown option --tpyo/);
});

test("parseArgs rejects an unknown flag without letting its value become the query", () => {
  // `--config` is not a Kunai flag. Before strict parsing it was dropped and
  // the next token — a filesystem path — became the search query.
  expect(() => parseArgs(["--config", "/tmp/x.json", "--dry-run"])).toThrow(
    /unknown option --config/,
  );
});

test("parseArgs rejects a mistyped subcommand as a usage error", () => {
  // `runCli` only dispatches maintenance commands in argv[0]; a near-miss in
  // the query slot must name the command the caller probably meant instead
  // of becoming a network search.
  expect(() => parseArgs(["doctro"])).toThrow(/did you mean "kunai doctor"/);
  expect(() => parseArgs(["upgarde"])).toThrow(/did you mean "kunai upgrade"/);
});

test("parseArgs rejects a subcommand buried behind flags", () => {
  // argv[0] is "--debug", so runCli never saw "doctor" — it must not become
  // the search query.
  expect(() => parseArgs(["--debug", "doctor"])).toThrow(/kunai doctor/);
});

test("parseArgs still treats ordinary words and multi-word positionals as queries", () => {
  expect(parseArgs(["shrae"]).search).toBe("shrae");
  expect(parseArgs(["doctors", "who"]).search).toBe("doctors who");
  expect(parseArgs(["tv"]).search).toBe("tv");
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

test("parseArgs validates -i/--id against the resolvable grammar", () => {
  // Bare ids are numeric TMDB ids; `tmdb:`/`anilist:`/`mal:` carry positive
  // integers and `youtube:` carries an opaque video/playlist id. Unknown
  // namespaces (`imdb:`, `crunchyroll:`) are NOT parse errors — the resolver
  // reports them as `id-unknown-namespace` (see direct-id-namespaces.test.ts).
  for (const bad of ["abc", "0", "-5", "anilist:abc", "anilist:", "mal:0", "tmdb:0"]) {
    expect(() => parseArgs(["-i", bad, "-t", "movie"])).toThrow(CliUsageError);
  }
  expect(() => parseArgs(["-i", "abc", "-t", "movie"])).toThrow(/invalid -i\/--id/);

  expect(parseArgs(["-i", "438631", "-t", "movie"]).id).toBe("438631");
  expect(parseArgs(["-i", "anilist:21", "-t", "tv"]).id).toBe("anilist:21");
  expect(parseArgs(["-i", "tmdb:438631", "-t", "movie"]).id).toBe("tmdb:438631");
  expect(parseArgs(["-i", "mal:34034"]).id).toBe("mal:34034");
  expect(parseArgs(["-i", "youtube:dQw4w9WgXcQ"]).id).toBe("youtube:dQw4w9WgXcQ");
  expect(parseArgs(["-i", "imdb:tt0133093", "-t", "movie"]).id).toBe("imdb:tt0133093");
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
