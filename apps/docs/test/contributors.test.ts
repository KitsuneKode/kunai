import { describe, expect, test } from "bun:test";

import { listContributors, NOT_PEOPLE, type GithubContributorPayload } from "../lib/contributors";

const OWNER = "KitsuneKode";

describe("listContributors", () => {
  test("is empty for the real list as it stands: the owner, two agents and two bots", () => {
    // Taken from GitHub's contributors endpoint for the repository. None of these is
    // an outside person, so no contributors section should appear yet.
    const real: GithubContributorPayload[] = [
      { login: "KitsuneKode", type: "User", contributions: 2811 },
      { login: "claude", type: "User", contributions: 5 },
      { login: "cursoragent", type: "User", contributions: 5 },
      { login: "github-actions[bot]", type: "Bot", contributions: 4 },
      { login: "Copilot", type: "Bot", contributions: 1 },
    ];
    expect(listContributors(real, OWNER)).toEqual([]);
  });

  test("includes an outside person, with their profile link and count", () => {
    const list = listContributors(
      [
        { login: "KitsuneKode", type: "User", contributions: 100 },
        { login: "someone", type: "User", contributions: 3 },
      ],
      OWNER,
    );
    expect(list).toEqual([
      { login: "someone", url: "https://github.com/someone", contributions: 3 },
    ]);
  });

  test("orders by contributions, then by name", () => {
    const list = listContributors(
      [
        { login: "bea", type: "User", contributions: 2 },
        { login: "ada", type: "User", contributions: 2 },
        { login: "cy", type: "User", contributions: 9 },
      ],
      OWNER,
    );
    expect(list.map((c) => c.login)).toEqual(["cy", "ada", "bea"]);
  });

  test("never lists the owner, whatever the case of their login", () => {
    expect(
      listContributors([{ login: "kitsunekode", type: "User", contributions: 5 }], OWNER),
    ).toEqual([]);
  });

  test("drops anything GitHub types as a bot, with or without the [bot] suffix", () => {
    expect(
      listContributors(
        [
          { login: "renovate[bot]", type: "Bot", contributions: 9 },
          { login: "some-app", type: "Bot", contributions: 9 },
        ],
        OWNER,
      ),
    ).toEqual([]);
  });

  test("drops agent and review accounts that appear as ordinary users, case-insensitively", () => {
    const list = listContributors(
      [
        { login: "Claude", type: "User", contributions: 5 },
        { login: "CodeRabbitAI", type: "User", contributions: 5 },
        { login: "dependabot[bot]", type: "User", contributions: 5 },
      ],
      OWNER,
    );
    expect(list).toEqual([]);
  });

  test("ignores entries with no login or no contributions, and a missing list", () => {
    expect(listContributors([{ type: "User", contributions: 4 }], OWNER)).toEqual([]);
    expect(listContributors([{ login: "ghost", type: "User", contributions: 0 }], OWNER)).toEqual(
      [],
    );
    expect(listContributors(null, OWNER)).toEqual([]);
    expect(listContributors(undefined, OWNER)).toEqual([]);
  });

  test("the not-people list names the accounts known today", () => {
    for (const name of ["claude", "cursoragent", "copilot", "coderabbitai"]) {
      expect(NOT_PEOPLE.has(name)).toBe(true);
    }
  });
});
