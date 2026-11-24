import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSignManifestCli } from "../../../../../scripts/sign-provider-manifest";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("sign-provider-manifest CLI", () => {
  test("generates an Ed25519 keypair, signs a valid manifest, verifies it, and refuses invalid manifests", () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-sign-cli-"));
    tempDirs.push(dir);
    const privPath = join(dir, "private.pem");
    const pubPath = join(dir, "public.pem");
    const manifestPath = join(dir, "manifest.json");
    const signedPath = join(dir, "signed.json");
    const pubkeysPath = join(dir, "pubkeys.json");

    expect(
      runSignManifestCli(["keygen", "--out-private", privPath, "--out-public", pubPath]).code,
    ).toBe(0);
    expect(
      runSignManifestCli(["keygen", "--out-private", privPath, "--out-public", pubPath]).code,
    ).toBe(1);

    const now = new Date();
    const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        generatedAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        providers: {
          rivestream: { baseUrl: "https://scrapper.rivestream.app" },
        },
      }),
      "utf8",
    );

    const signedRes = runSignManifestCli([
      "sign",
      "--in",
      manifestPath,
      "--key",
      privPath,
      "--key-id",
      "kunai-2026",
      "--out",
      signedPath,
    ]);
    expect(signedRes.code).toBe(0);

    writeFileSync(
      pubkeysPath,
      JSON.stringify({ "kunai-2026": readFileSync(pubPath, "utf8") }),
      "utf8",
    );
    expect(runSignManifestCli(["verify", "--in", signedPath, "--pubkeys", pubkeysPath]).code).toBe(
      0,
    );

    // Unsafe cleartext HTTP mirror must be refused at signing time.
    const unsafePath = join(dir, "unsafe.json");
    writeFileSync(
      unsafePath,
      JSON.stringify({
        schemaVersion: 1,
        revision: 2,
        generatedAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        providers: {
          rivestream: { baseUrl: "http://insecure.example" },
        },
      }),
      "utf8",
    );
    expect(
      runSignManifestCli([
        "sign",
        "--in",
        unsafePath,
        "--key",
        privPath,
        "--key-id",
        "kunai-2026",
        "--out",
        signedPath,
      ]).code,
    ).toBe(1);
  });
});
