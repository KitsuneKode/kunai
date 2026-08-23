import { docsGithubRepoUrl } from "@/lib/docs-github";

const REPO_API = "https://api.github.com/repos/KitsuneKode/kunai";

/**
 * Star count for the repo.
 *
 * Unauthenticated GitHub API allows ~60 requests/hour per IP, so this is cached
 * for an hour and every failure path returns `null` rather than throwing: the
 * star badge is decoration, and a rate-limited build must still render the page.
 * Callers render the plain "Star on GitHub" link when this is `null`.
 */
export async function fetchGithubStarCount(): Promise<number | null> {
  // The anonymous API allows ~60 requests/hour per IP, and a CI or Vercel build
  // shares that IP with everything else on the runner — which is why the badge
  // rendered on one build and vanished on the next. A token, when the
  // deployment has one, raises the ceiling to 5,000/hour. It stays optional:
  // absent means anonymous, exactly as before, and never an error.
  const token = process.env.GITHUB_TOKEN?.trim();

  try {
    const response = await fetch(REPO_API, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return null;

    const count = (payload as { stargazers_count?: unknown }).stargazers_count;
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;

    return Math.floor(count);
  } catch {
    return null;
  }
}

/** `1234` -> `1.2k`. Keeps the badge a stable width as the number grows. */
export function formatStarCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`;
}

export function githubStarUrl(): string {
  return docsGithubRepoUrl();
}
