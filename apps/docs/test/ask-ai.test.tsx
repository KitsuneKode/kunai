import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { AskAiPanel } from "../components/search/ask-ai-panel";
import { askAiConfigFrom } from "../lib/ask-ai";

const PANEL_FILE = path.join(import.meta.dir, "../components/search/ask-ai-panel.tsx");
const DIALOG_FILE = path.join(import.meta.dir, "../components/search/kunai-search-dialog.tsx");

describe("askAiConfigFrom", () => {
  test("is off unless both endpoint and key are set", () => {
    expect(askAiConfigFrom({})).toBeNull();
    expect(askAiConfigFrom({ NEXT_PUBLIC_ASK_AI_ENDPOINT: "https://x.example" })).toBeNull();
    expect(askAiConfigFrom({ NEXT_PUBLIC_ASK_AI_PUBLIC_KEY: "key" })).toBeNull();
  });

  test("refuses a non-https endpoint — the public key would travel in clear text", () => {
    expect(
      askAiConfigFrom({
        NEXT_PUBLIC_ASK_AI_ENDPOINT: "http://x.example",
        NEXT_PUBLIC_ASK_AI_PUBLIC_KEY: "key",
      }),
    ).toBeNull();
  });

  test("returns a config that names the provider for the disclosure copy", () => {
    expect(
      askAiConfigFrom({
        NEXT_PUBLIC_ASK_AI_ENDPOINT: "https://cloud.orama.run/v1/indexes/x",
        NEXT_PUBLIC_ASK_AI_PUBLIC_KEY: "pub",
      }),
    ).toEqual({
      endpoint: "https://cloud.orama.run/v1/indexes/x",
      publicKey: "pub",
      providerLabel: "Orama",
    });
    expect(
      askAiConfigFrom({
        NEXT_PUBLIC_ASK_AI_ENDPOINT: "https://answers.example",
        NEXT_PUBLIC_ASK_AI_PUBLIC_KEY: "pub",
        NEXT_PUBLIC_ASK_AI_PROVIDER: "Inkeep",
      })?.providerLabel,
    ).toBe("Inkeep");
  });
});

describe("the third-party request boundary", () => {
  const panel = fs.readFileSync(PANEL_FILE, "utf8");
  const dialog = fs.readFileSync(DIALOG_FILE, "utf8");

  test("the Orama SDK is only ever dynamically imported — never in the page bundle", () => {
    expect(panel).not.toMatch(/import\s+(?!type)[^;]*from\s+["']@oramacloud\//);
    expect(panel).not.toMatch(/import\s*\(\s*["']@oramacloud\/client["']\s*\)\s*$/m);
    expect(panel).toContain('await import("@oramacloud/client")');
  });

  test("the AI panel is dynamic-imported, not bundled with the dialog", () => {
    expect(dialog).not.toMatch(/import\s+\{[^}]*AskAiPanel[^}]*\}\s+from/);
    expect(dialog).toContain('import("./ask-ai-panel")');
  });

  test("the SDK is constructed with telemetry and cache off", () => {
    expect(panel).toContain("telemetry: false");
    expect(panel).toContain("cache: false");
  });

  test("the panel names the provider at the point of send", () => {
    expect(panel).toContain("an external service");
    expect(panel).toContain("providerLabel");
  });
});

describe("the Ask AI surface without a config", () => {
  // The dialog itself portals and needs a DOM; the panel is the part whose
  // contract matters — unconfigured, it renders literally nothing.
  test("the panel renders nothing, not even chrome", () => {
    expect(renderToStaticMarkup(<AskAiPanel initialQuery="" onBack={() => {}} />)).toBe("");
  });
});
