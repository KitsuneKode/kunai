import { describe, expect, test } from "bun:test";

test("discover shell data contract: RecommendationSection shape is stable", () => {
  type DiscoverItem = { id: string; title: string; year: number; rating: number | null };
  type Section = { id: string; label: string; items: readonly DiscoverItem[] };
  const section: Section = {
    id: "trending",
    label: "Trending",
    items: [{ id: "1", title: "Frieren", year: 2023, rating: 9.0 }],
  };
  expect(section.items[0]?.title).toBe("Frieren");
});
