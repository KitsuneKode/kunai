import { describe, expect, test } from "bun:test";

import { BrowseShell } from "@/app-shell/browse-shell";
import { MouseDispatcher, MouseDispatchProvider } from "@/app-shell/mouse/MouseRegions";
import type { BrowseShellOption } from "@/app-shell/types";

import { captureFrame } from "../../../harness/render-capture";

// Catalog labels have no declared length bound. Use plausible media titles,
// multilingual names, missing optional detail, and real catalogue-size lists.
const worst: readonly BrowseShellOption<string>[] = [
  {
    value: "long",
    label: "Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb",
    detail: "Movie · 1964",
    previewMeta: ["Movie"],
  },
  { value: "cjk", label: "劇場版 鬼滅の刃 無限城編 第一章 猗窩座再来", previewMeta: ["Anime"] },
  { value: "short", label: "Up", previewMeta: ["Movie"] },
  { value: "rtl", label: "نور الهدى عبد الرحمن", previewMeta: ["Series"] },
  {
    value: "emoji",
    label: "👩🏽‍💻 The Internet's Own Boy: The Story of Aaron Swartz",
    detail: "Documentary",
  },
  {
    value: "diacritics",
    label: "Léon: The Professional — édition intégrale",
    previewBadge: "offline ready",
  },
];
const datasets = {
  Demo: [{ value: "demo", label: "Smoke Movie", detail: "Movie" }],
  "Worst case": worst,
  Empty: [],
  One: [worst[0]!],
  "1,000 rows": Array.from({ length: 1000 }, (_, index) => ({
    value: `episode-${index}`,
    label: `One Piece — Episode ${index + 1}`,
  })),
} satisfies Record<string, readonly BrowseShellOption<string>[]>;

describe("browse pointer layout fixtures", () => {
  for (const mode of ["series", "anime"] as const) {
    for (const columns of [72, 100, 140]) {
      test.each(Object.entries(datasets))(
        `${mode} at ${columns} columns: %s`,
        async (name, options) => {
          const dispatcher = new MouseDispatcher();
          const frame = captureFrame(
            <MouseDispatchProvider dispatcher={dispatcher}>
              <BrowseShell
                mode={mode}
                provider="smoke"
                placeholder="Search title"
                initialResults={options}
                commands={[]}
                onSearch={async () => ({ options: [], subtitle: "" })}
                onResolve={() => {}}
                onSubmit={() => {}}
                onCancel={() => {}}
              />
            </MouseDispatchProvider>,
            { columns, rows: 45 },
          );
          // Opt-in review artifact only. The toggle swaps real component frames,
          // rather than a hand-built web imitation of the terminal UI.
          const captureDir = process.env.KUNAI_UX_CAPTURE_DIR;
          if (captureDir) {
            await Bun.write(
              `${captureDir}/${mode}-${columns}-${name.replaceAll(" ", "-")}.txt`,
              frame,
            );
          }
          expect(frame.split("\n").every((line) => Bun.stringWidth(line) <= columns)).toBe(true);
          expect(frame.split("\n").length).toBeLessThanOrEqual(45);
          expect(frame).toContain("[/] commands");
          if (options.length > 0) {
            expect(frame).toContain("▌");
            expect(frame).toContain("Click to select");
          }
          if (name === "1,000 rows") {
            expect(frame).toContain("▼");
            expect(frame).not.toContain("Episode 1000");
          }
        },
      );
    }
  }
});
