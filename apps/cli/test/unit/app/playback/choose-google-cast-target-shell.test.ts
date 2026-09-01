import { describe, expect, test } from "bun:test";

import { chooseGoogleCastTargetShell } from "@/app-shell/cast-target-picker";
import type { GoogleCastPlaybackTarget } from "@/domain/playback/playback-target";

const tv: GoogleCastPlaybackTarget = {
  kind: "google-cast",
  id: "tv-1",
  name: "Living Room TV",
  host: "192.168.1.50",
  port: 8009,
  modelName: "Google TV",
  capabilities: ["audio", "video"],
};

describe("chooseGoogleCastTargetShell", () => {
  test("returns a discovered receiver selected in the Kunai picker", async () => {
    const selected = await chooseGoogleCastTargetShell({
      discover: async () => [tv],
      choose: async (options) =>
        options.find((option) => option.label === "Living Room TV · Video + audio")!.value,
      enterAddress: async () => null,
    });

    expect(selected).toEqual(tv);
  });

  test("offers local video with remote Cast audio as an explicit experimental route", async () => {
    const selected = await chooseGoogleCastTargetShell({
      discover: async () => [tv],
      choose: async (options) =>
        options.find((option) => option.label === "Living Room TV · Audio only")!.value,
      enterAddress: async () => null,
    });

    expect(selected).toMatchObject({
      kind: "split-audio",
      audioTarget: { name: "Living Room TV", host: "192.168.1.50" },
    });
  });

  test("refreshes discovery and supports manual addressing", async () => {
    let searches = 0;
    let picks = 0;
    const selected = await chooseGoogleCastTargetShell({
      discover: async () => {
        searches += 1;
        return [];
      },
      choose: async (options) => {
        const label = picks++ === 0 ? "Refresh devices" : "Enter device address…";
        return options.find((option) => option.label === label)!.value;
      },
      enterAddress: async () => "192.168.1.50",
    });

    expect(searches).toBe(2);
    expect(selected).toMatchObject({ kind: "google-cast", host: "192.168.1.50", port: 8009 });
  });

  test("keeps local mpv available as the reverse path", async () => {
    const selected = await chooseGoogleCastTargetShell({
      discover: async () => [],
      choose: async (options) => options[0]!.value,
      enterAddress: async () => null,
    });

    expect(selected).toMatchObject({ kind: "local", id: "local" });
  });
});
