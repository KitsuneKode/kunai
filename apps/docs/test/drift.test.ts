import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { codeMetadata } from "../lib/code-metadata";
import { docNavEntries } from "../lib/doc-navigation";
import {
  computeCliSourceFingerprint,
  computeDocsContentFingerprint,
} from "../lib/metadata-fingerprints";
import { source } from "../lib/source";

const ROOT = path.resolve(import.meta.dir, "../../..");
const DOCS_ROOT = path.join(ROOT, "docs");
const PROVIDER_BOOTSTRAP_PATH = path.join(ROOT, "apps/cli/src/container/bootstrap-providers.ts");
const REGISTRY_PATH = path.join(ROOT, "apps/cli/src/domain/session/command-registry.ts");
const SYNC_SCRIPT_PATH = path.join(ROOT, "apps/docs/scripts/sync-code-metadata.ts");

const MODULE_TO_ID: Record<string, string> = {
  videasyProviderModule: "videasy",
  vidlinkProviderModule: "vidlink",
  rivestreamProviderModule: "rivestream",
  allmangaProviderModule: "allanime",
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
    pageUrls.add("/telemetry");

    for (const entry of docNavEntries) {
      if (
        entry.href.startsWith("/docs") ||
        entry.href === "/releases" ||
        entry.href === "/feedback" ||
        entry.href === "/telemetry"
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

  test("--download help describes download-only bootstrap", () => {
    const download = codeMetadata.cliOptions.find((option) => option.long === "--download");
    expect(download).toBeDefined();
    expect(download?.description.toLowerCase()).toContain("download");
    expect(download?.description.toLowerCase()).not.toContain("open the download queue");
  });

  test("cli source fingerprint matches live CLI inputs", () => {
    expect(codeMetadata.cliSourceFingerprint).toBe(computeCliSourceFingerprint(ROOT));
  });

  test("docs content fingerprint matches published docs tree", () => {
    expect(codeMetadata.docsContentFingerprint).toBe(computeDocsContentFingerprint(ROOT));
  });

  test("cliSourceRevision is a short sha or unknown", () => {
    expect(codeMetadata.cliSourceRevision.length).toBeGreaterThan(0);
    expect(/^[0-9a-f]{7,12}$|unknown/.test(codeMetadata.cliSourceRevision)).toBe(true);
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
      codeMetadata.shortcuts.some((row) => row.id === "browse-mode" && row.keys === "Tab"),
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
});
