import { describe, expect, test } from "bun:test";

import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG, type KitsuneConfig } from "@/services/persistence/ConfigStore";

const A = "https://a.example.com/token/manifest.json";
const B = "https://b.example.com/manifest.json";

function memoryStore(initial: Record<string, unknown>) {
  const state: { disk: Record<string, unknown> } = { disk: { ...DEFAULT_CONFIG, ...initial } };
  return {
    state,
    store: {
      load: async () => ({ ...state.disk }) as Partial<KitsuneConfig>,
      save: async (value: KitsuneConfig) => {
        state.disk = { ...value };
      },
      reset: async () => {},
    },
  };
}

async function saved(config: ConfigServiceImpl): Promise<void> {
  const pending = config.save();
  await config.flushPending();
  await pending;
}

describe("stremioAddons in config", () => {
  test("a config saved before addons existed has none", async () => {
    const { stremioAddons: _absent, ...older } = DEFAULT_CONFIG;
    const { store } = memoryStore({});
    store.load = async () => ({ ...older });

    const config = await ConfigServiceImpl.load(store);

    expect(config.stremioAddons).toEqual([]);
  });

  test("hand-edited entries are re-read through the URL rules on load", async () => {
    const { store } = memoryStore({
      stremioAddons: [
        { url: A, name: "Alpha" },
        { url: "http://plain.example.com/manifest.json" },
        { url: "https://10.0.0.4/manifest.json" },
        "not a url",
        { url: A },
        B,
      ],
    });

    const config = await ConfigServiceImpl.load(store);

    expect(config.stremioAddons).toEqual([{ url: A, name: "Alpha" }, { url: B }]);
  });

  test("a value of the wrong shape cannot break startup", async () => {
    const { store } = memoryStore({ stremioAddons: { url: A } });

    const config = await ConfigServiceImpl.load(store);

    expect(config.stremioAddons).toEqual([]);
  });

  test("an update is normalized and reaches disk", async () => {
    const { state, store } = memoryStore({});
    const config = await ConfigServiceImpl.load(store);

    await config.update({
      stremioAddons: [{ url: ` ${A} ` }, { url: "https://localhost/manifest.json" }],
    });
    await saved(config);

    expect(config.stremioAddons).toEqual([{ url: A }]);
    expect(state.disk.stremioAddons).toEqual([{ url: A }]);
  });

  test("the getter hands out a copy, so a caller cannot edit the stored list", async () => {
    const { store } = memoryStore({ stremioAddons: [{ url: A }] });
    const config = await ConfigServiceImpl.load(store);

    (config.stremioAddons as { url: string }[]).pop();

    expect(config.stremioAddons).toEqual([{ url: A }]);
  });
});
