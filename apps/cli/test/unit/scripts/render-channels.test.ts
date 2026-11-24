import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  parseSumsFile,
  renderHomebrewFormula,
  renderPkgbuild,
  renderScoopManifest,
  renderSrcinfo,
} from "../../../../../scripts/packaging/render-channels";

// The real v0.3.0 SHA256SUMS.archives — channel renderers must reproduce these
// URLs and digests verbatim or a published formula would point at nothing.
const SUMS_V030 = `6b6078de767dd209d284edf765ddb1d15099973a7994727f92d50c09a459a5a1  kunai-darwin-arm64.tar.gz
3fe148035741bf772a411ef729c64bcb29af241950f6c898c3cec3277b97c42d  kunai-darwin-x64.tar.gz
d7d2de88e6252dee3d2f8d70799e2d3c54c2b1eab940c82b09fbbcb01d4b3a9f  kunai-linux-arm64-musl.tar.gz
2151ede4b3c8f9a14249bd5182d852bf0d1ddb0f5205e48d4b3c0ad511c9cf31  kunai-linux-arm64.tar.gz
163f423086c712481eb0a936fec9d0751d693b5cab6b5370dd8628cafb57aac6  kunai-linux-x64-musl.tar.gz
b1bc0eb2c8e04138c5713031986b79dcc28f9680e4dc025b59fecc748adc13bf  kunai-linux-x64.tar.gz
b814bee6f7bafa814aef875c57e21a5775b3fd7d74ff4cee5dfa446c457e5a25  kunai-windows-arm64.zip
b857e3c28c4bffffdf75a1250a0d343fc4a4c703469ce6b94c79b2429d2ad0aa  kunai-windows-x64.zip
`;

const LICENSE_SHA = "8a00188a4777d3641940f206fc09f389ab40b1ec44611288e8a52b6e9b7530a1";
const channel = { version: "0.3.0", tag: "v0.3.0" };
const DL = "https://github.com/KitsuneKode/kunai/releases/download/v0.3.0";

const sums = parseSumsFile(SUMS_V030);

describe("parseSumsFile", () => {
  test("maps every archive name to its sha256", () => {
    expect(sums.get("kunai-linux-x64.tar.gz")).toBe(
      "b1bc0eb2c8e04138c5713031986b79dcc28f9680e4dc025b59fecc748adc13bf",
    );
    expect(sums.size).toBe(8);
  });

  test("rejects a line that is not a sha256sum record", () => {
    expect(() => parseSumsFile("not a checksum line\n")).toThrow("unparseable");
  });
});

describe("renderHomebrewFormula", () => {
  const formula = renderHomebrewFormula(channel, sums);

  test("pins every archive URL and sha256 from the real release", () => {
    for (const [name, sha] of [
      [
        "kunai-darwin-arm64.tar.gz",
        "6b6078de767dd209d284edf765ddb1d15099973a7994727f92d50c09a459a5a1",
      ],
      [
        "kunai-darwin-x64.tar.gz",
        "3fe148035741bf772a411ef729c64bcb29af241950f6c898c3cec3277b97c42d",
      ],
      [
        "kunai-linux-arm64.tar.gz",
        "2151ede4b3c8f9a14249bd5182d852bf0d1ddb0f5205e48d4b3c0ad511c9cf31",
      ],
      [
        "kunai-linux-x64.tar.gz",
        "b1bc0eb2c8e04138c5713031986b79dcc28f9680e4dc025b59fecc748adc13bf",
      ],
    ] as const) {
      expect(formula).toContain(`url "${DL}/${name}"`);
      expect(formula).toContain(`sha256 "${sha}"`);
    }
  });

  test("declares the formula shape: MIT, mpv caveat, version test", () => {
    expect(formula).toContain('license "MIT"');
    expect(formula).toContain("brew install mpv");
    expect(formula).not.toContain('depends_on "mpv"');
    expect(formula).toContain('assert_match version.to_s, shell_output("#{bin}/kunai --version")');
  });
});

describe("renderScoopManifest", () => {
  const manifest: unknown = JSON.parse(renderScoopManifest(channel, sums));

  test("is valid JSON with per-arch url, hash, and bin mapping", () => {
    // SAFETY: the renderer emits exactly this manifest shape; the test asserts it.
    const m = manifest as {
      version: string;
      license: string;
      architecture: Record<string, { url: string; hash: string; bin: string[][] }>;
    };
    expect(m.version).toBe("0.3.0");
    expect(m.license).toBe("MIT");
    expect(m.architecture["64bit"]?.url).toBe(`${DL}/kunai-windows-x64.zip`);
    expect(m.architecture["64bit"]?.hash).toBe(
      "b857e3c28c4bffffdf75a1250a0d343fc4a4c703469ce6b94c79b2429d2ad0aa",
    );
    expect(m.architecture["64bit"]?.bin).toEqual([["kunai-windows-x64.exe", "kunai"]]);
    expect(m.architecture.arm64?.url).toBe(`${DL}/kunai-windows-arm64.zip`);
    expect(m.architecture.arm64?.bin).toEqual([["kunai-windows-arm64.exe", "kunai"]]);
  });

  test("updates only through a reviewed manifest commit, never an unsigned remote hash", () => {
    // Scoop autoupdate would rewrite `hash` from SHA256SUMS.archives, which Scoop
    // cannot verify against the release signature. Like the Homebrew formula,
    // a new version arrives only as a commit rendered from verified sums.
    const rendered = renderScoopManifest(channel, sums);
    const keys = Object.keys(JSON.parse(rendered));
    expect(keys).not.toContain("autoupdate");
    expect(keys).not.toContain("checkver");
    expect(rendered).not.toContain("SHA256SUMS");
    expect(rendered).not.toContain("$version");
  });
});

// The committed tap and bucket are rewritten by the release metadata PR for
// every published version, so this drift check must not pin a fixture
// release. It reads the version and digests back out of the committed files,
// re-renders from exactly those inputs, and demands identical bytes: any
// hand edit, or a renderer change that was not re-rendered, fails here at
// whatever version is current.
describe("committed channel manifests", () => {
  const root = join(import.meta.dir, "../../../../..");
  const readCommitted = (rel: string) => Bun.file(join(root, rel)).text();

  /** Version + `<archive name> -> sha256` pairs a committed manifest declares. */
  function inputsFromFormula(text: string): { version: string; sums: Map<string, string> } {
    const version = /^\s*version "([^"]+)"$/m.exec(text)?.[1];
    if (!version) throw new Error("Formula/kunai.rb declares no version");
    const sums = new Map<string, string>();
    for (const match of text.matchAll(/url "[^"]*\/([^"/]+)"\n\s*sha256 "([0-9a-f]{64})"/g)) {
      const [, name, sha] = match;
      if (name && sha) sums.set(name, sha);
    }
    return { version, sums };
  }

  function inputsFromScoop(text: string): { version: string; sums: Map<string, string> } {
    // SAFETY: shape asserted by the byte-equality check below; a wrong shape
    // yields missing entries and the renderer fails closed.
    const parsed = JSON.parse(text) as {
      version: string;
      architecture: Record<string, { url: string; hash: string }>;
    };
    const sums = new Map<string, string>();
    for (const arch of Object.values(parsed.architecture)) {
      const name = arch.url.split("/").pop();
      if (name) sums.set(name, arch.hash);
    }
    return { version: parsed.version, sums };
  }

  const channelFor = (version: string) => ({ version, tag: `v${version}` });

  test("Formula/kunai.rb is byte-for-byte the renderer's output for its own version", async () => {
    const committed = await readCommitted("Formula/kunai.rb");
    const { version, sums: formulaSums } = inputsFromFormula(committed);
    expect(formulaSums.size).toBe(4);
    expect(committed).toBe(renderHomebrewFormula(channelFor(version), formulaSums));
  });

  test("bucket/kunai.json is byte-for-byte the renderer's output for its own version", async () => {
    const committed = await readCommitted("bucket/kunai.json");
    const { version, sums: scoopSums } = inputsFromScoop(committed);
    expect(scoopSums.size).toBe(2);
    expect(committed).toBe(renderScoopManifest(channelFor(version), scoopSums));
  });

  test("the tap and the bucket advertise the same release", async () => {
    const formula = inputsFromFormula(await readCommitted("Formula/kunai.rb"));
    const scoop = inputsFromScoop(await readCommitted("bucket/kunai.json"));
    expect(scoop.version).toBe(formula.version);
  });

  test("the drift check follows a re-rendered release instead of pinning one", () => {
    // What the metadata PR does on the next release: render new files from new
    // sums. Reading inputs back from that output must reproduce it exactly.
    const next = channelFor("9.8.7");
    const nextSums = new Map([...sums].map(([name]) => [name, "f".repeat(64)]));
    const formula = renderHomebrewFormula(next, nextSums);
    const scoop = renderScoopManifest(next, nextSums);
    const fromFormula = inputsFromFormula(formula);
    const fromScoop = inputsFromScoop(scoop);
    expect(fromFormula.version).toBe("9.8.7");
    expect(renderHomebrewFormula(channelFor(fromFormula.version), fromFormula.sums)).toBe(formula);
    expect(renderScoopManifest(channelFor(fromScoop.version), fromScoop.sums)).toBe(scoop);
  });
});

describe("renderPkgbuild + renderSrcinfo", () => {
  const input = { channel, sums, licenseSha256: LICENSE_SHA };
  const pkgbuild = renderPkgbuild(input);
  const srcinfo = renderSrcinfo(input);

  test("PKGBUILD carries per-arch sources, real sums, and the license fetch", () => {
    expect(pkgbuild).toContain("pkgname=kunai-bin");
    expect(pkgbuild).toContain("pkgver=0.3.0");
    expect(pkgbuild).toContain("depends=('mpv')");
    expect(pkgbuild).toContain(`kunai-bin-$pkgver-x86_64.tar.gz::${DL}/kunai-linux-x64.tar.gz`);
    expect(pkgbuild).toContain(`kunai-bin-$pkgver-aarch64.tar.gz::${DL}/kunai-linux-arm64.tar.gz`);
    expect(pkgbuild).toContain(
      "https://raw.githubusercontent.com/KitsuneKode/kunai/v$pkgver/LICENSE",
    );
    expect(pkgbuild).toContain("b1bc0eb2c8e04138c5713031986b79dcc28f9680e4dc025b59fecc748adc13bf");
    expect(pkgbuild).toContain("2151ede4b3c8f9a14249bd5182d852bf0d1ddb0f5205e48d4b3c0ad511c9cf31");
    expect(pkgbuild).toContain(LICENSE_SHA);
    expect(pkgbuild).toContain('install -Dm0755 "$_binary" "$pkgdir/usr/bin/kunai"');
    expect(pkgbuild).toContain('"$pkgdir/usr/share/licenses/kunai-bin/LICENSE"');
  });

  test(".SRCINFO mirrors the same fields deterministically", () => {
    expect(srcinfo).toContain("pkgbase = kunai-bin");
    expect(srcinfo).toContain("\tpkgver = 0.3.0");
    expect(srcinfo).toContain("\tarch = x86_64");
    expect(srcinfo).toContain("\tarch = aarch64");
    expect(srcinfo).toContain(
      `\tsource_x86_64 = kunai-bin-$pkgver-x86_64.tar.gz::${DL}/kunai-linux-x64.tar.gz`,
    );
    expect(srcinfo).toContain(
      "\tsha256sums_x86_64 = b1bc0eb2c8e04138c5713031986b79dcc28f9680e4dc025b59fecc748adc13bf",
    );
    expect(srcinfo).toContain(`\tsha256sums_x86_64 = ${LICENSE_SHA}`);
    // Same input, same bytes — publish diffs stay empty when nothing changed.
    expect(renderSrcinfo(input)).toBe(srcinfo);
  });
});

describe("render failures", () => {
  test("a missing sums entry fails closed rather than emitting a wrong hash", () => {
    const missing = new Map(sums);
    missing.delete("kunai-windows-x64.zip");
    expect(() => renderScoopManifest(channel, missing)).toThrow("kunai-windows-x64.zip");
  });
});
