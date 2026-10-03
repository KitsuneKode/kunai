import { afterEach, describe, expect, test } from "bun:test";

import type { JsonValue } from "@kunai/types";
import { renderToStaticMarkup } from "react-dom/server";

import SupportPage from "../app/support/page";
import { HomeOpenSource } from "../components/home/home-open-source";
import { ContributorCredit, ContributorList } from "../components/support/contributor-list";
import { SponsorWall } from "../components/support/sponsor-wall";
import { fetchContributors } from "../lib/github-repos";
import { SPONSOR_LISTING_STEPS, SPONSOR_PERKS, SUPPORT_PATH } from "../lib/support";

const realFetch = globalThis.fetch;

/** A `fetch` made from a plain function, with the `preconnect` Bun's type expects. */
function asFetch(impl: () => Promise<Response>): typeof fetch {
  return Object.assign(impl, { preconnect: realFetch.preconnect });
}

function serve(body: JsonValue, status = 200): void {
  globalThis.fetch = asFetch(async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** GitHub's list as it is today: the owner, two agents and two bots, and no outside person. */
const TODAY: JsonValue = [
  { login: "KitsuneKode", type: "User", contributions: 2811 },
  { login: "claude", type: "User", contributions: 5 },
  { login: "cursoragent", type: "User", contributions: 5 },
  { login: "github-actions[bot]", type: "Bot", contributions: 4 },
  { login: "Copilot", type: "Bot", contributions: 1 },
];

const WITH_PERSON: JsonValue = [
  ...TODAY,
  { login: "ada", type: "User", contributions: 7 },
  { login: "bea", type: "User", contributions: 1 },
];

describe("fetchContributors", () => {
  test("returns nobody for the repository as it stands", async () => {
    serve(TODAY);
    expect(await fetchContributors()).toEqual([]);
  });

  test("returns the outside people, most active first", async () => {
    serve(WITH_PERSON);
    expect((await fetchContributors()).map((contributor) => contributor.login)).toEqual([
      "ada",
      "bea",
    ]);
  });

  test("is an empty list when GitHub refuses or the network is down, never an error", async () => {
    serve({ message: "rate limited" }, 403);
    expect(await fetchContributors()).toEqual([]);
    globalThis.fetch = asFetch(async () => {
      throw new Error("down");
    });
    expect(await fetchContributors()).toEqual([]);
  });
});

describe("ContributorList", () => {
  const html = renderToStaticMarkup(
    <ContributorList
      contributors={[
        { login: "ada", url: "https://github.com/ada", contributions: 7 },
        { login: "bea", url: "https://github.com/bea", contributions: 1 },
      ]}
    />,
  );

  test("names each person as a link, with their count, pluralised", () => {
    expect(html).toContain('href="https://github.com/ada"');
    expect(html).toContain("@ada");
    expect(html).toContain("7 changes");
    expect(html).toContain("1 change<");
  });

  test("loads no images: an avatar would be a request to a host that is not ours", () => {
    expect(html).not.toContain("<img");
  });

  test("opens in a new tab and says so", () => {
    expect(html).toContain('target="_blank"');
    expect(html).toContain("opens in a new tab");
  });
});

describe("ContributorCredit on the home page", () => {
  test("renders nothing while there are no outside contributors", async () => {
    serve(TODAY);
    expect(renderToStaticMarkup(await ContributorCredit())).toBe("");
  });

  test("thanks the people there are", async () => {
    serve(WITH_PERSON);
    const html = renderToStaticMarkup(await ContributorCredit());
    expect(html).toContain("With help from");
    expect(html).toContain("@ada");
    expect(html).toContain("@bea");
  });

  test("caps the names and counts the rest", async () => {
    serve(
      Array.from({ length: 9 }, (_, index) => ({
        login: `person${index}`,
        type: "User",
        contributions: 20 - index,
      })),
    );
    const html = renderToStaticMarkup(await ContributorCredit());
    expect(html).toContain("and 3 more");
    expect(html).not.toContain("@person8");
  });
});

describe("sponsor perks", () => {
  test("promise a shout-out on the site, chosen by the sponsor", () => {
    expect(SPONSOR_PERKS[0].title).toBe("A shout-out on the site");
    expect(SPONSOR_PERKS.map((perk) => perk.body).join(" ")).toContain("unless you ask");
  });

  test("never make a feature depend on money", () => {
    for (const perk of SPONSOR_PERKS) {
      expect(perk.body.toLowerCase()).not.toMatch(/priority|early access|unlock|premium|exclusive/);
    }
  });

  test("say how to be listed, in three steps that start with sponsoring", () => {
    expect(SPONSOR_LISTING_STEPS).toHaveLength(3);
    expect(SPONSOR_LISTING_STEPS[0]).toContain("Sponsor on GitHub");
    expect(SPONSOR_LISTING_STEPS.join(" ")).toContain("credited");
  });

  test("the empty wall invites a sponsor with the same promise", () => {
    const html = renderToStaticMarkup(<SponsorWall sponsors={[]} />);
    expect(html).toContain("credited");
    expect(html).toContain("Nothing is listed unless you ask");
  });
});

describe("HomeOpenSource", () => {
  test("mentions the shout-out and links the support page for the detail", () => {
    const html = renderToStaticMarkup(<HomeOpenSource />);
    expect(html).toContain("shout-out");
    expect(html).toContain(`href="${SUPPORT_PATH}"`);
  });

  test("shows a contributor credit when one is passed, and nothing for it by default", () => {
    expect(renderToStaticMarkup(<HomeOpenSource />)).not.toContain("With help from");
    const html = renderToStaticMarkup(
      <HomeOpenSource contributorCredit={<p>With help from @ada.</p>} />,
    );
    expect(html).toContain("With help from @ada.");
  });
});

describe("the support page", () => {
  async function render() {
    return renderToStaticMarkup(await SupportPage());
  }

  test("leads the sponsor section with what sponsoring gets you and how to be listed", async () => {
    serve(TODAY);
    const html = await render();
    expect(html).toContain("A shout-out on the site");
    expect(html).toContain("You choose how you appear");
    expect(html).toContain("How to be listed");
    expect(html).toContain("Sponsor on GitHub.");
    // The people to reach, both real and public.
    expect(html).toContain("GitHub Discussions");
  });

  test("with no outside contributors it says they will be listed as they arrive, and lists none", async () => {
    serve(TODAY);
    const html = await render();
    expect(html).toContain("Who makes it");
    expect(html).toContain("People who send changes are listed here as they arrive");
    expect(html).not.toContain("@claude");
    expect(html).not.toContain("@cursoragent");
  });

  test("with one, it lists them and drops the placeholder sentence", async () => {
    serve(WITH_PERSON);
    const html = await render();
    expect(html).toContain("@ada");
    expect(html).toContain("And by the people who have sent changes");
    expect(html).not.toContain("listed here as they arrive");
  });

  test("never credits the maintainer, an agent or a bot as a contributor", async () => {
    serve(WITH_PERSON);
    const html = await render();
    expect(html).not.toContain("@claude");
    expect(html).not.toContain("@github-actions");
    expect(html).not.toContain("2811 changes");
  });
});
