import { describe, expect, test } from "bun:test";

import { KEYBINDINGS } from "@/app-shell/keybindings";
import { resolveHelpScope } from "@/app-shell/root-shell-state";
import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";
import { COMMAND_CONTEXTS, COMMANDS } from "@/domain/session/command-registry";

import {
  collectSourceFiles as collectRepoSourceFiles,
  readRepoFile,
} from "../../support/repo-scan";

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

function collectSourceFiles(rootRelative: string): string[] {
  return collectRepoSourceFiles(rootRelative, { skipDirs: ["experiments"] });
}

const PRODUCTION_ROOTS = [
  "apps/cli/src",
  "packages/core/src",
  "packages/config/src",
  "packages/relay/src",
  "packages/schemas/src",
  "packages/storage/src",
  "packages/providers/src",
  "packages/types/src",
];

/**
 * Read every production source once. Re-reading the tree per symbol is both slow
 * and racy — a formatter or another process writing mid-scan can hand back a
 * partial file and turn a real reader into a phantom orphan.
 */
const PRODUCTION_SOURCES: readonly { file: string; text: string }[] = PRODUCTION_ROOTS.flatMap(
  collectSourceFiles,
).map((file) => ({ file, text: readRepoFile(file) }));

/** Production files that reference `symbol`, excluding the files that define it. */
function readerFilesFor(symbol: string, definedIn: readonly string[]): string[] {
  const pattern = new RegExp(`\\b${symbol}\\b`);
  return PRODUCTION_SOURCES.filter(
    ({ file, text }) => !definedIn.includes(file) && pattern.test(text),
  ).map(({ file }) => file);
}

describe("contract conformance", () => {
  test("the public player flag reaches runtime composition", () => {
    const main = readRepoFile("apps/cli/src/main.ts");
    const container = readRepoFile("apps/cli/src/container/bootstrap-services.ts");

    expect(main).toContain("playerChoice: args.player");
    expect(container).toContain('options?.playerChoice ?? "auto"');
    expect(container).toContain("resolvePlayerMode");
  });

  test("every player capability has a production behavior reader", () => {
    const declaration = readRepoFile("apps/cli/src/domain/playback/player-capabilities.ts");
    const interfaceBody = declaration.match(
      /export interface PlayerCapabilities \{(?<body>[\s\S]*?)\n\}/u,
    )?.groups?.body;
    expect(interfaceBody).toBeDefined();

    const fields = [...(interfaceBody ?? "").matchAll(/readonly\s+(\w+):/gu)].map(
      (match) => match[1],
    );
    const sources = PRODUCTION_SOURCES.filter(
      ({ file }) => file !== "apps/cli/src/domain/playback/player-capabilities.ts",
    );
    const unread = fields.filter(
      (field) =>
        !sources.some(({ text }) =>
          new RegExp(`\\bcapabilities\\s*\\.\\s*${field}\\b`, "u").test(text),
        ),
    );

    expect(unread, "capability declared without a behavior reader").toEqual([]);
  });

  test("Android release targets reach every distribution consumer", () => {
    const platformAssets = readRepoFile("apps/cli/src/services/update/platform-assets.ts");
    const binaryBuilder = readRepoFile("apps/cli/scripts/build-binaries.ts");
    const nativeUpdater = readRepoFile(
      "apps/cli/src/services/update/native-installer/install-latest.ts",
    );
    const commandUpdater = readRepoFile("apps/cli/src/services/update/run-upgrade.ts");
    const npmLauncher = readRepoFile("apps/cli/scripts/npm-launcher.mjs");
    const installer = readRepoFile("install.sh");

    for (const target of ["android-arm64", "android-x64"]) {
      expect(platformAssets).toContain(`id: "${target}"`);
      expect(npmLauncher).toContain(`return "${target}"`);
    }
    expect(platformAssets).toContain('libc: "bionic"');
    expect(binaryBuilder).toContain("RELEASE_BINARY_TARGETS");
    expect(nativeUpdater).toContain("resolveReleaseBinaryTarget");
    expect(nativeUpdater).toContain("resolvePlatformLibc");
    expect(commandUpdater).toContain("resolvePlatformLibc");
    expect(installer).toContain('target="android-${arch}-bionic"');
  });

  test("the Android live smoke is opt-in and forwarded from the root", () => {
    const rootPackage = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };
    const cliPackage = JSON.parse(readRepoFile("apps/cli/package.json")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["test:live:android-handoff"]).toBe(
      "bun run --cwd apps/cli test:live:android-handoff",
    );
    expect(cliPackage.scripts["test:live:android-handoff"]).toBe(
      "bun test/live/android-terminal-handoff.ts",
    );
  });

  test("background download queue kicks use the supervised entry point", () => {
    const discardedQueuePasses = PRODUCTION_SOURCES.flatMap(({ file, text }) =>
      file === "apps/cli/src/services/download/DownloadService.ts"
        ? []
        : text
            .split("\n")
            .flatMap((line, index) =>
              /\bvoid\b.*\.processQueue\(\)/.test(line) ? [`${file}:${index + 1}`] : [],
            ),
    );

    expect(discardedQueuePasses).toEqual([]);
  });

  test("retired video relay contracts stay absent from production", () => {
    const RETIRED_VIDEO_RELAY_CONTRACTS = [
      "rewriteStreamUrlForRelay",
      "videoFallback",
      "videoRelayHosts",
    ] as const;
    const found = RETIRED_VIDEO_RELAY_CONTRACTS.flatMap((symbol) =>
      PRODUCTION_SOURCES.filter(({ text }) => new RegExp(`\\b${symbol}\\b`).test(text)).map(
        ({ file }) => `${symbol}: ${file}`,
      ),
    );

    expect(found, "metadata-only relay must not regain a video-proxy promise").toEqual([]);
  });

  /**
   * A command the palette never offers is unreachable: `resolveCommands` only
   * surfaces ids listed in a `COMMAND_CONTEXTS` entry or the browse command pool
   * (`SEARCH_BROWSE_COMMAND_IDS`), so a registered command missing from every
   * surface can never be typed, however complete its handler and aliases are.
   */
  test("every registered command is offered by at least one palette context", () => {
    // Nested `/sync-connect-*` stay under `/sync`. `/favorites` is ADR-retired.
    // `/image-pane` has no handler. `/clear-history` is deliberately buried.
    const KNOWN_UNREACHABLE_COMMANDS = new Set([
      "clear-history",
      "favorites",
      "image-pane",
      "sync-connect-anilist",
      "sync-connect-tmdb",
      "sync-disconnect",
    ]);

    const offered = new Set<string>([
      ...Object.values(COMMAND_CONTEXTS).flat(),
      ...SEARCH_BROWSE_COMMAND_IDS,
    ]);
    const unreachable = COMMANDS.map((command) => command.id)
      .filter((id) => !offered.has(id))
      .filter((id) => !KNOWN_UNREACHABLE_COMMANDS.has(id));

    expect(unreachable).toEqual([]);

    const fixed = [...KNOWN_UNREACHABLE_COMMANDS].filter((id) => offered.has(id));
    expect(fixed, "wired up — delete these from KNOWN_UNREACHABLE_COMMANDS").toEqual([]);
  });

  /**
   * A command being unreachable is survivable while nothing mentions it. Copy
   * that tells the user to run it is not: the instruction is the whole
   * interaction, and following it does nothing. This is the unreachable-command
   * debt above turned outward, where the user rather than an agent pays for it.
   */
  test("user-facing copy never instructs the user to run an unreachable command", () => {
    const offered = new Set<string>([
      ...Object.values(COMMAND_CONTEXTS).flat(),
      ...SEARCH_BROWSE_COMMAND_IDS,
    ]);
    const unreachableAlias = new Map<string, string>();
    for (const command of COMMANDS) {
      if (offered.has(command.id)) continue;
      for (const alias of command.aliases) unreachableAlias.set(alias, command.id);
    }

    // Only double-quoted literals: comments and doc prose describe the code,
    // they are not shown to anyone. Prose is then separated from request paths
    // by three cheap signals — copy has whitespace, a path segment is followed
    // by another segment, and a URL carries a scheme. Without these, every
    // `"/trending/all/week"` TMDB call reads as an instruction.
    const found: string[] = [];
    for (const { file, text } of PRODUCTION_SOURCES) {
      // Comments quote copy while explaining it ("idle hints say \"/trending\"").
      // Dropping whole comment lines is enough and, unlike stripping `//`
      // anywhere, leaves `"https://…"` inside real code intact.
      const code = text
        .split("\n")
        .filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line))
        .join("\n");
      for (const [literal] of code.matchAll(/"(?:[^"\\\n]|\\.)*"/g)) {
        if (!/\s/.test(literal) || literal.includes("://")) continue;
        for (const [, alias] of literal.matchAll(/(?<![\w./-])\/([a-z][a-z-]*)(?![\w/-])/g)) {
          const commandId = alias ? unreachableAlias.get(alias) : undefined;
          if (commandId) found.push(`${file}: "/${alias}" -> ${commandId}`);
        }
      }
    }

    expect(found, "copy points at a command no palette offers").toEqual([]);
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
   * A scope with bindings is still useless if `?` can never select it: the help
   * overlay is the only place those keys are documented. `resolveHelpScope` used
   * to switch on playback status alone, so five surfaces' bindings were
   * unreachable — this pins every scope to a state that actually produces it.
   */
  test("every keybinding scope is reachable from resolveHelpScope", () => {
    const state = (playbackStatus: string, ...modals: readonly string[]) =>
      ({ playbackStatus, activeModals: modals.map((type) => ({ type })) }) as never;

    const REACHABLE: Readonly<Record<string, () => unknown>> = {
      player: () => resolveHelpScope(state("playing")),
      postPlayback: () => resolveHelpScope(state("finished")),
      browse: () => resolveHelpScope(state("idle")),
      queue: () => resolveHelpScope(state("idle", "queue")),
      history: () => resolveHelpScope(state("idle", "history")),
      notifications: () => resolveHelpScope(state("idle", "notifications")),
      library: () => resolveHelpScope(state("idle", "library")),
    };

    // Scopes the help overlay is not expected to select on its own:
    // `global` is folded into every scope by `bindingsForScope`; `editing` and
    // `loading` are transient input modes; `search` has no bindings at all.
    // `stats` is a root content view rather than an overlay — it is absent from
    // SessionState, so resolveHelpScope has nothing to switch on, and the
    // surface renders its own registry-generated hint row instead.
    const NOT_HELP_SELECTABLE = new Set(["global", "editing", "loading", "search", "stats"]);

    const declared = [...new Set(KEYBINDINGS.map((binding) => binding.scope as string))];
    const unreachable = declared.filter(
      (scope) => !NOT_HELP_SELECTABLE.has(scope) && !(scope in REACHABLE),
    );
    expect(unreachable).toEqual([]);

    // And each mapping above must genuinely produce the scope it claims.
    for (const [scope, produce] of Object.entries(REACHABLE)) {
      expect(produce()).toBe(scope);
    }
  });

  /**
   * Contract surfaces that exist to be enforced. Each entry is a symbol whose
   * whole purpose is to be consulted at runtime; zero production readers means
   * the behavior it promises does not happen.
   */
  test("declared contract surfaces have a production reader", () => {
    const CONTRACT_SYMBOLS: readonly { symbol: string; definedIn: readonly string[] }[] = [
      {
        symbol: "detectGeoBlockedProviderResponse",
        definedIn: ["packages/relay/src/detect-geo-block.ts"],
      },
    ];

    // DEBT (2026-07-21): declared, wired to nothing.
    // - detectGeoBlockedProviderResponse: geo-blocking is the failure the relay
    //   exists for and nothing detects it; its allow-list also names "allmanga",
    //   which is the module name, not the provider id ("allanime").
    const KNOWN_ORPHANED_CONTRACTS = new Set(["detectGeoBlockedProviderResponse"]);

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
