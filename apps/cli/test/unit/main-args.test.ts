import { expect, test } from "bun:test";

import { parseArgs } from "@/main";

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
  const args = parseArgs(["--handoff-url", "kunai://play?search=Dune"]);

  expect(args.handoffUrl).toBe("kunai://play?search=Dune");
  expect(args.search).toBeUndefined();
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
