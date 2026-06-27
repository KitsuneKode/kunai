import { describe, expect, test } from "bun:test";

import {
  buildMediaPanel,
  formatDurationClock,
  formatEpisodeCardLabel,
  formatRelativeTime,
  formatRuntimeMinutes,
  formatViewCount,
  parseEpisodeNumber,
  parseEpisodeRef,
  type MediaPanelContext,
} from "@/app-shell/media-panel-model";
import type { TitleDetail } from "@/domain/catalog/title-detail";

// ── Humanizers ───────────────────────────────────────────────────────────────

describe("formatViewCount", () => {
  test("scales thousands/millions/billions and trims trailing zeros", () => {
    expect(formatViewCount(0)).toBe("0 views");
    expect(formatViewCount(999)).toBe("999 views");
    expect(formatViewCount(1_000)).toBe("1K views");
    expect(formatViewCount(1_200)).toBe("1.2K views");
    expect(formatViewCount(1_250_000)).toBe("1.3M views");
    expect(formatViewCount(2_000_000_000)).toBe("2B views");
  });

  test("rejects undefined / negative / non-finite", () => {
    expect(formatViewCount(undefined)).toBeUndefined();
    expect(formatViewCount(-5)).toBeUndefined();
    expect(formatViewCount(Number.NaN)).toBeUndefined();
  });
});

describe("formatRelativeTime", () => {
  test("buckets recent timestamps into human spans", () => {
    const now = Date.now();
    expect(formatRelativeTime(new Date(now).toISOString())).toBe("today");
    expect(formatRelativeTime(new Date(now - 86_400_000).toISOString())).toBe("yesterday");
    expect(formatRelativeTime(new Date(now - 3 * 86_400_000).toISOString())).toBe("3 days ago");
    expect(formatRelativeTime(new Date(now - 14 * 86_400_000).toISOString())).toBe("2 weeks ago");
    expect(formatRelativeTime(new Date(now - 60 * 86_400_000).toISOString())).toBe("2 months ago");
    expect(formatRelativeTime(new Date(now - 800 * 86_400_000).toISOString())).toBe("2 years ago");
  });

  test("rejects empty / unparseable / future timestamps", () => {
    expect(formatRelativeTime(undefined)).toBeUndefined();
    expect(formatRelativeTime("not-a-date")).toBeUndefined();
    expect(formatRelativeTime(new Date(Date.now() + 86_400_000).toISOString())).toBeUndefined();
  });
});

describe("formatDurationClock", () => {
  test("renders m:ss and h:mm:ss", () => {
    expect(formatDurationClock(45)).toBe("0:45");
    expect(formatDurationClock(125)).toBe("2:05");
    expect(formatDurationClock(3_661)).toBe("1:01:01");
  });

  test("rejects non-positive / non-finite", () => {
    expect(formatDurationClock(0)).toBeUndefined();
    expect(formatDurationClock(undefined)).toBeUndefined();
    expect(formatDurationClock(Number.NaN)).toBeUndefined();
  });
});

describe("formatRuntimeMinutes", () => {
  test("renders compact runtimes", () => {
    expect(formatRuntimeMinutes(24)).toBe("24m");
    expect(formatRuntimeMinutes(60)).toBe("1h");
    expect(formatRuntimeMinutes(95)).toBe("1h 35m");
  });

  test("rejects non-positive", () => {
    expect(formatRuntimeMinutes(0)).toBeUndefined();
    expect(formatRuntimeMinutes(undefined)).toBeUndefined();
  });
});

describe("formatEpisodeCardLabel", () => {
  test("collapses SxxExx — Title to Exx · Title", () => {
    expect(formatEpisodeCardLabel("S01 E12 — Inversion")).toBe("E12 · Inversion");
    expect(formatEpisodeCardLabel("S01E06 - Challengers")).toBe("E06 · Challengers");
  });

  test("collapses placeholder episode names to the tag", () => {
    expect(formatEpisodeCardLabel("S02 E03 — Episode 3")).toBe("E03");
  });

  test("passes through non-episodic labels and rejects empty", () => {
    expect(formatEpisodeCardLabel("Some Movie")).toBe("Some Movie");
    expect(formatEpisodeCardLabel("   ")).toBeUndefined();
    expect(formatEpisodeCardLabel(undefined)).toBeUndefined();
  });
});

describe("parseEpisodeRef / parseEpisodeNumber", () => {
  test("parses season + episode, episode-only, and bare tags", () => {
    expect(parseEpisodeRef("S02 E11 — Title")).toEqual({ season: 2, episode: 11 });
    expect(parseEpisodeRef("s1e5")).toEqual({ season: 1, episode: 5 });
    expect(parseEpisodeRef("E07")).toEqual({ episode: 7 });
    expect(parseEpisodeRef("untitled")).toEqual({});
    expect(parseEpisodeRef(undefined)).toEqual({});
  });

  test("parseEpisodeNumber returns just the episode", () => {
    expect(parseEpisodeNumber("S02 E11 — Title")).toBe(11);
    expect(parseEpisodeNumber("nope")).toBeUndefined();
  });
});

// ── Per-kind builders via buildMediaPanel ─────────────────────────────────────

const seriesDetail: TitleDetail = {
  id: "t1",
  type: "series",
  title: "The Apothecary Diaries",
  year: "2024",
  synopsis: "Maomao, an apothecary, is sold into the imperial palace.",
  genres: ["Drama", "Mystery"],
  studios: ["OLM"],
  score: 8.6,
  episodeCount: 24,
  status: "airing",
  runtimeMinutes: 24,
  artwork: {
    poster: "https://img/poster.jpg",
    seasonPosters: { 1: "https://img/s1.jpg" },
    episodeThumbnails: { "1.12": "https://img/s1e12.jpg", "1.10": "https://img/s1e10.jpg" },
  },
};

function ctx(overrides: Partial<MediaPanelContext>): MediaPanelContext {
  return {
    surface: "playing",
    contentKind: "series",
    title: "The Apothecary Diaries",
    ...overrides,
  };
}

describe("buildMediaPanel — series/anime", () => {
  test("anime kind badges as anime and surfaces aligned facts", () => {
    const model = buildMediaPanel(
      ctx({
        contentKind: "anime",
        titleDetail: seriesDetail,
        currentSeason: 1,
        currentEpisode: 11,
      }),
    );
    expect(model.kind).toBe("anime");
    expect(model.kindBadge).toBe("anime");
    expect(model.secondary).toBe("S01E11 · airing");
    expect(model.facts).toEqual([
      { label: "year", value: "2024" },
      { label: "genre", value: "Drama" },
      { label: "score", value: "★ 8.6" },
      { label: "episodes", value: "24" },
      { label: "studio", value: "OLM" },
    ]);
    expect(model.synopsis).toBe(seriesDetail.synopsis);
  });

  test("up-next card resolves the next-episode still and humanized meta", () => {
    const model = buildMediaPanel(
      ctx({
        titleDetail: seriesDetail,
        currentSeason: 1,
        currentEpisode: 11,
        nextEpisodeLabel: "S01 E12 — Inversion",
      }),
    );
    const next = model.miniCards.find((card) => card.kind === "next");
    expect(next?.section).toBe("up next");
    expect(next?.label).toBe("E12 · Inversion");
    expect(next?.thumbUrl).toBe("https://img/s1e12.jpg");
    expect(next?.meta).toContain("autoplay");
  });

  test("post-play rail shows prev + up next but NOT resume (hero owns resume)", () => {
    const model = buildMediaPanel(
      ctx({
        surface: "post-play",
        titleDetail: seriesDetail,
        currentSeason: 1,
        currentEpisode: 11,
        resumeLabel: "resume S01E11 · 6:29",
        previousEpisodeLabel: "S01 E10 — Verdigris",
        nextEpisodeLabel: "S01 E12 — Inversion",
      }),
    );
    const kinds = model.miniCards.map((card) => card.kind);
    expect(kinds).not.toContain("resume");
    expect(kinds).toContain("prev");
    expect(kinds).toContain("next");
    const prev = model.miniCards.find((card) => card.kind === "prev");
    expect(prev?.thumbUrl).toBe("https://img/s1e10.jpg");
  });

  test("falls back to the queue head as up-next when no episode chain remains", () => {
    const model = buildMediaPanel(
      ctx({
        titleDetail: seriesDetail,
        queueNextLabel: "Frieren · S01E01",
      }),
    );
    const next = model.miniCards.find((card) => card.kind === "next");
    expect(next?.label).toBe("Frieren · S01E01");
    expect(next?.meta).toContain("from your queue");
  });
});

describe("buildMediaPanel — movie", () => {
  test("uses runtime/rating facts and never invents an episode chain", () => {
    const movieDetail: TitleDetail = {
      id: "m1",
      type: "movie",
      title: "Dune",
      year: "2021",
      runtimeMinutes: 155,
      score: 8.0,
      contentRating: "PG-13",
      genres: ["Sci-Fi"],
      synopsis: "Paul Atreides arrives on Arrakis.",
    };
    const model = buildMediaPanel(
      ctx({ contentKind: "movie", title: "Dune", titleDetail: movieDetail }),
    );
    expect(model.kind).toBe("movie");
    expect(model.secondary).toBe("2021 · 2h 35m");
    expect(model.facts).toContainEqual({ label: "runtime", value: "2h 35m" });
    expect(model.facts).toContainEqual({ label: "rating", value: "PG-13" });
    expect(model.miniCards.find((card) => card.kind === "next")).toBeUndefined();
  });
});

describe("buildMediaPanel — video", () => {
  test("renders channel-first facts from videoMeta and no SxxExx line", () => {
    const model = buildMediaPanel(
      ctx({
        contentKind: "video",
        title: "How CPUs Work",
        posterUrl: "https://img/thumb.jpg",
        videoMeta: {
          channelTitle: "Branch Education",
          viewCount: 1_200_000,
          publishedAt: new Date(Date.now() - 800 * 86_400_000).toISOString(),
          durationSeconds: 1_325,
          contentShape: "video",
        },
      }),
    );
    expect(model.kind).toBe("video");
    expect(model.secondary).toBe("Branch Education");
    expect(model.facts).toContainEqual({ label: "views", value: "1.2M views" });
    expect(model.facts).toContainEqual({ label: "length", value: "22:05" });
    expect(model.posterUrl).toBe("https://img/thumb.jpg");
  });

  test("flags live videos", () => {
    const model = buildMediaPanel(
      ctx({
        contentKind: "video",
        title: "Live Stream",
        videoMeta: { channelTitle: "News", liveStatus: "live" },
      }),
    );
    expect(model.facts).toContainEqual({ label: "live", value: "● live", tone: "success" });
  });
});
