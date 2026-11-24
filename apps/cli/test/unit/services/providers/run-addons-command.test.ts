import { describe, expect, test } from "bun:test";

import { readInstalledStremioAddons } from "@/domain/provider/stremio-addons";
import {
  readAddonInputLine,
  runAddonsCommand,
  type AddonsConfigPort,
  type RunAddonsCommandOptions,
} from "@/services/providers/run-addons-command";
import { DEFAULT_CONFIG } from "@kunai/config";
import type { LooseJsonValue, ProviderRuntimeContext } from "@kunai/types";

const TOKEN = "SECRETTOKEN";
const A = `https://a.example.com/${TOKEN}/manifest.json`;
const B = "https://b.example.com/manifest.json";

const MANIFEST = {
  id: "org.example",
  name: "Example Streams",
  version: "1.2.3",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
};

function memoryConfig(initial: Partial<AddonsConfigPort> = {}) {
  const state = {
    stremioAddons: DEFAULT_CONFIG.stremioAddons,
    provider: DEFAULT_CONFIG.provider,
    providerPriority: DEFAULT_CONFIG.providerPriority,
    disabledProviders: DEFAULT_CONFIG.disabledProviders,
    titleProviderPreferences: DEFAULT_CONFIG.titleProviderPreferences,
    ...initial,
  };
  const calls = { saved: 0, flushed: 0 };
  const port: AddonsConfigPort = {
    get stremioAddons() {
      return state.stremioAddons;
    },
    get provider() {
      return state.provider;
    },
    get providerPriority() {
      return state.providerPriority;
    },
    get disabledProviders() {
      return state.disabledProviders;
    },
    get titleProviderPreferences() {
      return state.titleProviderPreferences;
    },
    update: async (partial) => {
      Object.assign(state, partial);
    },
    save: async () => {
      calls.saved += 1;
    },
    flushPending: async () => {
      calls.flushed += 1;
    },
  };
  return { state, calls, port };
}

function contextAnswering(
  respond: (url: string) => Response,
): ProviderRuntimeContext & { readonly requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    now: () => new Date().toISOString(),
    fetch: {
      runtime: "direct-http",
      fetch: async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        requested.push(url);
        return respond(url);
      },
    },
  };
}

const manifestResponse = (manifest: LooseJsonValue = MANIFEST) =>
  new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } });

async function run(
  options: Omit<RunAddonsCommandOptions, "write" | "openConfig"> & {
    readonly config: ReturnType<typeof memoryConfig>;
  },
) {
  let output = "";
  const { config, ...rest } = options;
  const code = await runAddonsCommand({
    ...rest,
    openConfig: async () => config.port,
    write: (text) => {
      output += text;
    },
  });
  return { code, output };
}

describe("kunai addons add", () => {
  test("reads the manifest, then stores the URL under the addon's own name", async () => {
    const config = memoryConfig();
    const context = contextAnswering(() => manifestResponse());

    const { code, output } = await run({ subcommand: "add", target: A, config, context });

    expect(code).toBe(0);
    expect(context.requested).toEqual([A]);
    expect(config.state.stremioAddons).toEqual([{ url: A, name: "Example Streams" }]);
    expect(config.calls).toEqual({ saved: 1, flushed: 1 });
    expect(output).toContain('Added "Example Streams" (a.example.com) for movies and series.');
    expect(output).toContain("next time Kunai opens");
    expect(output).not.toContain(TOKEN);
  });

  test("accepts the stremio:// form of the same address", async () => {
    const config = memoryConfig();

    const { code } = await run({
      subcommand: "add",
      target: "stremio://b.example.com/manifest.json",
      config,
      context: contextAnswering(() => manifestResponse()),
    });

    expect(code).toBe(0);
    expect(config.state.stremioAddons).toEqual([{ url: B, name: "Example Streams" }]);
  });

  test("a URL that is not a public https manifest is a usage error and nothing is requested", async () => {
    const config = memoryConfig();
    const context = contextAnswering(() => manifestResponse());

    const { code, output } = await run({
      subcommand: "add",
      target: "http://a.example.com/manifest.json",
      config,
      context,
    });

    expect(code).toBe(2);
    expect(output).toContain("https://");
    expect(context.requested).toEqual([]);
    expect(config.state.stremioAddons).toEqual([]);
  });

  test("an address that does not answer with a manifest adds nothing", async () => {
    const config = memoryConfig();

    const { code, output } = await run({
      subcommand: "add",
      target: A,
      config,
      context: contextAnswering(() => new Response("<html></html>")),
    });

    expect(code).toBe(1);
    expect(output).toContain("Nothing was added");
    expect(output).not.toContain(TOKEN);
    expect(config.state.stremioAddons).toEqual([]);
    expect(config.calls.saved).toBe(0);
  });

  test.each([
    [{ ...MANIFEST, resources: ["catalog"] }, "does not provide streams"],
    [{ ...MANIFEST, idPrefixes: ["kitsu:"] }, "does not accept IMDb ids"],
    [{ ...MANIFEST, behaviorHints: { configurationRequired: true } }, "must be configured"],
  ])("an addon Kunai could never get a stream from is refused", async (manifest, reason) => {
    const config = memoryConfig();

    const { code, output } = await run({
      subcommand: "add",
      target: A,
      config,
      context: contextAnswering(() => manifestResponse(manifest)),
    });

    expect(code).toBe(1);
    expect(output).toContain(reason);
    expect(config.state.stremioAddons).toEqual([]);
  });

  test("adding an installed addon again says so and keeps one entry", async () => {
    const config = memoryConfig({ stremioAddons: [{ url: A, name: "Example Streams" }] });

    const { code, output } = await run({
      subcommand: "add",
      target: A,
      config,
      context: contextAnswering(() => manifestResponse()),
    });

    expect(code).toBe(0);
    expect(output).toContain("already installed");
    expect(config.state.stremioAddons).toHaveLength(1);
  });

  test("a missing URL is a usage error", async () => {
    const { code } = await run({ subcommand: "add", config: memoryConfig() });

    expect(code).toBe(2);
  });

  test("an addon that echoes the URL's token in its manifest never leaks it", async () => {
    const leaky = {
      ...MANIFEST,
      name: `Streams ${TOKEN}`,
      version: `2.0-${TOKEN}`,
      types: ["movie", `meta-${TOKEN}`],
      resources: ["stream", `catalog-${TOKEN}`],
    };
    const config = memoryConfig();
    const context = contextAnswering(() => manifestResponse(leaky));

    const add = await run({ subcommand: "add", target: A, config, context });
    const list = await run({ subcommand: "list", json: true, config });
    const check = await run({ subcommand: "check", json: true, config, context });

    const everything = add.output + list.output + check.output;
    expect(everything).not.toContain(TOKEN);
    // The config keeps the full URL — it is the secret. Only stored display
    // text is held to the same bar as terminal output.
    const stored = JSON.stringify(config.state.stremioAddons?.[0]?.name ?? "");
    expect(stored).not.toContain(TOKEN);
    expect(add.code).toBe(0);
    // Public, non-secret parts still come through.
    expect(everything).toContain("a.example.com");
    expect(everything).toContain("movie");
  });

  test("add --stdin reads the manifest URL from the input reader, not argv", async () => {
    const config = memoryConfig();
    let reads = 0;

    const { code } = await run({
      subcommand: "add",
      stdin: true,
      config,
      context: contextAnswering(() => manifestResponse()),
      readInput: async () => {
        reads += 1;
        return `${A}\n`;
      },
    });

    expect(reads).toBe(1);
    expect(code).toBe(0);
    expect(config.state.stremioAddons).toEqual([{ url: A, name: "Example Streams" }]);
  });

  test("the stdin reader takes the first line across chunk boundaries", async () => {
    async function* chunks() {
      yield Buffer.from("https://addon.example.com/to");
      yield Buffer.from("ken/manifest.json\nignored trailing bytes");
      yield Buffer.from("never read");
    }

    await expect(readAddonInputLine(chunks())).resolves.toBe(
      "https://addon.example.com/token/manifest.json",
    );
  });

  test("the stdin reader refuses an overlong line instead of truncating it", async () => {
    async function* chunks() {
      yield Buffer.alloc(5000, "a");
    }

    await expect(readAddonInputLine(chunks())).rejects.toThrow("exceeded byte limit");
  });

  test("add --stdin with a positional target fails without reading or asking the addon", async () => {
    const config = memoryConfig();
    const context = contextAnswering(() => manifestResponse());
    let reads = 0;

    const { code, output } = await run({
      subcommand: "add",
      stdin: true,
      target: A,
      config,
      context,
      readInput: async () => {
        reads += 1;
        return B;
      },
    });

    expect(code).toBe(2);
    expect(output).toContain("either --stdin or a manifest URL");
    expect(reads).toBe(0);
    expect(context.requested).toEqual([]);
    expect(config.state.stremioAddons).toEqual([]);
  });

  test("--stdin is rejected for commands that take no input", async () => {
    for (const subcommand of ["list", "remove", "check"]) {
      let reads = 0;
      const { code } = await run({
        subcommand,
        stdin: true,
        config: memoryConfig(),
        readInput: async () => {
          reads += 1;
          return A;
        },
      });
      expect(code).toBe(2);
      expect(reads).toBe(0);
    }
  });
});

describe("kunai addons list", () => {
  test("lists number, name, host and id, and never the URL", async () => {
    const config = memoryConfig({ stremioAddons: [{ url: A, name: "Alpha" }, { url: B }] });

    const text = await run({ config });
    const json = await run({ subcommand: "list", json: true, config });
    const payload = JSON.parse(json.output);

    expect(text.code).toBe(0);
    expect(text.output).toContain("1. Alpha  a.example.com");
    expect(text.output).toContain("2. b.example.com  b.example.com");
    expect(payload).toMatchObject({
      ok: true,
      schemaVersion: 1,
      error: null,
      addons: [
        { number: 1, name: "Alpha", host: "a.example.com" },
        { number: 2, name: "b.example.com", host: "b.example.com" },
      ],
    });
    expect(text.output + json.output).not.toContain(TOKEN);
  });

  test("an empty list says how to add one", async () => {
    const { code, output } = await run({ config: memoryConfig() });

    expect(code).toBe(0);
    expect(output).toContain("kunai addons add <manifest-url>");
  });
});

describe("kunai addons remove", () => {
  test("removes by number and clears the settings that named the addon", async () => {
    const [alpha] = readInstalledStremioAddons([{ url: A }]);
    const alphaId = alpha?.providerId ?? "";
    const config = memoryConfig({
      stremioAddons: [{ url: A, name: "Alpha" }, { url: B }],
      provider: alphaId,
      providerPriority: [alphaId, "vidlink"],
      disabledProviders: [alphaId],
    });

    const { code, output } = await run({ subcommand: "remove", target: "1", config });
    const jsonConfig = memoryConfig({ stremioAddons: [{ url: A, name: "Alpha" }, { url: B }] });
    const json = await run({ subcommand: "remove", target: "1", json: true, config: jsonConfig });
    const jsonPayload = JSON.parse(json.output);

    expect(code).toBe(0);
    expect(output).toContain('Removed "Alpha" (a.example.com)');
    expect(output).toContain("after restart");
    expect(jsonPayload.appliesAfterRestart).toBe(true);
    expect(jsonPayload.removed.name).toBe("Alpha");
    expect(config.state.stremioAddons).toEqual([{ url: B }]);
    expect(config.state.provider).toBe("vidlink");
    expect(config.state.providerPriority).toEqual(["vidlink"]);
    expect(config.state.disabledProviders).toEqual([]);
    expect(config.calls).toEqual({ saved: 1, flushed: 1 });
  });

  test("an unknown target changes nothing", async () => {
    const config = memoryConfig({ stremioAddons: [{ url: B }] });

    const missing = await run({ subcommand: "remove", target: "5", config });
    const unnamed = await run({ subcommand: "remove", config });

    expect(missing.code).toBe(1);
    expect(unnamed.code).toBe(2);
    expect(config.state.stremioAddons).toEqual([{ url: B }]);
    expect(config.calls.saved).toBe(0);
  });
});

describe("kunai addons check", () => {
  test("reports each addon and fails when one cannot be used", async () => {
    const config = memoryConfig({ stremioAddons: [{ url: A, name: "Alpha" }, { url: B }] });
    const context = contextAnswering((url) =>
      url === A ? manifestResponse() : new Response("gone", { status: 503 }),
    );

    const { code, output } = await run({ subcommand: "check", json: true, config, context });
    const payload = JSON.parse(output);

    expect(code).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.addons[0]).toMatchObject({
      name: "Alpha",
      reachable: true,
      usable: true,
      movie: true,
      series: true,
      version: "1.2.3",
      problem: null,
    });
    expect(payload.addons[1]).toMatchObject({ reachable: false, usable: false });
    expect(payload.addons[1].problem).toContain("HTTP 503");
    expect(output).not.toContain(TOKEN);
  });

  test("checks one addon when a target is given, and writes nothing", async () => {
    const config = memoryConfig({ stremioAddons: [{ url: A }, { url: B }] });
    const context = contextAnswering(() => manifestResponse());

    const { code, output } = await run({ subcommand: "check", target: "2", config, context });

    expect(code).toBe(0);
    expect(context.requested).toEqual([B]);
    expect(output).toContain("ok — movies and series, v1.2.3");
    expect(config.calls.saved).toBe(0);
  });
});

test("an unknown action is a usage error", async () => {
  const { code, output } = await run({ subcommand: "install", config: memoryConfig() });

  expect(code).toBe(2);
  expect(output).toContain("list, add, remove, check");
});
