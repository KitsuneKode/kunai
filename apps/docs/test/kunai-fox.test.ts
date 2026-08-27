import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const DOCS_APP_ROOT = path.resolve(import.meta.dir, "..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(DOCS_APP_ROOT, relativePath), "utf-8");
}

describe("kunai fox identity", () => {
  test("exposes idle watch go and wait as illustrated stills", () => {
    const src = readSource("components/brand/kunai-fox.tsx");
    expect(src).toContain('export const KUNAI_FOX_POSES = ["idle", "watch", "go", "wait"]');
    expect(src).toContain("/brand/fox/idle.png");
    expect(src).toContain("/brand/fox/watch.png");
    expect(src).toContain("/brand/fox/go.png");
    expect(src).toContain("/brand/fox/wait.png");
    expect(src).not.toContain("<svg");
  });

  test("home hero, flow, banner, and 404 all mount the fox", () => {
    const hero = readSource("components/home/home-hero-static.tsx");
    const shell = readSource("app/(home)/home-page-shell.tsx");
    const missing = readSource("app/not-found.tsx");
    expect(hero).toContain("KunaiFox");
    expect(hero).toContain('pose="idle"');
    expect(shell).toContain("KunaiFoxBanner");
    expect(shell).toContain("FLOW_POSES");
    expect(missing).toContain('pose="watch"');
  });

  test("nav and docs hub keep a fox mark next to the wordmark", () => {
    expect(readSource("components/layout/nav-title.tsx")).toContain("KunaiFox");
    expect(readSource("components/docs/docs-hub-intro.tsx")).toContain("KunaiFox");
  });

  test("getting started, install, and troubleshooting use pose banners", () => {
    const started = fs.readFileSync(
      path.join(DOCS_APP_ROOT, "../../docs/users/getting-started.mdx"),
      "utf-8",
    );
    const install = fs.readFileSync(
      path.join(DOCS_APP_ROOT, "../../docs/users/install-and-update.mdx"),
      "utf-8",
    );
    const troubleshooting = fs.readFileSync(
      path.join(DOCS_APP_ROOT, "../../docs/users/troubleshooting.mdx"),
      "utf-8",
    );
    expect(started).toContain('pose="go"');
    expect(install).toContain('pose="wait"');
    expect(troubleshooting).toContain('pose="watch"');
  });

  test("favicon still uses the blade mark", () => {
    expect(readSource("app/icon.tsx")).toContain("KunaiMark");
    expect(readSource("app/icon.tsx")).not.toContain("KunaiFox");
  });

  test("public stills for every pose exist on disk", () => {
    const stills = ["idle", "watch", "go", "go-left", "wait", "wait-right"];
    for (const name of stills) {
      const file = path.join(DOCS_APP_ROOT, "public/brand/fox", `${name}.png`);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.statSync(file).size).toBeGreaterThan(10_000);
    }
  });
});
