import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildHotfixManifestDraft,
  parseObservedProviderStatusRows,
  runGenerateHotfixManifestCli,
} from "../../../../../scripts/generate-hotfix-manifest";
import { runSignManifestCli } from "../../../../../scripts/sign-provider-manifest";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("generate-hotfix-manifest", () => {
  test("ranks healthy providers first, demotes down hosts, and never bricks an all-down lane", () => {
    const rows = parseObservedProviderStatusRows({
      providers: [
        { id: "vidlink", lane: "series", status: "down" },
        { id: "movy", lane: "series", status: "ok" },
        { id: "rivestream", lane: "series", status: "degraded" },
        { id: "hianime", lane: "anime", status: "down" },
        { id: "allanime", lane: "anime", status: "down" },
      ],
    });

    const manifest = buildHotfixManifestDraft({
      rows,
      revision: 7,
      nowMs: Date.parse("2026-11-22T00:00:00.000Z"),
      lifetimeDays: 14,
      disableDownWhenSiblingOk: true,
    });

    expect(manifest.revision).toBe(7);
    expect(manifest.lanePriorities?.series).toEqual(["movy", "rivestream", "vidlink"]);
    // Series has a healthy sibling ("movy"), so down "vidlink" may be disabled.
    expect(manifest.providers.vidlink?.disabled).toBe(true);
    // Anime has NO healthy sibling, so neither anime provider is disabled (lane-bricking guard).
    expect(manifest.providers.hianime).toBeUndefined();
    expect(manifest.providers.allanime).toBeUndefined();
  });

  test("CLI generates a draft that passes sign-provider-manifest sign and verify round-trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-gen-hotfix-"));
    tempDirs.push(dir);
    const statusPath = join(dir, "status.json");
    const draftPath = join(dir, "draft.json");
    const privPath = join(dir, "priv.pem");
    const pubPath = join(dir, "pub.pem");
    const pubkeysPath = join(dir, "pubkeys.json");
    const signedPath = join(dir, "signed.json");

    writeFileSync(
      statusPath,
      JSON.stringify({
        providers: [
          { id: "hianime", lane: "anime", status: "ok" },
          { id: "kickassanime", lane: "anime", status: "ok" },
          { id: "movy", lane: "series", status: "ok" },
        ],
      }),
      "utf8",
    );

    const gen = runGenerateHotfixManifestCli([
      "--revision",
      "12",
      "--days",
      "21",
      "--in",
      statusPath,
      "--out",
      draftPath,
    ]);
    expect(gen.code).toBe(0);

    expect(
      runSignManifestCli(["keygen", "--out-private", privPath, "--out-public", pubPath]).code,
    ).toBe(0);
    expect(
      runSignManifestCli([
        "sign",
        "--in",
        draftPath,
        "--key",
        privPath,
        "--key-id",
        "ops-2026",
        "--out",
        signedPath,
      ]).code,
    ).toBe(0);
    writeFileSync(
      pubkeysPath,
      JSON.stringify({ "ops-2026": readFileSync(pubPath, "utf8") }),
      "utf8",
    );
    const verified = runSignManifestCli(["verify", "--in", signedPath, "--pubkeys", pubkeysPath]);
    expect(verified.code).toBe(0);
    expect(verified.output).toContain("rev 12");
  });
});
