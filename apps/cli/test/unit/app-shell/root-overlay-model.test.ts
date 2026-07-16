import { describe, expect, test } from "bun:test";

import {
  buildRootGenericPickerOptions,
  getRootOverlaySubtitle,
  getRootOverlayTitle,
} from "@/app-shell/root-overlay-model";
import type { SessionState } from "@/domain/session/SessionState";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

describe("root overlay picker model", () => {
  test("preserves preview image URLs for root-owned media pickers", () => {
    const options = buildRootGenericPickerOptions({
      type: "episode_picker",
      season: 1,
      options: [
        {
          value: "1",
          label: "Episode 1",
          detail: "2008-01-20",
          previewImageUrl: "/still.jpg",
        },
      ],
    });

    expect(options[0]?.previewImageUrl).toBe("/still.jpg");
  });

  test("keeps episode picker title task-led and moves series context to subtitle", () => {
    const overlay = {
      type: "episode_picker" as const,
      season: 2,
      options: [
        { value: "1", label: "Episode 1", tone: "success" as const },
        { value: "2", label: "Episode 2" },
      ],
    };
    const state = {
      currentTitle: { name: "Frieren: Beyond Journey's End" },
      provider: "vidking",
    } as SessionState;

    expect(getRootOverlayTitle(overlay, state)).toBe("Choose episode");
    expect(
      getRootOverlaySubtitle({
        overlay,
        state,
        settingsDraft: null,
        config: {} as KitsuneConfig,
        settingsError: null,
      }),
    ).toBe(
      "Frieren: Beyond Journey's End  ·  S02  ·  2 eps  ·  50% complete  ·  s season  ·  m watched",
    );
  });
});
