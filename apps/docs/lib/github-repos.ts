import { workshop, type WorkshopMeta } from "./workshop";

const API = "https://api.github.com/repos/KitsuneKode";

/**
 * Live facts about the workshop repositories: stars, language and last push.
 *
 * The same posture as `github-stars.ts`: cached for an hour, an optional token
 * raises the anonymous rate limit, and every failure resolves to "no data"
 * rather than throwing, so a rate-limited build still renders the page with the
 * curated fallback. One request per repository, run in parallel; a repository
 * that fails does not take the others down with it.
 */
async function fetchOne(repo: string): Promise<WorkshopMeta | null> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const headers = new Headers({ Accept: "application/vnd.github+json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    const response = await fetch(`${API}/${repo}`, {
      headers,
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    // `response.json()` is untyped, so this is where the payload takes the shape
    // GitHub documents for it. Everything read from it below tolerates a missing
    // field, which is the only way a documented field can go wrong.
    const payload: GithubRepoPayload | null = await response.json();
    return parseRepoPayload(payload);
  } catch {
    return null;
  }
}

/** The fields of GitHub's repository payload this module reads. */
export type GithubRepoPayload = {
  readonly fork?: boolean;
  readonly stargazers_count?: number;
  readonly language?: string | null;
  readonly pushed_at?: string | null;
};

/**
 * Read the three fields we use from a GitHub repository payload.
 *
 * Exported for tests. A fork is rejected here as well as by the curated list: if
 * a repository in the workshop is ever swapped for a fork upstream, it drops out
 * of the live data and the page falls back to the curated copy rather than
 * showing someone else's star count as the maintainer's.
 */
export function parseRepoPayload(
  payload: GithubRepoPayload | null | undefined,
): WorkshopMeta | null {
  if (!payload || payload.fork === true) return null;
  const count = payload.stargazers_count;
  const stars =
    count !== undefined && Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
  return {
    stars,
    language: payload.language ?? null,
    pushedAt: payload.pushed_at ?? null,
  };
}

export async function fetchWorkshopMeta(): Promise<ReadonlyMap<string, WorkshopMeta>> {
  const entries = await Promise.all(
    workshop.map(async (project) => [project.repo, await fetchOne(project.repo)] as const),
  );
  const meta = new Map<string, WorkshopMeta>();
  for (const [repo, value] of entries) if (value) meta.set(repo, value);
  return meta;
}
