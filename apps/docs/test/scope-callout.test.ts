import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const DOCS_APP_ROOT = path.resolve(import.meta.dir, "..");

describe("docs scope callouts", () => {
  test("ScopeCallout supports custom title and body overrides", () => {
    const source = fs.readFileSync(
      path.join(DOCS_APP_ROOT, "components/docs/scope-callout.tsx"),
      "utf-8",
    );
    expect(source).toContain("title ?? entry.title");
    expect(source).toContain("children ?? entry.body");
  });

  test("beta callout mentions binary install path", () => {
    const source = fs.readFileSync(
      path.join(DOCS_APP_ROOT, "components/docs/scope-callout.tsx"),
      "utf-8",
    );
    expect(source).toContain("install.sh");
    expect(source).toContain("install.ps1");
  });

  test("share-links uses protocol handler override", () => {
    const shareLinks = fs.readFileSync(
      path.resolve(DOCS_APP_ROOT, "../../docs/users/share-links.mdx"),
      "utf-8",
    );
    expect(shareLinks).toContain('title="Protocol handler is optional"');
    expect(shareLinks).toContain("kunai --install-protocol-handler");
  });
});
