import { describe, expect, it } from "bun:test";

import { buildPostPlayView } from "@/app-shell/post-play-view";

describe("buildDiscovery posters", () => {
  it("resolves a TMDB posterUrl from posterPath", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E01",
      postPlayState: { kind: "mid-series" },
      recommendations: [
        { id: "r1", title: "Frieren", type: "series", posterPath: "/abc.jpg", year: "2023" },
      ],
    });
    expect(view.discovery[0]?.posterUrl).toBe("https://image.tmdb.org/t/p/w185/abc.jpg");
  });

  it("leaves posterUrl undefined when posterPath absent", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E01",
      postPlayState: { kind: "mid-series" },
      recommendations: [{ id: "r1", title: "Frieren", type: "series", year: "2023" }],
    });
    expect(view.discovery[0]?.posterUrl).toBeUndefined();
  });
});
