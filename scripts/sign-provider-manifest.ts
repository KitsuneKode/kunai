#!/usr/bin/env bun
/**
 * Ed25519 keygen, signing, and verification CLI for Tier-1 provider hotfix manifests.
 *
 * Usage:
 *   bun run scripts/sign-provider-manifest.ts keygen --out-private <path> --out-public <path>
 *   bun run scripts/sign-provider-manifest.ts sign --in <manifest.json> --key <private.pem> --key-id <id> --out <signed.json>
 *   bun run scripts/sign-provider-manifest.ts verify --in <signed.json> --pubkeys <pubkeys.json>
 */

import { generateKeyPairSync } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

import {
  isValidProviderHotfixManifest,
  signProviderManifest,
  verifySignedProviderManifest,
} from "../packages/providers/src/shared/manifest-bundle";
import { isJsonObject, isJsonString, type JsonValue } from "../packages/types/src/json-value";

export interface SignManifestCliResult {
  readonly code: number;
  readonly output: string;
}

function readFlag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function parseJsonValue(text: string): JsonValue {
  // SAFETY: JSON.parse returns standard JSON values matching the JsonValue contract.
  return JSON.parse(text) as JsonValue;
}

function parsePubkeysFile(text: string): Readonly<Record<string, string>> {
  const parsed = parseJsonValue(text);
  if (!isJsonObject(parsed)) return {};
  const entries: [string, string][] = [];
  for (const [keyId, pem] of Object.entries(parsed)) {
    if (isJsonString(pem) && pem.trim().length > 0) {
      entries.push([keyId, pem]);
    }
  }
  return Object.fromEntries(entries);
}

export function runSignManifestCli(argv: readonly string[]): SignManifestCliResult {
  const cmd = argv[0];
  if (cmd === "keygen") {
    const outPrivate = readFlag(argv, "--out-private");
    const outPublic = readFlag(argv, "--out-public");
    if (!outPrivate || !outPublic) {
      return {
        code: 2,
        output: "Usage: keygen --out-private <private.pem> --out-public <public.pem>\n",
      };
    }
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    try {
      writeFileSync(outPrivate, privatePem, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch {
      return {
        code: 1,
        output: `Refused to overwrite existing private key at ${outPrivate}\n`,
      };
    }
    chmodSync(outPrivate, 0o600);
    writeFileSync(outPublic, publicPem, "utf8");
    return {
      code: 0,
      output: `Generated Ed25519 keypair: private=${outPrivate} (0600), public=${outPublic}\n`,
    };
  }

  if (cmd === "sign") {
    const inPath = readFlag(argv, "--in");
    const keyPath = readFlag(argv, "--key");
    const keyId = readFlag(argv, "--key-id");
    const outPath = readFlag(argv, "--out");
    if (!inPath || !keyPath || !keyId || !outPath) {
      return {
        code: 2,
        output:
          "Usage: sign --in <manifest.json> --key <private.pem> --key-id <id> --out <signed.json>\n",
      };
    }
    const rawManifest = parseJsonValue(readFileSync(inPath, "utf8"));
    if (!isValidProviderHotfixManifest(rawManifest)) {
      return {
        code: 1,
        output: "Manifest failed schema/URL/lifetime validation — refused to sign.\n",
      };
    }
    const privatePem = readFileSync(keyPath, "utf8");
    const signed = signProviderManifest(rawManifest, privatePem, keyId);
    writeFileSync(outPath, `${JSON.stringify(signed, null, 2)}\n`, "utf8");
    return {
      code: 0,
      output: `Signed provider manifest rev ${rawManifest.revision} (${keyId}) -> ${outPath}\n`,
    };
  }

  if (cmd === "verify") {
    const inPath = readFlag(argv, "--in");
    const pubkeysPath = readFlag(argv, "--pubkeys");
    if (!inPath || !pubkeysPath) {
      return {
        code: 2,
        output: "Usage: verify --in <signed.json> --pubkeys <pubkeys.json>\n",
      };
    }
    const envelope = parseJsonValue(readFileSync(inPath, "utf8"));
    const pubkeys = parsePubkeysFile(readFileSync(pubkeysPath, "utf8"));
    const verified = verifySignedProviderManifest(envelope, pubkeys);
    if (!verified.ok) {
      return { code: 1, output: `Verification failed: ${verified.reason}\n` };
    }
    return {
      code: 0,
      output: `Verified provider manifest rev ${verified.manifest.revision} (${verified.keyId}), expires ${verified.manifest.expiresAt}\n`,
    };
  }

  return {
    code: 2,
    output: "Usage: sign-provider-manifest.ts <keygen|sign|verify> [flags]\n",
  };
}

if (import.meta.main) {
  const result = runSignManifestCli(process.argv.slice(2));
  process.stdout.write(result.output);
  process.exit(result.code);
}
