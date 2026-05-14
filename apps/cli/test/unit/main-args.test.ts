import { expect, test } from "bun:test";

import { parseArgs } from "@/main";

test("parseArgs supports download-only mode", () => {
  const args = parseArgs(["--download", "-S", "Dune", "--download-path", "/tmp/kunai"]);

  expect(args.download).toBe(true);
  expect(args.downloadPath).toBe("/tmp/kunai");
  expect(args.search).toBe("Dune");
});

test("parseArgs supports startup entry routes", () => {
  const resume = parseArgs(["--resume"]);
  const continuePlayback = parseArgs(["--continue"]);
  const history = parseArgs(["--history"]);
  const offline = parseArgs(["--offline"]);

  expect(resume.continuePlayback).toBe(true);
  expect(continuePlayback.continuePlayback).toBe(true);
  expect(history.history).toBe(true);
  expect(offline.offline).toBe(true);
});
