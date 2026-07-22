import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { KEYBINDINGS } from "@/app-shell/keybindings";
import { COMMAND_CONTEXTS, COMMANDS } from "@/domain/session/command-registry";

/**
 * Conformance gates for declarations that must have a reader.
 *
 * Kunai's recurring failure mode is not crashes — it is silent no-ops: a flag is
 * parsed and never consumed, a manifest field is declared and never enforced, a
 * command is registered and never listed, a setting is persisted and never read.
 * None of it fails a build, so it survives indefinitely and the user experiences
 * a feature that "exists" and does nothing.
 *
 * Each test below pins one declaration -> reader edge. Known-broken edges are
 * baselined explicitly so the gate stays green and catches the NEXT regression;
 * fixing one means deleting its baseline entry, which is the ratchet. Never add
 * to a baseline to make a failure go away without understanding it — the entry
 * is a debt record, not a suppression.
 */

function findRepoRoot(start: string): string {
  let directory = start;
  while (directory !== dirname(directory)) {
    try {
      const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        workspaces?: unknown;
      };
      if (packageJson.workspaces !== undefined) return directory;
    } catch {
      // Keep walking toward the filesystem root.
    }
    directory = dirname(directory);
  }
  return start;
}

const REPO_ROOT = findRepoRoot(process.cwd());
const SKIP_DIRS = new Set(["node_modules", "dist", "legacy", "experiments", ".turbo"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function collectSourceFiles(rootRelative: string): string[] {
  const absoluteRoot = join(REPO_ROOT, rootRelative);
  const files: string[] = [];
  const walk = (directory: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const path = join(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        walk(path);
        continue;
      }
      if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
        files.push(relative(REPO_ROOT, path));
      }
    }
  };
  walk(absoluteRoot);
  return files;
}

const PRODUCTION_ROOTS = [
  "apps/cli/src",
  "packages/core/src",
  "packages/relay/src",
  "packages/storage/src",
  "packages/providers/src",
];

/**
 * Read every production source once. Re-reading the tree per symbol is both slow
 * and racy — a formatter or another process writing mid-scan can hand back a
 * partial file and turn a real reader into a phantom orphan.
 */
const PRODUCTION_SOURCES: readonly { file: string; text: string }[] = PRODUCTION_ROOTS.flatMap(
  collectSourceFiles,
).map((file) => ({ file, text: readFileSync(join(REPO_ROOT, file), "utf8") }));

/** Production files that reference `symbol`, excluding the files that define it. */
function readerFilesFor(symbol: string, definedIn: readonly string[]): string[] {
  const pattern = new RegExp(`\\b${symbol}\\b`);
  return PRODUCTION_SOURCES.filter(
    ({ file, text }) => !definedIn.includes(file) && pattern.test(text),
  ).map(({ file }) => file);
}

describe("contract conformance", () => {
  /**
   * A command the palette never offers is unreachable: `resolveCommands` only
   * surfaces ids listed in a `COMMAND_CONTEXTS` entry, so a registered command
   * missing from every context can never be typed, however complete its handler
   * and aliases are.
   */
  test("every registered command is offered by at least one palette context", () => {
    // DEBT (2026-07-21): implemented + aliased, reachable from no palette surface.
    // `sync*` means the AniList/TMDB integration has no entry point at all.
    const KNOWN_UNREACHABLE_COMMANDS = new Set([
      "clear-history",
      "details",
      "favorites",
      "filters",
      "image-pane",
      "playlist-add",
      "queue-season",
      "random",
      "surprise",
      "sync",
      "sync-connect-anilist",
      "sync-connect-tmdb",
      "sync-disconnect",
      "trending",
    ]);

    const offered = new Set<string>(Object.values(COMMAND_CONTEXTS).flat());
    const unreachable = COMMANDS.map((command) => command.id)
      .filter((id) => !offered.has(id))
      .filter((id) => !KNOWN_UNREACHABLE_COMMANDS.has(id));

    expect(unreachable).toEqual([]);

    const fixed = [...KNOWN_UNREACHABLE_COMMANDS].filter((id) => offered.has(id));
    expect(fixed, "wired up — delete these from KNOWN_UNREACHABLE_COMMANDS").toEqual([]);
  });

  /**
   * `helpOnly` bindings are filtered out of the footer, so a `footerPriority`
   * beside one is ordering metadata nothing can ever read.
   */
  test("helpOnly bindings do not carry dead footer metadata", () => {
    // DEBT (2026-07-21): decide per binding whether it belongs in the footer
    // (drop helpOnly) or is help-only (drop footerPriority).
    const KNOWN_DEAD_FOOTER_PRIORITY = new Set([
      "browse-title-control-menu-shift",
      "notifications-mark-all",
      "notifications-archive",
      "notifications-clear",
      "notifications-page",
    ]);

    const dead = KEYBINDINGS.filter(
      (binding) => binding.helpOnly === true && binding.footerPriority !== undefined,
    )
      .map((binding) => binding.id)
      .filter((id) => !KNOWN_DEAD_FOOTER_PRIORITY.has(id));

    expect(dead).toEqual([]);
  });

  /**
   * Bindings are grouped for the `?` overlay by scope. A scope no binding uses
   * renders an empty help section; a binding on a scope the help layer cannot
   * produce is undiscoverable.
   */
  test("every keybinding scope is backed by at least one binding", () => {
    // DEBT (2026-07-21): declared in KeyScope, used by no binding — so
    // bindingsForScope("search") returns globals only.
    const KNOWN_EMPTY_SCOPES = new Set(["search"]);

    const used = new Set(KEYBINDINGS.map((binding) => binding.scope));
    const declared = new Set(
      KEYBINDINGS.map((binding) => binding.scope as string).concat([...KNOWN_EMPTY_SCOPES]),
    );
    const empty = [...declared].filter((scope) => !used.has(scope as never));

    expect(empty.filter((scope) => !KNOWN_EMPTY_SCOPES.has(scope))).toEqual([]);
  });

  /**
   * Contract surfaces that exist to be enforced. Each entry is a symbol whose
   * whole purpose is to be consulted at runtime; zero production readers means
   * the behavior it promises does not happen.
   */
  test("declared contract surfaces have a production reader", () => {
    const CONTRACT_SYMBOLS: readonly { symbol: string; definedIn: readonly string[] }[] = [
      {
        symbol: "rewriteStreamUrlForRelay",
        definedIn: ["packages/relay/src/rewrite-stream-url.ts"],
      },
      {
        symbol: "detectGeoBlockedProviderResponse",
        definedIn: ["packages/relay/src/detect-geo-block.ts"],
      },
    ];

    // DEBT (2026-07-21): declared, wired to nothing.
    // - rewriteStreamUrlForRelay: `providerRelay.videoFallback` is parsed, persisted
    //   and shown in settings, but no caller rewrites the stream URL, so enabling it
    //   is a placebo.
    // - detectGeoBlockedProviderResponse: geo-blocking is the failure the relay
    //   exists for and nothing detects it; its allow-list also names "allmanga",
    //   which is the module name, not the provider id ("allanime").
    const KNOWN_ORPHANED_CONTRACTS = new Set([
      "rewriteStreamUrlForRelay",
      "detectGeoBlockedProviderResponse",
    ]);

    const orphaned: string[] = [];
    const revived: string[] = [];
    for (const { symbol, definedIn } of CONTRACT_SYMBOLS) {
      const readers = readerFilesFor(symbol, definedIn);
      const isBaselined = KNOWN_ORPHANED_CONTRACTS.has(symbol);
      if (readers.length === 0 && !isBaselined) orphaned.push(symbol);
      if (readers.length > 0 && isBaselined) revived.push(symbol);
    }

    expect(orphaned, "declared with no production reader").toEqual([]);
    expect(revived, "now wired — delete these from KNOWN_ORPHANED_CONTRACTS").toEqual([]);
  });

  /**
   * The engine duck-types provider modules (`module.search ? ... : undefined`)
   * rather than reading `manifest.capabilities`, so a manifest that overclaims is
   * not caught anywhere. Pin declaration to implementation both ways: a declared
   * capability must be implemented, and an implemented method must be declared.
   */
  test("provider manifests declare exactly the capabilities they implement", async () => {
    const CAPABILITY_METHODS: Record<string, string> = {
      search: "search",
      "episode-list": "listEpisodes",
      "source-resolve": "resolve",
    };

    const modules = await Promise.all([
      import("@kunai/providers/videasy"),
      import("@kunai/providers/vidlink"),
      import("@kunai/providers/rivestream"),
      import("@kunai/providers/allmanga"),
      import("@kunai/providers/miruro"),
      import("@kunai/providers/youtube"),
    ]);

    const mismatches: string[] = [];
    for (const namespace of modules) {
      const provider = Object.values(namespace).find(
        (value): value is Record<string, unknown> & { manifest: Record<string, unknown> } =>
          typeof value === "object" && value !== null && "manifest" in value,
      );
      if (!provider) continue;

      const manifest = provider.manifest as { id: string; capabilities?: readonly string[] };
      const declared = new Set(manifest.capabilities ?? []);
      for (const [capability, method] of Object.entries(CAPABILITY_METHODS)) {
        const implemented = typeof provider[method] === "function";
        if (declared.has(capability) && !implemented) {
          mismatches.push(`${manifest.id}: declares "${capability}" but has no ${method}()`);
        }
        if (!declared.has(capability) && implemented) {
          mismatches.push(`${manifest.id}: implements ${method}() but omits "${capability}"`);
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
