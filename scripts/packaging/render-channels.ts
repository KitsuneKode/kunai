/**
 * Pure package-channel renderers: Homebrew formula, Scoop manifest, and the
 * AUR `kunai-bin` PKGBUILD + .SRCINFO, all derived from a release tag and the
 * published `SHA256SUMS.archives` file.
 *
 * Asset names are read from `RELEASE_BINARY_TARGETS` (the source of truth the
 * release workflow publishes from), so a rename there fails here loudly rather
 * than shipping a stale channel file.
 *
 * CLI: bun scripts/packaging/render-channels.ts --version <x.y.z> --sums <path>
 *      [--license <path>] --out <dir>
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "../../apps/cli/src/services/update/platform-assets";

const GITHUB_RELEASE_DOWNLOAD = "https://github.com/KitsuneKode/kunai/releases/download";
const HOMEPAGE = "https://kunai.kitsunekode.in";
const DESCRIPTION = "Terminal-first streaming CLI for anime, series, and movies, played in mpv";

export type ChannelVersion = {
  /** Bare semver, e.g. `0.3.0`. */
  readonly version: string;
  /** Release tag, e.g. `v0.3.0`. */
  readonly tag: string;
};

/** sha256 per release asset name, parsed from `SHA256SUMS.archives`. */
export type SumsMap = ReadonlyMap<string, string>;

/** Parse `sha256sum` output lines (`<64-hex>  <name>` or `<64-hex> *<name>`). */
export function parseSumsFile(text: string): SumsMap {
  const sums = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const match = /^([0-9a-fA-F]{64})\s+[ *]?(.+)$/.exec(line);
    const sha = match?.[1];
    const name = match?.[2];
    if (!sha || !name) {
      throw new Error(`[render-channels] unparseable SHA256SUMS line: ${line}`);
    }
    sums.set(name.trim(), sha.toLowerCase());
  }
  return sums;
}

function target(id: string) {
  const found = RELEASE_BINARY_TARGETS.find((t) => t.id === id);
  if (!found) {
    throw new Error(`[render-channels] no release target named ${id}`);
  }
  return found;
}

function assetUrl(channel: ChannelVersion, archiveName: string): string {
  return `${GITHUB_RELEASE_DOWNLOAD}/${channel.tag}/${archiveName}`;
}

function sumFor(sums: SumsMap, archiveName: string): string {
  const sha = sums.get(archiveName);
  if (!sha) {
    throw new Error(`[render-channels] SHA256SUMS.archives has no entry for ${archiveName}`);
  }
  return sha;
}

const darwinArm64 = target("darwin-arm64");
const darwinX64 = target("darwin-x64");
const linuxArm64 = target("linux-arm64");
const linuxX64 = target("linux-x64");
const windowsX64 = target("windows-x64");
const windowsArm64 = target("windows-arm64");

export function renderHomebrewFormula(channel: ChannelVersion, sums: SumsMap): string {
  const block = (os: "macos" | "linux", arch: "arm" | "intel", archiveName: string): string =>
    `    on_${arch} do\n` +
    `      url "${assetUrl(channel, archiveName)}"\n` +
    `      sha256 "${sumFor(sums, archiveName)}"\n` +
    `    end\n`;

  return `# typed: false
# frozen_string_literal: true

# Homebrew formula for Kunai — rendered by scripts/packaging/render-channels.ts
# from the published SHA256SUMS.archives. Do not edit by hand; the packaging
# workflow regenerates this file on every release.
class Kunai < Formula
  desc "${DESCRIPTION}"
  homepage "${HOMEPAGE}"
  version "${channel.version}"
  license "MIT"

  on_macos do
${block("macos", "arm", darwinArm64.archiveName)}${block("macos", "intel", darwinX64.archiveName)}  end

  on_linux do
${block("linux", "arm", linuxArm64.archiveName)}${block("linux", "intel", linuxX64.archiveName)}  end

  # Every archive ships exactly one platform-named binary (e.g. kunai-darwin-arm64).
  def install
    bin.install Dir["kunai-*"].first => "kunai"
  end

  def caveats
    <<~EOS
      Kunai plays media through mpv — install it if you do not already have it:
        brew install mpv
      Optional extras enable more sources and downloads:
        brew install yt-dlp ffmpeg
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/kunai --version")
  end
end
`;
}

export function renderScoopManifest(channel: ChannelVersion, sums: SumsMap): string {
  const manifest = {
    version: channel.version,
    description: DESCRIPTION,
    homepage: HOMEPAGE,
    license: "MIT",
    architecture: {
      "64bit": {
        url: assetUrl(channel, windowsX64.archiveName),
        hash: sumFor(sums, windowsX64.archiveName),
        bin: [[windowsX64.archiveEntryName, "kunai"]],
      },
      arm64: {
        url: assetUrl(channel, windowsArm64.archiveName),
        hash: sumFor(sums, windowsArm64.archiveName),
        bin: [[windowsArm64.archiveEntryName, "kunai"]],
      },
    },
    suggest: { mpv: "extras/mpv" },
    checkver: { github: "https://github.com/KitsuneKode/kunai" },
    autoupdate: {
      architecture: {
        "64bit": {
          url: `${GITHUB_RELEASE_DOWNLOAD}/v$version/${windowsX64.archiveName}`,
        },
        arm64: {
          url: `${GITHUB_RELEASE_DOWNLOAD}/v$version/${windowsArm64.archiveName}`,
        },
      },
      // sha256sum-style file: Scoop matches the line naming the downloaded file.
      hash: {
        url: `${GITHUB_RELEASE_DOWNLOAD}/v$version/SHA256SUMS.archives`,
      },
    },
  };
  return `${JSON.stringify(manifest, null, 4)}\n`;
}

const AUR_OPTDEPENDS = [
  "yt-dlp: YouTube playback and downloads",
  "ffmpeg: post-download integrity checks",
  "curl: anime providers behind Cloudflare",
] as const;

export type AurRenderInput = {
  readonly channel: ChannelVersion;
  readonly sums: SumsMap;
  /**
   * sha256 of the upstream LICENSE file at the tag. Release archives do not
   * embed a license, so the PKGBUILD fetches it separately; pass "SKIP" only
   * when the real digest is unavailable.
   */
  readonly licenseSha256: string;
};

export function renderPkgbuild(input: AurRenderInput): string {
  const { channel, sums, licenseSha256 } = input;
  const srcFor = (archLabel: string, archiveName: string): string[] => [
    `kunai-bin-$pkgver-${archLabel}.tar.gz::${assetUrl(channel, archiveName)}`,
    `LICENSE-$pkgver::https://raw.githubusercontent.com/KitsuneKode/kunai/v$pkgver/LICENSE`,
  ];
  const sumsFor = (archiveName: string): string[] => [sumFor(sums, archiveName), licenseSha256];

  return `# Maintainer: KitsuneKode
# Rendered by scripts/packaging/render-channels.ts — do not edit by hand.
pkgname=kunai-bin
pkgver=${channel.version}
pkgrel=1
pkgdesc="${DESCRIPTION}"
arch=('x86_64' 'aarch64')
url="${HOMEPAGE}"
license=('MIT')
provides=('kunai')
conflicts=('kunai')
depends=('mpv')
optdepends=(${AUR_OPTDEPENDS.map((d) => `'${d}'`).join("\n            ")})
source_x86_64=("${srcFor("x86_64", linuxX64.archiveName).join('"\n               "')}")
source_aarch64=("${srcFor("aarch64", linuxArm64.archiveName).join('"\n               "')}")
sha256sums_x86_64=('${sumsFor(linuxX64.archiveName).join("'\n                   '")}')
sha256sums_aarch64=('${sumsFor(linuxArm64.archiveName).join("'\n                   '")}')

package() {
    case "$CARCH" in
        x86_64)  _binary="${linuxX64.archiveEntryName}" ;;
        aarch64) _binary="${linuxArm64.archiveEntryName}" ;;
    esac
    install -Dm0755 "$_binary" "$pkgdir/usr/bin/kunai"
    install -Dm0644 "LICENSE-$pkgver" "$pkgdir/usr/share/licenses/kunai-bin/LICENSE"
}
`;
}

/** Deterministic .SRCINFO — matches `makepkg --printsrcinfo` field order. */
export function renderSrcinfo(input: AurRenderInput): string {
  const { channel, sums, licenseSha256 } = input;
  const lines: string[] = [
    "pkgbase = kunai-bin",
    `\tpkgdesc = ${DESCRIPTION}`,
    `\tpkgver = ${channel.version}`,
    "\tpkgrel = 1",
    `\turl = ${HOMEPAGE}`,
    "\tarch = x86_64",
    "\tarch = aarch64",
    "\tlicense = MIT",
    "\tdepends = mpv",
    ...AUR_OPTDEPENDS.map((d) => `\toptdepends = ${d}`),
    "\tprovides = kunai",
    "\tconflicts = kunai",
  ];
  for (const [archLabel, archiveName] of [
    ["x86_64", linuxX64.archiveName],
    ["aarch64", linuxArm64.archiveName],
  ] as const) {
    lines.push(
      `\tsource_${archLabel} = kunai-bin-$pkgver-${archLabel}.tar.gz::${assetUrl(channel, archiveName)}`,
      `\tsource_${archLabel} = LICENSE-$pkgver::https://raw.githubusercontent.com/KitsuneKode/kunai/v$pkgver/LICENSE`,
      `\tsha256sums_${archLabel} = ${sumFor(sums, archiveName)}`,
      `\tsha256sums_${archLabel} = ${licenseSha256}`,
    );
  }
  lines.push("", "pkgname = kunai-bin", "");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI

function parseArgs(argv: readonly string[]): {
  version: string;
  sumsPath: string;
  licensePath?: string;
  outDir: string;
} {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) {
      throw new Error(`[render-channels] unexpected argument: ${flag}`);
    }
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`[render-channels] ${flag} needs a value`);
    }
    args[flag] = value;
  }
  const version = args["--version"];
  const sumsPath = args["--sums"];
  const outDir = args["--out"];
  if (!version || !sumsPath || !outDir) {
    throw new Error(
      "[render-channels] usage: bun scripts/packaging/render-channels.ts --version <x.y.z> --sums <path> [--license <path>] --out <dir>",
    );
  }
  return { version, sumsPath, licensePath: args["--license"], outDir };
}

function main(): void {
  const { version, sumsPath, licensePath, outDir } = parseArgs(Bun.argv.slice(2));
  const bare = version.replace(/^v/, "");
  const channel: ChannelVersion = { version: bare, tag: `v${bare}` };
  const sums = parseSumsFile(readFileSync(sumsPath, "utf8"));
  const licenseSha256 = licensePath
    ? createHash("sha256").update(readFileSync(licensePath)).digest("hex")
    : "SKIP";

  const aurInput: AurRenderInput = { channel, sums, licenseSha256 };
  const files: Record<string, string> = {
    "Formula/kunai.rb": renderHomebrewFormula(channel, sums),
    "bucket/kunai.json": renderScoopManifest(channel, sums),
    "aur/kunai-bin/PKGBUILD": renderPkgbuild(aurInput),
    "aur/kunai-bin/.SRCINFO": renderSrcinfo(aurInput),
  };
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(outDir, rel);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, content);
    console.log(`wrote ${rel}`);
  }
}

if (import.meta.main) {
  main();
}
