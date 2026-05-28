import { DiscoverShell } from "@/app-shell/discover-shell";
import type { SearchResult } from "@/domain/types";
import type { RecommendationSection } from "@/services/recommendations/RecommendationService";
import React from "react";

import { captureSurface } from "./render-capture";

function pick(id: string, title: string, patch: Partial<SearchResult> = {}): SearchResult {
  return {
    id,
    title,
    type: "series",
    year: "2024",
    rating: 8.4,
    overview: "Slow-burn fantasy with quiet emotional beats.",
    metadataSource: "TMDB",
    posterPath: null,
    ...patch,
  };
}

const sections: RecommendationSection[] = [
  {
    label: "Because you watched Frieren: Beyond Journey's End",
    reason: "similar",
    items: [pick("1", "Mushoku Tensei"), pick("2", "Vinland Saga"), pick("3", "Heavenly Delusion")],
  },
  {
    label: "Trending this week",
    reason: "trending",
    items: [pick("4", "Dandadan"), pick("5", "Blue Lock")],
  },
];

await captureSurface(
  "discover-sections",
  <DiscoverShell sections={sections} onResult={() => {}} />,
);
console.log("captured discover hybrid list+rail");
process.exit(0);
