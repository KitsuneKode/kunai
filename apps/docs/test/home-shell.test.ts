import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { codeMetadata } from "../lib/code-metadata";
import { homeFlow, homeHero, homeStartCards } from "../lib/home-content";
import { featuredCommands } from "../lib/home-presenters";

const DOCS_APP_ROOT = path.resolve(import.meta.dir, "..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(DOCS_APP_ROOT, relativePath), "utf-8");
}

const BANNED_HOME_JARGON = [
  "provider drift",
  "codegen-synced",
  "future agents to extend",
  "Designed for provider drift",
  "Synced from the running CLI",
  "Active scrapers in the codebase",
  "ProvidersCatalog",
  "CliCommandBuilder",
] as const;

describe("docs home shell", () => {
  test("home hero static exposes a single crawlable h1", () => {
    const hero = readSource("components/home/home-hero-static.tsx");
    const h1Count = (hero.match(/<h1/g) ?? []).length;
    expect(h1Count).toBe(1);
    expect(hero).toContain("CANONICAL_INSTALL");
    expect(readSource("lib/install-commands.ts")).toContain("bun install -g @kitsunekode/kunai");
  });

  test("terminal simulator does not duplicate hero markup", () => {
    const terminal = readSource("components/home/terminal-simulator.tsx");
    expect(terminal).not.toContain("<h1");
    expect(terminal).not.toContain("HeroHeadline");
    expect(terminal).not.toContain("installCommands");
  });

  test("home shell uses slim sections without catalog or builder", () => {
    const shell = readSource("app/(home)/home-page-shell.tsx");
    const interactive = readSource("app/(home)/home-page-interactive.tsx");

    expect(shell).toContain("kunai-home-hero");
    expect(shell).toContain("StartHereCards");
    expect(shell).toContain("ProviderSummaryCard");
    expect(shell).not.toContain("GuideLinkGrid");
    expect(shell).not.toContain("homeProof");
    expect(interactive).not.toContain("ProvidersCatalog");
    expect(interactive).not.toContain("CliCommandBuilder");
  });

  test("home marketing copy avoids internal jargon", () => {
    const sources = [
      readSource("lib/home-content.ts"),
      readSource("app/(home)/home-page-shell.tsx"),
      readSource("components/home/provider-summary-card.tsx"),
    ].join("\n");

    for (const phrase of BANNED_HOME_JARGON) {
      expect(sources.includes(phrase)).toBe(false);
    }
  });

  test("featured command palette stays capped on the home page", () => {
    const palette = featuredCommands(codeMetadata.commands);
    expect(palette.length).toBeLessThanOrEqual(8);
    expect(palette.length).toBeGreaterThan(0);
  });

  test("home flow and start cards stay curated", () => {
    expect(homeFlow).toHaveLength(3);
    expect(homeStartCards).toHaveLength(4);
    expect(homeHero.primaryCta.href).toBe("/docs/users/getting-started");
    expect(homeHero.secondaryCta.href).toBe("/docs");
  });

  test("ascii brand mark ships non-empty art", () => {
    const ascii = readSource("lib/brand/ascii-kunai.ts");
    expect(ascii).toContain("ASCII_KUNAI");
    expect(ascii).toContain("/\\\\");
    const shell = readSource("app/(home)/home-page-shell.tsx");
    expect(shell).toContain("AsciiBrandMark");
  });
});
