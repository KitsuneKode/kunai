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
    // SAFETY: partial SessionState fixture — the subtitle builder reads only
    // the fields set here; the rest is irrelevant to this render.
    const state = {
      currentTitle: { name: "Frieren: Beyond Journey's End" },
      provider: "vidking",
    } as SessionState;

    expect(getRootOverlayTitle(overlay, state)).toBe("Choose episode");
    // Text zone (default): printable keys type into the filter, so the
    // subtitle must not advertise s/m list actions.
    expect(
      getRootOverlaySubtitle({
        overlay,
        state,
        settingsDraft: null,
        // SAFETY: subtitle rendering reads no config fields — the empty literal
        // only satisfies the parameter type.
        config: {} as KitsuneConfig,
        settingsError: null,
      }),
    ).toBe(
      "Frieren: Beyond Journey's End  ·  S02  ·  2 eps  ·  50% complete  ·  type to filter  ·  ↓ for actions",
    );
    // List zone: s/m are live and Esc unwinds back to the filter.
    expect(
      getRootOverlaySubtitle({
        overlay,
        state,
        settingsDraft: null,
        // SAFETY: subtitle rendering reads no config fields — the empty literal
        // only satisfies the parameter type.
        config: {} as KitsuneConfig,
        settingsError: null,
        episodePickerListFocused: true,
      }),
    ).toBe(
      "Frieren: Beyond Journey's End  ·  S02  ·  2 eps  ·  50% complete  ·  s season  ·  m watched  ·  Esc to filter",
    );
  });

  test("list picker carries its own title and subtitle instead of episode chrome", () => {
    const overlay = {
      type: "list_picker" as const,
      title: "Clean up watched downloads",
      subtitle: "2 eligible · about 2.0 GiB recoverable",
      options: [{ value: "cleanup:all", label: "Clean up all", tone: "error" as const }],
    };
    // SAFETY: partial SessionState fixture — list-picker strings come from the
    // overlay itself; no state fields are read.
    const state = {} as SessionState;

    expect(getRootOverlayTitle(overlay, state)).toBe("Clean up watched downloads");
    expect(
      getRootOverlaySubtitle({
        overlay,
        state,
        settingsDraft: null,
        // SAFETY: subtitle rendering reads no config fields — the empty literal
        // only satisfies the parameter type.
        config: {} as KitsuneConfig,
        settingsError: null,
      }),
    ).toBe("2 eligible · about 2.0 GiB recoverable");
    // List-picker rows are generic — they must not synthesize preview art.
    const options = buildRootGenericPickerOptions(overlay);
    expect(options[0]?.previewImageUrl).toBeUndefined();
  });
});
