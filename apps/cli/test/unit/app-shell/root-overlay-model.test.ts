import { describe, expect, test } from "bun:test";

import { buildRootGenericPickerOptions } from "@/app-shell/root-overlay-model";

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
});
