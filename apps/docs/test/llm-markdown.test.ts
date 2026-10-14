import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { llmsMarkdownOptions } from "../lib/llm-markdown";

// Under bun test, `.mdx?collection=docs` modules resolve as raw text — the
// compiled `_markdown` export only exists in the Next build. So these tests pin
// the stringifier's decisions directly against synthetic MDX nodes, and pin that
// every JSX component used in docs/ is one this file knowingly handles.
const DOCS_DIR = path.join(import.meta.dir, "../../..", "docs");

type FakeJsx = {
  type: string;
  name: string;
  attributes: { type: string; name: string; value?: unknown }[];
  children: unknown[];
};

function jsx(name: string, attrs: Record<string, string> = {}, children: unknown[] = []): FakeJsx {
  return {
    type: "mdxJsxFlowElement",
    name,
    attributes: Object.entries(attrs).map(([k, v]) => ({
      type: "mdxJsxAttribute",
      name: k,
      value: v,
    })),
    children,
  };
}

const stringify = (node: FakeJsx) =>
  llmsMarkdownOptions.stringify!(
    node as never,
    undefined as never,
    { containerFlow: () => "CHILDREN" } as never,
    {} as never,
    undefined as never,
  );

describe("llms markdown stringifier", () => {
  test("ProviderTable becomes a real Markdown table over the provider registry", () => {
    const out = stringify(jsx("ProviderTable"))!;
    expect(out).toContain("| Provider | Domain | Media | Status | Description |");
    expect(out).toContain("| Miruro |");
    expect(out).toContain("Full detail:");
  });

  test("DocSectionCards emits the group's card links", () => {
    const out = stringify(jsx("DocSectionCards", { group: "setup" }))!;
    expect(out).toContain("](");
    expect(out).not.toContain("undefined");
  });

  test("ProviderDocSection keeps its title as a heading and its prose", () => {
    const out = stringify(jsx("ProviderDocSection", { title: "Videasy" }))!;
    expect(out).toBe("## Videasy\n\nCHILDREN");
  });

  test("ScopeCallout titles match the component's copy map", () => {
    const component = fs.readFileSync(
      path.join(import.meta.dir, "../components/docs/scope-callout.tsx"),
      "utf8",
    );
    for (const [variant, title] of [
      ["beta", "Beta: what to know first"],
      ["privacy", "Privacy by default"],
      ["providers", "Third-party providers"],
      ["downloads", "Two download entry points"],
    ] as const) {
      expect(component, `scope-callout lost the "${variant}" title`).toContain(`title: "${title}"`);
      expect(stringify(jsx("ScopeCallout", { variant }))).toBe(`> **${title}**`);
    }
  });

  test("Tab keeps its value as a bold label above its panel", () => {
    expect(stringify(jsx("Tab", { value: "Anime" }))).toBe("**Anime**\n\nCHILDREN");
  });

  test("generated reference tables emit their real data", () => {
    expect(stringify(jsx("CliFlagsTable"))).toContain("| Flag | Description |");
    expect(stringify(jsx("CliFlagsTable"))).toContain("--search");
    expect(stringify(jsx("ShortcutTable"))).toContain("| Context | Keys | Action |");
    expect(stringify(jsx("FeatureStatusTable"))).toContain("| Capability | Status | Notes |");
    expect(stringify(jsx("CommandReference"))).toContain("| /setup |");
    expect(stringify(jsx("CommandReference"))).toContain("shell commands registered");
    expect(stringify(jsx("GlossaryFromCodegen"))).toContain("- **/setup**");
  });

  test("SyncedAt and ProviderStatusBoard stay honest about dates", () => {
    expect(stringify(jsx("SyncedAt"))).toContain("_Generated from the Kunai CLI");
    const board = stringify(jsx("ProviderStatusBoard"))!;
    expect(board).toContain("| Provider | Status | Note |");
    expect(board).toContain("videasy");
  });

  test("QuickStartSteps emits the real install commands", () => {
    const out = stringify(jsx("QuickStartSteps"))!;
    expect(out).toContain("curl -fsSL https://kunai.kitsunekode.in/install.sh | bash");
    expect(out).toContain("irm https://kunai.kitsunekode.in/install.ps1 | iex");
  });

  test("DocsHubIntro keeps its lead paragraphs", () => {
    const out = stringify(jsx("DocsHubIntro", { lead: "Learn Kunai", sublead: "start here" }))!;
    expect(out).toBe("**Learn Kunai**\n\nstart here");
  });

  test("unknown JSX falls through to the default, and ESM is dropped", () => {
    expect(stringify(jsx("SomeFutureWidget"))).toBeUndefined();
    expect(llmsMarkdownOptions.filterElement!({ type: "mdxjsEsm" } as never)).toBe(false);
    expect(
      llmsMarkdownOptions.filterElement!({ type: "mdxJsxFlowElement", name: "X" } as never),
    ).toBe("children-only");
  });
});

describe("every JSX component used in docs/ is accounted for", () => {
  const HANDLED = new Set([
    "ProviderTable",
    "DocSectionCards",
    "DocsRootCards",
    "ProviderDocSection",
    "ScopeCallout",
    "Tab",
    "CliFlagsTable",
    "ShortcutTable",
    "FeatureStatusTable",
    "CommandReference",
    "GlossaryFromCodegen",
    "SyncedAt",
    "ProviderStatusBoard",
    "QuickStartSteps",
    "DocsHubIntro",
    "ResolveGateFigure",
  ]);
  // Components that only wrap prose — children-only is the right serialization.
  const PROSE_WRAPPERS = new Set([
    "Callout",
    "Steps",
    "Step",
    "Tabs",
    "Cards",
    "Card",
    "KunaiFoxBanner",
    "Box",
    "Text",
  ]);

  test("docs/ MDX uses no component the Markdown path would silently drop", () => {
    const used = new Set<string>();
    const files = fs
      .readdirSync(DOCS_DIR, { recursive: true })
      .filter((f): f is string => typeof f === "string" && /\.(md|mdx)$/.test(f));
    for (const file of files) {
      const text = fs.readFileSync(path.join(DOCS_DIR, file), "utf8");
      // Strip fenced code so sample code is not mistaken for real JSX.
      const mdx = text.replace(/```[\s\S]*?```/g, "");
      for (const match of mdx.matchAll(/<([A-Z][A-Za-z]*)[\s/>]/g)) {
        if (match[1]) used.add(match[1]);
      }
    }
    for (const name of used) {
      const ok = HANDLED.has(name) || PROSE_WRAPPERS.has(name);
      expect(ok, `<${name}> is used in docs but llm-markdown.ts does not account for it`).toBe(
        true,
      );
    }
    expect(used.size).toBeGreaterThan(0);
  });
});
