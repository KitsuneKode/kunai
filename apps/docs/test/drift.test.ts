import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { codeMetadata } from "../lib/code-metadata";

const ROOT = path.resolve(import.meta.dir, "../../..");
const USERS_DOCS = path.join(ROOT, "docs/users");
const CONTAINER_PATH = path.join(ROOT, "apps/cli/src/container.ts");
const REGISTRY_PATH = path.join(ROOT, "apps/cli/src/domain/session/command-registry.ts");

function listUserGuideFiles(): string[] {
  return fs
    .readdirSync(USERS_DOCS)
    .filter((name) => name.endsWith(".md") || name.endsWith(".mdx"))
    .map((name) => path.join(USERS_DOCS, name));
}

function parseContainerProviderModules(content: string): string[] {
  const arrayMatch = content.match(/orderProviderModulesByPriority\(\s*\[([\s\S]*?)\],\s*\{/);
  if (!arrayMatch?.[1]) return [];
  return [...arrayMatch[1].matchAll(/(\w+ProviderModule)/g)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name));
}

const MODULE_TO_ID: Record<string, string> = {
  videasyProviderModule: "videasy",
  vidlinkProviderModule: "vidlink",
  rivestreamProviderModule: "rivestream",
  allmangaProviderModule: "allanime",
  miruroProviderModule: "miruro",
};

describe("docs codegen drift", () => {
  test("provider ids match container.ts registration order", () => {
    const container = fs.readFileSync(CONTAINER_PATH, "utf-8");
    const modules = parseContainerProviderModules(container);
    const expectedIds = modules
      .map((module) => MODULE_TO_ID[module])
      .filter((id): id is string => Boolean(id));

    expect(codeMetadata.providerIds).toEqual(expectedIds);
    expect(codeMetadata.providers.map((provider) => provider.id)).toEqual(expectedIds);
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

  test("user guides do not link to unpublished ../../.docs paths", () => {
    for (const filePath of listUserGuideFiles()) {
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).not.toMatch(/\.\.\/\.\.\/\.docs\//);
    }
  });

  test("--download help describes download-only bootstrap", () => {
    const download = codeMetadata.cliOptions.find((option) => option.long === "--download");
    expect(download).toBeDefined();
    expect(download?.description.toLowerCase()).toContain("download");
    expect(download?.description.toLowerCase()).not.toContain("open the download queue");
  });
});
