import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertDoubleWitness,
  assertKittyEvidenceSurvival,
  checkKittyDoctor,
  inspectOwnedKittySession,
} from "../../agent/verification";

test("kitty doctor rejects live mode without a provider pin", async () => {
  const display = process.env.DISPLAY;
  process.env.DISPLAY = "kunai-doctor-test:0";
  try {
    const report = await checkKittyDoctor({ live: true });
    expect(report.ok).toBe(false);
    expect(report.lines.some((line) => line.includes("provider"))).toBe(true);
  } finally {
    if (display === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = display;
  }
});

test("double witness rejects frame-only claims", () => {
  expect(() =>
    assertDoubleWitness({
      frameText: "Minimal footer hints",
      frameNeedle: "Minimal",
      backendJson: '{"footerHints":"full"}',
      backendNeedle: '"footerHints": "minimal"',
    }),
  ).toThrow("Backend witness");
});

test("double witness accepts matching frame and backend", () => {
  assertDoubleWitness({
    frameText: "Settings · footer hints minimal",
    frameNeedle: "minimal",
    backendJson: '{"footerHints":"minimal"}',
    backendNeedle: '"footerHints":"minimal"',
  });
});

test("inspectOwnedKittySession requires interactive chrome", async () => {
  await expect(
    inspectOwnedKittySession({
      text: async () => "Kunai\nloading…",
      paths: {
        configPath: join(tmpdir(), "missing-config.json"),
        dataDbPath: join(tmpdir(), "missing-data.sqlite"),
        cacheDbPath: join(tmpdir(), "missing-cache.sqlite"),
      },
    }),
  ).rejects.toThrow("interactive surface");
});

test("evidence survival requires results.json and per-route cleanup", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-evidence-survival-"));
  const routeDir = join(root, "scenario");
  mkdirSync(routeDir, { recursive: true });
  writeFileSync(
    join(root, "results.json"),
    JSON.stringify({ results: [{ label: "scenario", status: "scenario-observed" }] }),
  );
  writeFileSync(
    join(routeDir, "cleanup.json"),
    JSON.stringify({ privateStateClean: true, terminalExited: true }),
  );
  writeFileSync(join(routeDir, "captures.json"), "[]");
  expect(() =>
    assertKittyEvidenceSurvival(root, [{ label: "scenario", status: "scenario-observed" }]),
  ).not.toThrow();
});

test("evidence survival fails when cleanup.json is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-evidence-missing-"));
  mkdirSync(join(root, "scenario"));
  writeFileSync(
    join(root, "results.json"),
    JSON.stringify({ results: [{ label: "scenario", status: "scenario-observed" }] }),
  );
  expect(() =>
    assertKittyEvidenceSurvival(root, [{ label: "scenario", status: "scenario-observed" }]),
  ).toThrow("cleanup.json");
});
