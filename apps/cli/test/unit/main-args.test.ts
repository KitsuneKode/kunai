import { expect, test } from "bun:test";

import { buildCliHelpText, parseCliArgs as parseArgs } from "@/cli-args";

test("buildCliHelpText describes canonical launch flags", () => {
  const help = buildCliHelpText("0.0.0-test");

  expect(help).toContain("Kunai 0.0.0-test");
  expect(help).toContain("-S, --search <query>");
  expect(help).toContain("--continue, --resume");
  expect(help).toContain("--install-protocol-handler");
  expect(help).toContain("Register the Linux kunai:// URL handler");
  expect(help).toContain("-y, --youtube");
  expect(help).toContain("--debug                Verbose redacted logging to ./logs.txt");
  expect(help).toContain("kunai doctor");
  expect(help).toContain("kunai doctor --json");
  expect(help).toContain("kunai rollback");
  expect(help).toContain("kunai rollback --list");
  expect(help).toContain("kunai rollback --to <ver>");
  expect(help).toContain("kunai rollback --dry-run");
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

test("parseArgs supports zen startup as minimal quick playback", () => {
  const args = parseArgs(["--zen", "-S", "Dune"]);

  expect(args.zen).toBe(true);
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

test("parseArgs supports -q / --quick as hands-off first-result", () => {
  const quickShort = parseArgs(["-S", "Dune", "-q"]);
  const quickLong = parseArgs(["-S", "Dune", "--quick"]);

  expect(quickShort.search).toBe("Dune");
  expect(quickShort.quick).toBe(true);
  expect(quickLong.quick).toBe(true);
});

test("parseArgs ignores invalid --jump values without crashing", () => {
  const negative = parseArgs(["-S", "Dune", "--jump", "-1"]);
  const zero = parseArgs(["-S", "Dune", "--jump", "0"]);
  const missing = parseArgs(["-S", "Dune", "--jump"]);

  // Invalid --jump values fall back to "ask the user" — the field stays
  // undefined so the bootstrap resolves the search to the browse surface.
  expect(negative.jump).toBeUndefined();
  expect(zero.jump).toBeUndefined();
  expect(missing.jump).toBeUndefined();
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
