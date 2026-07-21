import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  BUN_GLOBAL_INSTALL,
  CANONICAL_INSTALL,
  CANONICAL_SETUP,
  FIRST_SEARCH,
  INSTALL_HIERARCHY,
  MPV_VERSION_CHECK,
  NATIVE_INSTALL_SH,
  NPM_GLOBAL_INSTALL,
  PREFERRED_INSTALL,
  PRIMARY_UPGRADE,
  QUICK_START_COMMANDS,
  VERSION_CHECK,
} from "../lib/install-commands";
import {
  INSTALLER_REFERENCE_PREFIX,
  PUBLIC_TRUTH_SURFACES,
  readPublicTruthSurface,
} from "../lib/metadata-fingerprints";
import {
  getReleaseByTag,
  latestReleaseNotesArtifact,
  publishedReleaseNotesArtifacts,
} from "../lib/release-notes";

const ROOT = path.resolve(import.meta.dir, "../../..");

function readSurface(relPath: (typeof PUBLIC_TRUTH_SURFACES)[number]): string {
  return readPublicTruthSurface(relPath, ROOT);
}

function combinedPublicDocs(): string {
  return PUBLIC_TRUTH_SURFACES.map((rel) => readSurface(rel)).join("\n\n");
}

describe("0.3.0 public truth contract", () => {
  test("install hierarchy helpers encode native → Bun → npm → source", () => {
    expect(INSTALL_HIERARCHY).toEqual(["native", "bun", "npm", "source"]);
    expect(PREFERRED_INSTALL).toBe(NATIVE_INSTALL_SH);
    expect(BUN_GLOBAL_INSTALL).toContain("@kitsunekode/kunai");
    expect(NPM_GLOBAL_INSTALL).toContain("@kitsunekode/kunai");
    // Canonical home/docs install must prefer native once reconciled.
    expect(CANONICAL_INSTALL).toBe(PREFERRED_INSTALL);
  });

  test("quick start is install → version → mpv → setup → first search", () => {
    expect(QUICK_START_COMMANDS).toEqual([
      NATIVE_INSTALL_SH,
      VERSION_CHECK,
      MPV_VERSION_CHECK,
      CANONICAL_SETUP,
      FIRST_SEARCH,
    ]);

    const readme = readSurface("README.md");
    const gettingStarted = readSurface("docs/users/getting-started.mdx");
    const quickStartSteps = readSurface("apps/docs/components/docs/quick-start-steps.tsx");

    for (const command of QUICK_START_COMMANDS) {
      expect(readme).toContain(command);
    }

    // Getting started / QuickStartSteps must not present Bun global as the primary path.
    expect(gettingStarted).toContain(NATIVE_INSTALL_SH);
    expect(gettingStarted).toContain(VERSION_CHECK);
    expect(gettingStarted).toContain(MPV_VERSION_CHECK);
    expect(gettingStarted).not.toMatch(/Canonical path:.*bun install -g/i);
    expect(quickStartSteps).toContain(NATIVE_INSTALL_SH);
    expect(quickStartSteps).not.toContain(BUN_GLOBAL_INSTALL);
  });

  test("kunai upgrade is the primary update path", () => {
    const readme = readSurface("README.md");
    const installDoc = readSurface("docs/users/install-and-update.mdx");

    expect(PRIMARY_UPGRADE).toBe("kunai upgrade");
    expect(readme).toContain(PRIMARY_UPGRADE);
    expect(installDoc).toContain(PRIMARY_UPGRADE);
    // Package-manager update must not be framed as the default primary path.
    expect(installDoc).not.toMatch(/primary (update|upgrade).*(bun update|npm install -g)/i);
    expect(readme.toLowerCase()).toMatch(/keep it current with `kunai upgrade`/);
  });

  test("binary does not require Bun; npm does", () => {
    const installDoc = readSurface("docs/users/install-and-update.mdx");
    const gettingStarted = readSurface("docs/users/getting-started.mdx");
    const cliReadme = readSurface("apps/cli/README.md");
    const joined = [installDoc, gettingStarted, cliReadme].join("\n");

    expect(joined).toMatch(
      /do not need Bun|no Bun|without Bun|Bun runtime embedded|embed(?:s|ded)? Bun/i,
    );
    expect(joined).toMatch(
      /npm[\s\S]{0,200}require[s]? Bun|Bun[\s\S]{0,80}npm|npm global[\s\S]{0,160}Bun/i,
    );

    // npm channel page/docs must not imply Bun-free npm installs.
    expect(gettingStarted).not.toMatch(
      /npm global installs may work, but Bun is what the project tests/i,
    );
  });

  test("protocol registration is documented as Linux-only", () => {
    const help = readSurface("apps/cli/src/cli-args.ts");
    const shareLinks = readSurface("docs/users/share-links.mdx");
    const platforms = readSurface("docs/users/platforms.mdx");

    expect(help).toMatch(/Linux kunai:\/\/ URL handler|Linux-only/i);
    expect(shareLinks).toMatch(/Linux-only|Linux only|only on Linux/i);
    expect(platforms).toMatch(/Linux-only|Linux only|protocol[\s\S]{0,80}Linux/i);
  });

  test("platform support matrix: Linux supported; macOS/Windows beta; Windows ARM64 experimental", () => {
    const support = readSurface("docs/users/supported-and-unsupported.mdx");
    const installDoc = readSurface("docs/users/install-and-update.mdx");
    const platforms = readSurface("docs/users/platforms.mdx");
    const joined = [support, installDoc, platforms].join("\n");

    expect(joined).toMatch(/Linux[^\n]{0,80}(supported|Supported)/);
    expect(joined).toMatch(/macOS[^\n]{0,80}\bbeta\b/i);
    expect(joined).toMatch(/Windows[^\n]{0,80}\bbeta\b/i);
    expect(joined).toMatch(/Windows ARM64[^\n]{0,80}experimental|ARM64[^\n]{0,40}experimental/i);

    // Stale "fully supported" claims for macOS/Windows binaries must not remain.
    expect(installDoc).not.toMatch(
      /macOS x64\/arm64 \(Apple Silicon\) \| Supported via release binaries/,
    );
    expect(installDoc).not.toMatch(/Windows x64\/arm64 \| Supported via release binaries/);
  });

  test("Discord IPC is Unix socket plus Windows named pipe", () => {
    const readme = readSurface("README.md");
    const customization = readSurface("docs/users/customization.mdx");
    const joined = `${readme}\n${customization}`;

    expect(joined).toMatch(/Unix socket|Unix-socket/i);
    expect(joined).toMatch(/named pipe|named-pipe/i);
  });

  test("poster fallback is half-block; chafa is optional", () => {
    const readme = readSurface("README.md");
    const support = readSurface("docs/users/supported-and-unsupported.mdx");
    const featureTour = readSurface("docs/users/feature-tour.mdx");
    const platforms = readSurface("docs/users/platforms.mdx");
    const joined = [readme, support, featureTour, platforms].join("\n");

    expect(joined).toMatch(/half-block/i);
    expect(joined).toMatch(/chafa/i);
    expect(joined).toMatch(/chafa[^\n.]{0,80}optional|optional[^\n.]{0,80}chafa/i);

    // Must not imply posters require chafa with no half-block fallback.
    expect(support).not.toMatch(
      /chafa \/ Kitty graphics \| No \| Poster previews degraded or hidden/,
    );
    expect(readme).not.toMatch(/Falls back to chafa or none/);
  });

  test("CLI help lists doctor and rollback lifecycle commands", () => {
    const help = readSurface("apps/cli/src/cli-args.ts");
    const cliReference = readSurface("docs/users/cli-reference.mdx");

    expect(help).toContain("kunai doctor");
    expect(help).toContain("kunai rollback");
    expect(help).toContain("kunai upgrade");
    expect(help).toContain("kunai uninstall");

    // Public CLI reference must surface the same lifecycle commands.
    expect(cliReference).toMatch(/\bdoctor\b/);
    expect(cliReference).toMatch(/\brollback\b/);
    expect(cliReference).toContain("kunai upgrade");
  });

  test("0.2.6 is not latest or published", () => {
    const staged = getReleaseByTag("0.2.6");
    expect(staged).toBeDefined();
    expect(staged?.status).toBe("staged");
    expect(staged?.publishedAt).toBeNull();

    expect(latestReleaseNotesArtifact()?.version).not.toBe("0.2.6");
    expect(publishedReleaseNotesArtifacts().some((release) => release.version === "0.2.6")).toBe(
      false,
    );

    const publicCopy = combinedPublicDocs().toLowerCase();
    expect(publicCopy).not.toMatch(/0\.2\.6[^\n]{0,40}(latest|published)/);
    expect(publicCopy).not.toMatch(/(latest|published)[^\n]{0,40}0\.2\.6/);
  });

  test("installer-reference source is not tracked", () => {
    const result = Bun.spawnSync(["git", "ls-files", INSTALLER_REFERENCE_PREFIX], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const tracked = new TextDecoder().decode(result.stdout).trim();
    expect(tracked).toBe("");
  });
});
