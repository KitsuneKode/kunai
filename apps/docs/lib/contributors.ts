/**
 * Who counts as a contributor, read off GitHub's contributor list.
 *
 * GitHub's list is not a list of people. For this repository it holds the owner, a
 * coding-agent account typed as a plain "User", and bots. Printing it as "thanks to
 * our contributors" would credit software, so this keeps people and drops the rest:
 * the owner (credited separately, as the maintainer), anything GitHub types as a
 * bot, and the accounts of coding agents and review bots that appear as users.
 *
 * Where there is nobody left, the page shows no contributors section at all. An
 * empty wall of avatars would claim a community that does not exist yet; the first
 * outside contribution is what makes the section appear.
 */

export type Contributor = {
  readonly login: string;
  readonly url: string;
  readonly contributions: number;
};

/** The fields of GitHub's contributor payload this module reads. */
export type GithubContributorPayload = {
  readonly login?: string;
  readonly type?: string;
  readonly contributions?: number;
};

/**
 * Accounts that are software, not people, though GitHub may type them as "User".
 * Lower case, compared lower case. Add an agent or bot here the day it shows up in
 * the list; the test pins the ones known today.
 */
export const NOT_PEOPLE: ReadonlySet<string> = new Set([
  "claude",
  "cursoragent",
  "copilot",
  "coderabbitai",
  "dependabot",
  "renovate",
  "github-actions",
  "devin-ai-integration",
]);

/** The login with a trailing `[bot]` removed, lower-cased, for comparison. */
function normalise(login: string): string {
  return login.replace(/\[bot\]$/i, "").toLowerCase();
}

/**
 * The people in `payload`, most contributions first. `owner` is excluded because the
 * maintainer is credited by name on their own line, not counted among contributors.
 */
export function listContributors(
  payload: readonly GithubContributorPayload[] | null | undefined,
  owner: string,
): readonly Contributor[] {
  const out: Contributor[] = [];
  for (const entry of payload ?? []) {
    const login = entry.login;
    if (!login || entry.type === "Bot") continue;
    const name = normalise(login);
    if (name === owner.toLowerCase() || NOT_PEOPLE.has(name)) continue;
    const contributions = entry.contributions ?? 0;
    if (contributions <= 0) continue;
    out.push({ login, url: `https://github.com/${login}`, contributions });
  }
  return out.sort((a, b) => b.contributions - a.contributions || a.login.localeCompare(b.login));
}
