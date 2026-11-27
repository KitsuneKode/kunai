import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { provenance } from "@/lib/provenance";

import { codeMetadata } from "../lib/code-metadata";
import { docNavEntries } from "../lib/doc-navigation";
import { source } from "../lib/source";

const ROOT = path.resolve(import.meta.dir, "../../..");
const DOCS_ROOT = path.join(ROOT, "docs");
const PROVIDER_BOOTSTRAP_PATH = path.join(ROOT, "apps/cli/src/container/bootstrap-providers.ts");
const REGISTRY_PATH = path.join(ROOT, "apps/cli/src/domain/session/command-registry.ts");
const SYNC_SCRIPT_PATH = path.join(ROOT, "apps/docs/scripts/sync-code-metadata.ts");
const DEFAULT_CONFIG_PATH = path.join(ROOT, "packages/config/src/defaults.ts");
const PLATFORM_ASSETS_PATH = path.join(ROOT, "apps/cli/src/services/update/platform-assets.ts");
const INTERNAL_PROVIDERS_PATH = path.join(ROOT, ".docs/providers.md");

const MODULE_TO_ID: Record<string, string> = {
  videasyProviderModule: "videasy",
  vidlinkProviderModule: "vidlink",
  rivestreamProviderModule: "rivestream",
  movyProviderModule: "movy",
  vidrockProviderModule: "vidrock",
  allmangaProviderModule: "allanime",
  hianimeProviderModule: "hianime",
  animeggProviderModule: "animegg",
  kickassanimeProviderModule: "kickassanime",
  miruroProviderModule: "miruro",
  youtubeProviderModule: "youtube",
};

function listDocFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Published fumadocs surfaces only — skip plans/specs and local scratch.
      if (
        (entry.name === "superpowers" || entry.name === "installer-reference") &&
        path.basename(dir) === "docs"
      ) {
        continue;
      }
      files.push(...listDocFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseContainerProviderModules(content: string): string[] {
  const arrayMatch = content.match(/orderProviderModulesByPriority\(\s*\[([\s\S]*?)\]\s*,/);
  if (!arrayMatch?.[1]) return [];
  return [...arrayMatch[1].matchAll(/(\w+ProviderModule)/g)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name));
}

function readMetaPages(metaPath: string): string[] {
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as { pages?: string[] };
  return meta.pages ?? [];
}

describe("docs codegen drift", () => {
  test("provider ids match provider bootstrap registration order", () => {
    const providerBootstrap = fs.readFileSync(PROVIDER_BOOTSTRAP_PATH, "utf-8");
    const modules = parseContainerProviderModules(providerBootstrap);
    const expectedIds = modules
      .map((module) => MODULE_TO_ID[module])
      .filter((id): id is string => Boolean(id));

    expect(codeMetadata.providerIds).toEqual(expectedIds);
    expect(codeMetadata.providers.map((provider) => provider.id)).toEqual(expectedIds);
  });

  test("sync script provider map covers every bootstrap module", () => {
    const providerBootstrap = fs.readFileSync(PROVIDER_BOOTSTRAP_PATH, "utf-8");
    const syncScript = fs.readFileSync(SYNC_SCRIPT_PATH, "utf-8");
    const modules = parseContainerProviderModules(providerBootstrap);

    for (const moduleName of modules) {
      expect(syncScript).toContain(`${moduleName}:`);
    }
  });

  test("provider lane order metadata matches config defaults", () => {
    const defaults = fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8");
    const stringValue = (key: string) => {
      const marker = `${key}: "`;
      const startIndex = defaults.indexOf(marker);
      if (startIndex < 0) throw new Error(`missing ${key}`);
      const valueStart = startIndex + marker.length;
      const valueEnd = defaults.indexOf('"', valueStart);
      return defaults.slice(valueStart, valueEnd);
    };
    const arrayValue = (key: string) => {
      const marker = `${key}: [`;
      const startIndex = defaults.indexOf(marker);
      if (startIndex < 0) throw new Error(`missing ${key}`);
      const bodyStart = startIndex + marker.length;
      const bodyEnd = defaults.indexOf("]", bodyStart);
      return [...defaults.slice(bodyStart, bodyEnd).matchAll(/"([^"]+)"/g)]
        .map((match) => match[1])
        .filter((value): value is string => Boolean(value));
    };
    const dedupe = (values: readonly string[]) => [...new Set(values)];

    const seriesDefault = stringValue("provider");
    const animeDefault = stringValue("animeProvider");
    const youtubeDefault = stringValue("youtubeProvider");
    const seriesRest = arrayValue("providerPriority");
    const animeRest = arrayValue("animeProviderPriority");
    const youtubeRest = arrayValue("youtubeProviderPriority");

    expect(codeMetadata.providerDefaults.revision).toBe(
      Number(defaults.match(/providerDefaultsRevision:\s*(\d+)/)?.[1]),
    );
    expect(codeMetadata.providerDefaults.series.order).toEqual(
      dedupe([seriesDefault, ...seriesRest]),
    );
    expect(codeMetadata.providerDefaults.anime.order).toEqual(dedupe([animeDefault, ...animeRest]));
    expect(codeMetadata.providerDefaults.youtube.order).toEqual(
      dedupe([youtubeDefault, ...youtubeRest]),
    );
  });

  test("release target metadata matches the published target contract", () => {
    const platformAssets = fs.readFileSync(PLATFORM_ASSETS_PATH, "utf-8");
    const ids = [...platformAssets.matchAll(/releaseBinaryTarget\(\{\s*id:\s*"([^"]+)"/g)]
      .map((match) => match[1])
      .filter((id): id is string => Boolean(id));

    expect(codeMetadata.releaseTargets.map((target) => target.id)).toEqual(ids);
    expect(codeMetadata.releaseTargets).toHaveLength(10);
    expect(
      codeMetadata.releaseTargets.find((target) => target.id === "linux-x64")?.supportTier,
    ).toBe("supported");
    expect(
      codeMetadata.releaseTargets.find((target) => target.id === "windows-arm64")?.supportTier,
    ).toBe("experimental");
  });

  test("player support metadata mirrors the player-choice contract", () => {
    expect(codeMetadata.playerSupport.desktopManagedPlayers).toEqual(["mpv", "vlc"]);
    expect(codeMetadata.playerSupport.androidTargets).toEqual(["chooser", "mpv", "vlc"]);
  });

  test("generated provider-order and platform tables replace stale manual matrices", () => {
    const providers = fs.readFileSync(path.join(DOCS_ROOT, "users/providers.mdx"), "utf-8");
    const supported = fs.readFileSync(
      path.join(DOCS_ROOT, "users/supported-and-unsupported.mdx"),
      "utf-8",
    );
    const platforms = fs.readFileSync(path.join(DOCS_ROOT, "users/platforms.mdx"), "utf-8");
    const install = fs.readFileSync(path.join(DOCS_ROOT, "users/install-and-update.mdx"), "utf-8");

    expect(providers).toContain("<ProviderOrderTable />");
    expect(supported).toContain("<ProviderOrderTable />");
    expect(supported).toContain("<PlatformSupportTable />");
    expect(platforms).toContain("<PlatformSupportTable />");
    expect(install).toContain("<PlatformSupportTable />");
    expect(supported).not.toContain("| AniDB (`anidb`)");
    expect(providers).not.toContain(
      '"providerPriority": ["rivestream", "vidrock", "movy", "videasy"]',
    );
    expect(providers).not.toContain(
      '"animeProviderPriority": ["animegg", "kickassanime", "miruro", "allanime"]',
    );
    expect(supported).not.toContain("In 0.3.0");
    expect(platforms).not.toContain("Support posture (0.3.0)");
    expect(install).not.toContain("Platform support matrix (0.3.0)");
  });

  test("internal provider authority does not list retired AniDB as active", () => {
    const content = fs.readFileSync(INTERNAL_PROVIDERS_PATH, "utf-8");
    const activeStart = content.indexOf("## Active Beta Providers");
    const activeEnd = content.indexOf("Cineby is not a production provider", activeStart);
    const activeSection = content.slice(activeStart, activeEnd);

    expect(activeStart).toBeGreaterThanOrEqual(0);
    expect(activeEnd).toBeGreaterThan(activeStart);
    expect(activeSection).not.toContain("| AniDB");
    expect(content).toContain(
      '`animeProviderPriority: ["kickassanime", "animegg", "miruro", "allanime"]`',
    );
    expect(content).toContain("provider-defaults revision 8");
  });

  test("command count matches registry parse", () => {
    const registry = fs.readFileSync(REGISTRY_PATH, "utf-8");
    const startIndex = registry.indexOf("export const COMMANDS: readonly AppCommand[] = [");
    const block = registry.slice(startIndex);
    const ids = [...block.matchAll(/id:\s*["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((id): id is string => Boolean(id));

    expect(codeMetadata.commandCount).toBe(ids.length);
    expect(codeMetadata.commands.length).toBe(ids.length);
  });

  test("cliVersion matches package version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/cli/package.json"), "utf-8")) as {
      version: string;
    };
    expect(codeMetadata.cliVersion).toBe(pkg.version);
    expect(codeMetadata.version).toBe(pkg.version);
  });

  test("feature status entries use allowed enum values", () => {
    const allowed = new Set(["shipped", "beta", "planned"]);
    for (const feature of codeMetadata.featureStatus) {
      expect(allowed.has(feature.status)).toBe(true);
      expect(feature.id.length).toBeGreaterThan(0);
      expect(feature.label.length).toBeGreaterThan(0);
    }
  });

  test("published docs do not link to unpublished ../../.docs or ../../.plans paths", () => {
    for (const filePath of listDocFiles(DOCS_ROOT)) {
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).not.toMatch(/\.\.\/\.\.\/\.docs\//);
      expect(content).not.toMatch(/\.\.\/\.\.\/\.plans\//);
    }
  });

  test("published docs avoid relative ./slug.mdx internal links", () => {
    for (const filePath of listDocFiles(DOCS_ROOT)) {
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).not.toMatch(/\]\(\.\/[^)]+\.mdx?\)/);
    }
  });

  test("meta.json pages exist on disk", () => {
    for (const metaPath of [
      path.join(DOCS_ROOT, "users/meta.json"),
      path.join(DOCS_ROOT, "developer/meta.json"),
    ]) {
      for (const page of readMetaPages(metaPath)) {
        const md = path.join(path.dirname(metaPath), `${page}.md`);
        const mdx = path.join(path.dirname(metaPath), `${page}.mdx`);
        expect(fs.existsSync(md) || fs.existsSync(mdx)).toBe(true);
      }
    }
  });

  test("doc-navigation hrefs resolve to sitemap pages", () => {
    const pageUrls = new Set(source.getPages().map((page) => page.url));
    pageUrls.add("/releases");
    pageUrls.add("/feedback");
    pageUrls.add("/analytics");

    for (const entry of docNavEntries) {
      if (
        entry.href.startsWith("/docs") ||
        entry.href === "/releases" ||
        entry.href === "/feedback" ||
        entry.href === "/analytics"
      ) {
        expect(pageUrls.has(entry.href)).toBe(true);
      }
    }
  });

  test("published docs do not present Playwright as active runtime", () => {
    for (const filePath of listDocFiles(DOCS_ROOT)) {
      const content = fs.readFileSync(filePath, "utf-8").toLowerCase();
      if (!content.includes("playwright")) continue;
      expect(
        content.includes("archived") ||
          content.includes("archive-only") ||
          content.includes("not part of active") ||
          content.includes("not supported") ||
          content.includes("planned") ||
          content.includes("legacy"),
      ).toBe(true);
    }
  });

  test("Windows install guidance names the real mpv package Kunai probes", () => {
    for (const filePath of [
      path.join(ROOT, "README.md"),
      path.join(ROOT, "apps/cli/README.md"),
      path.join(DOCS_ROOT, "users/platforms.mdx"),
    ]) {
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("winget install --id mpv-player.mpv-CI.MSVC -e");
      expect(content).not.toMatch(/winget install mpv(?:\s|`)/);
    }
  });

  test("--download help describes download-only bootstrap", () => {
    const download = codeMetadata.cliOptions.find((option) => option.long === "--download");
    expect(download).toBeDefined();
    expect(download?.description.toLowerCase()).toContain("download");
    expect(download?.description.toLowerCase()).not.toContain("open the download queue");
  });

  test("the committed payload carries no churn keys", () => {
    // cliSourceFingerprint, docsContentFingerprint and featureStatusRevision
    // re-hashed on every unrelated source or docs-tree edit, which is what made
    // every pair of PRs conflict on generated-metadata.json. They now live in
    // the gitignored provenance sidecar; if one comes back, the conflict churn
    // comes back with it.
    const committedKeys = Object.keys(codeMetadata);
    expect(committedKeys).not.toContain("cliSourceFingerprint");
    expect(committedKeys).not.toContain("docsContentFingerprint");
    expect(committedKeys).not.toContain("featureStatusRevision");
  });

  test("the freshness gate passes on the committed payload", () => {
    // Run the real CI command rather than reimplementing its comparison: a file
    // that drifted from its real inputs (providers, commands, flags, versions)
    // must exit non-zero here.
    const result = Bun.spawnSync(["bun", "run", "apps/docs/scripts/check-codegen-freshness.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
  });

  test("tampering with real content changes the identity the gate compares", () => {
    // metadataIdentity is the whole-payload JSON string; a content change must
    // move it, which is what makes a stale committed file fail the gate.
    const tampered = {
      ...codeMetadata,
      providerIds: [...codeMetadata.providerIds, "phantom"],
    };
    expect(JSON.stringify(tampered)).not.toBe(JSON.stringify(codeMetadata));
  });

  test("a fresh build emits no fingerprint keys either", () => {
    // Proving at the writer, not just the file: an unrelated CLI source edit
    // cannot change the committed payload through these fields any more.
    const result = Bun.spawnSync(
      [
        "bun",
        "-e",
        'import { buildMetadata } from "./apps/docs/scripts/sync-code-metadata.ts"; console.log(Object.keys(buildMetadata()).join(","));',
      ],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode !== 0) console.log(new TextDecoder().decode(result.stderr));
    expect(result.exitCode).toBe(0);
    const keys = new TextDecoder().decode(result.stdout);
    expect(keys).not.toContain("cliSourceFingerprint");
    expect(keys).not.toContain("docsContentFingerprint");
    expect(keys).not.toContain("featureStatusRevision");
  });

  test("the moved fingerprints still land in the provenance sidecar", () => {
    // Diagnostics keep their view of what the inputs hashed to; nothing
    // reads these for freshness anymore.
    expect(provenance.cliSourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.docsContentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.featureStatusRevision).toMatch(/^[0-9a-f]{64}$/);
  });

  test("cliSourceRevision is a short sha or unknown", () => {
    // Lives in the gitignored provenance sidecar, not the committed metadata:
    // it moves on every commit and would otherwise conflict between branches.
    expect(provenance.cliSourceRevision.length).toBeGreaterThan(0);
    expect(/^[0-9a-f]{7,12}$|unknown/.test(provenance.cliSourceRevision)).toBe(true);
  });

  test("feature status has at least fifteen entries", () => {
    expect(codeMetadata.featureStatus.length).toBeGreaterThanOrEqual(15);
  });

  test("supported-and-unsupported uses FeatureStatusTable not duplicate Shipped rows", () => {
    const content = fs.readFileSync(
      path.join(DOCS_ROOT, "users/supported-and-unsupported.mdx"),
      "utf-8",
    );
    expect(content).toContain("<FeatureStatusTable />");
    expect(content).not.toMatch(/\| Terminal shell \(Ink\) \| \*\*Shipped\*\*/);
  });

  test("commands-and-shortcuts uses ShortcutTable from generated registry metadata", () => {
    const content = fs.readFileSync(
      path.join(DOCS_ROOT, "users/commands-and-shortcuts.mdx"),
      "utf-8",
    );
    expect(content).toContain("<ShortcutTable />");
    expect(codeMetadata.shortcuts.length).toBeGreaterThan(0);
    expect(
      codeMetadata.shortcuts.every((row) => row.tier === "core" || row.tier === "surface"),
    ).toBe(true);
    expect(
      // Tab cycles forward, ⇧Tab back — the registry renders both in one row,
      // so this asserts the pair rather than the bare forward key.
      codeMetadata.shortcuts.some((row) => row.id === "browse-mode" && row.keys === "Tab / ⇧Tab"),
    ).toBe(true);
    expect(
      codeMetadata.shortcuts.some((row) => row.id === "player-fallback" && row.keys === "⇧F"),
    ).toBe(true);
  });

  test("home content avoids hardcoded provider or command counts", () => {
    const homeContent = fs.readFileSync(path.join(ROOT, "apps/docs/lib/home-content.ts"), "utf-8");
    expect(homeContent).not.toMatch(/\b66\b|\b68\b/);
  });

  test("published docs avoid marketing filler terms", () => {
    const banned = /\b(seamless|unleash|next-gen)\b/i;
    for (const filePath of listDocFiles(DOCS_ROOT)) {
      const content = fs.readFileSync(filePath, "utf-8");
      if (banned.test(content)) {
        expect(content.toLowerCase()).toContain("not supported");
      }
    }
  });

  test("published docs prose avoids em-dashes and non-range en-dashes", () => {
    // Em-dashes read as generated filler; ranges like `1–5` and `L0–L4` keep
    // the en-dash because that is what it is for. Fenced code blocks are
    // exempt: mock output must mirror what the tool actually prints.
    const rangeDash = /[A-Za-z]?\d–[A-Za-z]?\d/;
    for (const filePath of listDocFiles(DOCS_ROOT)) {
      const content = fs.readFileSync(filePath, "utf-8");
      let inFence = false;
      const prose = content
        .split("\n")
        .filter((line) => {
          if (line.trimStart().startsWith("```")) {
            inFence = !inFence;
            return false;
          }
          return !inFence;
        })
        .join("\n");
      expect(prose).not.toContain("—");
      const strayEnDash = prose
        .split("")
        .map((char, i) => (char === "–" ? prose.slice(Math.max(0, i - 2), i + 3) : null))
        .filter((ctx): ctx is string => ctx !== null && !rangeDash.test(ctx));
      expect(strayEnDash).toEqual([]);
    }
  });

  test("frontmatter values containing colons are quoted", () => {
    // An unquoted `key: text with: colon` is a YAML nested-mapping error that
    // only surfaces when the page is compiled — a colon in prose silently 500s
    // the route. Quote the value instead.
    const scalar = /^(\w[\w-]*):\s+(.+)$/;
    for (const filePath of listDocFiles(DOCS_ROOT)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatter?.[1]) continue;
      for (const line of frontmatter[1].split("\n")) {
        const match = line.match(scalar);
        if (!match?.[2]) continue;
        const value = match[2].trim();
        if (value.startsWith('"') || value.startsWith("'")) continue;
        if (value.includes(": ") || value.endsWith(":")) {
          expect.unreachable(`${filePath}: unquoted frontmatter "${match[1]}" contains a colon`);
        }
      }
    }
  });

  test("published docs do not describe config surfaces the runtime never reads", () => {
    // These config/file surfaces were documented while nothing in the runtime
    // consumed them; the keys are deleted now, and this guard keeps the docs
    // from resurrecting them. If any surface ever becomes real, delete the row
    // here AND restore the doc, in the same change.
    const phantomSurfaces = [
      /providers\.json/,
      /`autoDownload`/,
      /"autoDownload"/,
      /`autoDownloadNextCount`/,
      /"`autoDownloadNextCount`"/,
      /`subLang`/,
      /`animeLang`/,
      /`headless`/,
      /`artworkPreviewsEnabled`/,
      /`powerSaverAllowManualArtwork`/,
    ];
    for (const filePath of listDocFiles(DOCS_ROOT)) {
      const content = fs.readFileSync(filePath, "utf-8");
      for (const banned of phantomSurfaces) {
        expect(content).not.toMatch(banned);
      }
    }
  });
});
