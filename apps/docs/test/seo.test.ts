import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { codeMetadata } from "../lib/code-metadata";
import { source } from "../lib/source";

const DOCS_APP_ROOT = path.resolve(import.meta.dir, "..");

function readDocFile(page: { readonly data: { readonly info: { readonly fullPath: string } } }) {
  return fs.readFileSync(path.resolve(DOCS_APP_ROOT, page.data.info.fullPath), "utf-8");
}

function readFrontmatter(filePath: string): { title?: string; description?: string } {
  const content = fs.readFileSync(filePath, "utf-8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return {};
  const block = match[1];
  const title = block.match(/^title:\s*(.+)$/m)?.[1]?.trim();
  const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { title, description };
}

function readYamlSymptoms(): { id: string; anchor: string }[] {
  const yamlPath = path.resolve(DOCS_APP_ROOT, "../../docs/troubleshooting-symptoms.yaml");
  const content = fs.readFileSync(yamlPath, "utf-8");
  const anchors: { id: string; anchor: string }[] = [];
  let currentId = "";
  for (const line of content.split("\n")) {
    const idMatch = line.match(/^\s*- id:\s*(.+)$/);
    if (idMatch?.[1]) {
      currentId = idMatch[1];
      continue;
    }
    const anchorMatch = line.match(/^\s*anchor:\s*(.+)$/);
    if (anchorMatch?.[1] && currentId) {
      anchors.push({ id: currentId, anchor: anchorMatch[1] });
    }
  }
  return anchors;
}

describe("docs SEO drift", () => {
  test("sitemap pages have unique titles and descriptions in frontmatter", () => {
    const pages = source.getPages();
    const titles = new Set<string>();
    const descriptions = new Set<string>();

    for (const page of pages) {
      const filePath = path.resolve(DOCS_APP_ROOT, page.data.info.fullPath);
      const { title, description } = readFrontmatter(filePath);

      expect(title && title.length > 0).toBe(true);
      expect(description && description.length > 0).toBe(true);
      expect(titles.has(title!)).toBe(false);
      titles.add(title!);
      expect(descriptions.has(description!)).toBe(false);
      descriptions.add(description!);
    }
  });

  test("every sitemap page has internal doc links in body or is a hub", () => {
    const pages = source.getPages();
    for (const page of pages) {
      const content = readDocFile(page);
      const internalLinks = (content.match(/\/docs\/[^\s")]+/g) ?? []).length;
      const isHub = page.data.info.path.endsWith("index.mdx");
      expect(internalLinks >= 2 || isHub).toBe(true);
    }
  });

  test("llms.txt route includes version stamps", () => {
    const routeFile = fs.readFileSync(path.join(DOCS_APP_ROOT, "app/llms.txt/route.ts"), "utf-8");
    expect(routeFile).toContain("@doc-version");
    expect(routeFile).toContain("@cli-source-revision");
  });

  test("llms.txt page lines use title link description format", async () => {
    const { GET } = await import("../app/llms.txt/route");
    const response = await GET();
    const text = await response.text();
    const pageLines = text
      .split("\n")
      .filter((line) => line.startsWith("- [") && line.includes("]("));

    expect(pageLines.length).toBeGreaterThan(10);
    const linePattern = /^- \[.+\]\(.+\): .+$/;
    for (const line of pageLines) {
      expect(linePattern.test(line)).toBe(true);
    }
  });

  test("troubleshooting page wires FAQ schema data", () => {
    const pageFile = fs.readFileSync(
      path.join(DOCS_APP_ROOT, "app/docs/[[...slug]]/page.tsx"),
      "utf-8",
    );
    expect(pageFile).toContain("faqPageJsonLd");
    expect(pageFile).toContain("buildTroubleshootingFaqEntries");
  });

  test("troubleshooting FAQ anchors exist in MDX", () => {
    const troubleshooting = readDocFile(
      source.getPages().find((page) => page.data.info.path === "users/troubleshooting.mdx")!,
    );
    for (const symptom of readYamlSymptoms()) {
      expect(troubleshooting.toLowerCase()).toContain(symptom.anchor.toLowerCase());
    }
  });

  test("home shell includes crawlable hero heading", () => {
    const shell = fs.readFileSync(
      path.join(DOCS_APP_ROOT, "components/home/home-hero-static.tsx"),
      "utf-8",
    );
    expect(shell).toContain("<h1");
    expect(shell).toContain("CANONICAL_INSTALL");
    const install = fs.readFileSync(path.join(DOCS_APP_ROOT, "lib/install-commands.ts"), "utf-8");
    expect(install).toContain("bun install -g @kitsunekode/kunai");
  });

  test("glossary is registered in users meta.json", () => {
    const meta = JSON.parse(
      fs.readFileSync(path.resolve(DOCS_APP_ROOT, "../../docs/users/meta.json"), "utf-8"),
    ) as { pages: string[] };
    expect(meta.pages).toContain("glossary");
  });

  test("command count in metadata is at least 68", () => {
    expect(codeMetadata.commandCount).toBeGreaterThanOrEqual(68);
  });
});
