import { describe, expect, test } from "bun:test";

import { parseRepoPayload } from "../lib/github-repos";
import { presentWorkshopMeta, STAR_DISPLAY_FLOOR, workshop } from "../lib/workshop";

describe("workshop list", () => {
  test("every project is a distinct repository under the maintainer's account", () => {
    const repos = workshop.map((project) => project.repo);
    expect(new Set(repos).size).toBe(repos.length);
    for (const project of workshop) {
      expect(project.repoUrl).toBe(`https://github.com/KitsuneKode/${project.repo}`);
    }
  });

  test("never lists a fork: portless is an upstream fork and must stay out", () => {
    // Verified against the GitHub API when the list was written: portless reports
    // `fork: true`. If a project is ever added here, check `isFork` first.
    expect(workshop.map((project) => project.repo)).not.toContain("portless");
  });

  test("every link is https and every project says what it is", () => {
    for (const project of workshop) {
      expect(project.repoUrl.startsWith("https://")).toBe(true);
      if (project.siteUrl) expect(project.siteUrl.startsWith("https://")).toBe(true);
      expect(project.tagline.length).toBeGreaterThan(20);
      expect(project.tagline.length).toBeLessThan(140);
    }
  });

  test("names the projects the maintainer asked to feature", () => {
    const repos = workshop.map((project) => project.repo);
    for (const wanted of ["arche", "sweep", "kittymux", "run-cli", "js-questions-lab"]) {
      expect(repos).toContain(wanted);
    }
  });
});

describe("presentWorkshopMeta", () => {
  const project = workshop[0]!;

  test("falls back to the curated language when the live lookup failed", () => {
    expect(presentWorkshopMeta(project, undefined)).toEqual({
      language: project.language,
      stars: null,
      updated: null,
    });
  });

  test("prints stars only once there are enough to mean something", () => {
    const meta = (stars: number) => ({ stars, language: "Rust", pushedAt: null });
    expect(presentWorkshopMeta(project, meta(STAR_DISPLAY_FLOOR - 1)).stars).toBeNull();
    expect(presentWorkshopMeta(project, meta(STAR_DISPLAY_FLOOR)).stars).toBe(STAR_DISPLAY_FLOOR);
  });

  test("prefers the live language and keeps only the date of the last push", () => {
    const shown = presentWorkshopMeta(project, {
      stars: 0,
      language: "Rust",
      pushedAt: "2026-09-30T12:34:56Z",
    });
    expect(shown.language).toBe("Rust");
    expect(shown.updated).toBe("2026-09-30");
  });
});

describe("parseRepoPayload", () => {
  test("reads stars, language and last push", () => {
    expect(
      parseRepoPayload({
        fork: false,
        stargazers_count: 9,
        language: "TypeScript",
        pushed_at: "2026-09-26T00:00:00Z",
      }),
    ).toEqual({ stars: 9, language: "TypeScript", pushedAt: "2026-09-26T00:00:00Z" });
  });

  test("rejects a fork, so someone else's star count is never shown as the maintainer's", () => {
    expect(parseRepoPayload({ fork: true, stargazers_count: 4000 })).toBeNull();
  });

  test("treats an empty payload as no data and a bad star count as no stars", () => {
    expect(parseRepoPayload(null)).toBeNull();
    expect(parseRepoPayload(undefined)).toBeNull();
    expect(parseRepoPayload({ stargazers_count: -3 })?.stars).toBeNull();
    expect(parseRepoPayload({ stargazers_count: Number.NaN })?.stars).toBeNull();
  });
});
