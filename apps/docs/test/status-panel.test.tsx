import { afterEach, describe, expect, test } from "bun:test";

import type { JsonValue } from "@kunai/types";
import { renderToStaticMarkup } from "react-dom/server";

import { ProviderStatusPanel } from "../components/status/provider-status-panel";
import { codeMetadata } from "../lib/code-metadata";
import { loadProviderStatus, statusDataBase, STATUS_FILES } from "../lib/provider-status-live";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const realFetch = globalThis.fetch;

type Responses = Partial<Record<(typeof STATUS_FILES)[keyof typeof STATUS_FILES], JsonValue>>;

/** A `fetch` made from a plain function, with the `preconnect` Bun's type expects. */
function asFetch(impl: (input: RequestInfo | URL) => Promise<Response>): typeof fetch {
  return Object.assign(impl, { preconnect: realFetch.preconnect });
}

/** Serve fixtures for the three documents; anything not given is a 404. */
function stubFetch(responses: Responses): void {
  globalThis.fetch = asFetch(async (input) => {
    const name = String(input).split("/").pop() ?? "";
    const found = Object.entries(responses).find(([key]) => key === name);
    if (!found) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(found[1]), { status: 200 });
  });
}

function failingFetch(): void {
  globalThis.fetch = asFetch(async () => {
    throw new Error("network down");
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function liveRow(id: string, effectiveStatus: string, note = "") {
  return {
    id,
    upstreamHttp: 200,
    upstreamReachable: true,
    resolveStatus: effectiveStatus === "healthy" ? "resolved" : "exhausted",
    resolveMs: 2300,
    streams: effectiveStatus === "healthy" ? 3 : 0,
    qualities: [],
    servers: [],
    audioLanguages: [],
    subtitleLanes: 0,
    effectiveStatus,
    note,
  };
}

function liveStatus(hoursAgo: number, rows: ReturnType<typeof liveRow>[]) {
  return {
    generatedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
    schemaVersion: 1,
    providers: rows,
  };
}

describe("loadProviderStatus", () => {
  test("reads the three documents from the status-data branch", async () => {
    const seen: string[] = [];
    globalThis.fetch = asFetch(async (input) => {
      seen.push(String(input));
      return new Response("nope", { status: 404 });
    });
    await loadProviderStatus();
    for (const name of Object.values(STATUS_FILES)) {
      expect(seen).toContain(`${statusDataBase()}/${name}`);
    }
    expect(statusDataBase()).toContain("status-data");
  });

  test("uses the live copy when it is newer than the bundled one", async () => {
    stubFetch({
      [STATUS_FILES.status]: liveStatus(1, [liveRow("vidlink", "blocked")]),
    });
    const loaded = await loadProviderStatus();
    expect(loaded.source).toBe("live");
    expect(loaded.file.providers[0]?.effectiveStatus).toBe("blocked");
  });

  test("falls back to the bundled seed when the network is down, without throwing", async () => {
    failingFetch();
    const loaded = await loadProviderStatus();
    expect(loaded.source).toBe("bundled");
    expect(loaded.file.providers.length).toBeGreaterThan(0);
  });

  test("falls back when the live file is malformed, instead of drawing half of it", async () => {
    stubFetch({ [STATUS_FILES.status]: { schemaVersion: 1, generatedAt: "now", providers: [] } });
    expect((await loadProviderStatus()).source).toBe("bundled");
  });

  test("a valid live notices file always wins, since it exists to be edited without a release", async () => {
    stubFetch({
      [STATUS_FILES.notices]: {
        schemaVersion: 1,
        notices: [
          {
            id: "n1",
            level: "incident",
            title: "Keys rotated",
            body: "",
            providers: [],
            since: "2026-10-01T00:00:00Z",
            until: null,
          },
        ],
      },
    });
    expect((await loadProviderStatus()).notices.notices[0]?.title).toBe("Keys rotated");
  });
});

describe("ProviderStatusPanel", () => {
  async function render(responses: Responses | "down") {
    if (responses === "down") failingFetch();
    else stubFetch(responses);
    return renderToStaticMarkup(await ProviderStatusPanel({ now: NOW }));
  }

  test("lists every registered provider, with the ones the check has not seen marked Not checked", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
    });
    for (const provider of codeMetadata.providers) expect(html).toContain(provider.displayName);
    expect(html).toContain("Not checked");
  });

  test("groups by the CLI's modes", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
    });
    for (const label of ["Series &amp; movies", "Anime", "YouTube"]) expect(html).toContain(label);
  });

  test("a fresh result says how long ago it was checked, quietly", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(3, [liveRow("vidlink", "healthy")]),
    });
    expect(html).toContain("Checked 3 hours ago");
    expect(html).not.toContain("stopped reporting");
    expect(html).not.toContain("later than usual");
  });

  test("a late result says so, without calling the check dead", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(40, [liveRow("vidlink", "healthy")]),
    });
    expect(html).toContain("later than usual");
    expect(html).not.toContain("stopped reporting");
  });

  test("a stale result says the check has stopped, once, in the overview, with a way to see why", async () => {
    // This is the board as it actually was: three-week-old results presented as current.
    const html = await render("down");
    expect(html).toContain("stopped reporting");
    expect(html).toContain("Last checked");
    expect(html).toContain("actions/workflows/provider-status-sweep.yml");
    // Said once: the overview carries the state, and there is no second red banner.
    expect([...html.matchAll(/stopped reporting/g)]).toHaveLength(1);
  });

  test("a result a day overdue gets a calmer banner, not the stale treatment", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(40, [liveRow("vidlink", "healthy")]),
    });
    expect(html).toContain("later than usual");
    expect(html).not.toContain("This board is out of date");
    expect(html).not.toContain("data-dimmed");
  });

  test("a provider with nothing recorded shows one quiet dashed line, not thirty empty bars", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
    });
    expect(html).toContain("border-dashed");
    // Only providers that have history draw bars: vidlink's seed day, and no others.
    const withBars = [...html.matchAll(/kunai-strip-cell/g)].length;
    expect(withBars).toBeGreaterThan(0);
    expect(withBars % 30).toBe(0);
  });

  test("prints an uptime percentage once there is a week of history, instead of a streak", async () => {
    const days = Array.from({ length: 10 }, (_, index) => {
      const day = new Date(NOW - (9 - index) * 86_400_000).toISOString().slice(0, 10);
      return { day, providers: { vidlink: index === 4 ? "blocked" : "healthy" } };
    });
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
      [STATUS_FILES.history]: { schemaVersion: 1, days },
    });
    expect(html).toContain("90% healthy over 10 days");
    expect(html).not.toContain("The history is new");
  });

  test("says the history is new until there is a week of it", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
    });
    expect(html).toContain("The history is new");
    expect(html).toContain("Hollow bars are days nobody checked");
  });

  test("shows an active notice, with the providers it names", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("allanime", "degraded")]),
      [STATUS_FILES.notices]: {
        schemaVersion: 1,
        notices: [
          {
            id: "keys",
            level: "warning",
            title: "AllManga keys rotated",
            body: "A fix is in progress.",
            providers: ["allanime"],
            since: "2026-10-02T00:00:00Z",
            until: null,
          },
        ],
      },
    });
    expect(html).toContain("AllManga keys rotated");
    expect(html).toContain("A fix is in progress.");
    expect(html).toContain("AllManga");
  });

  test("does not show a notice that has ended", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
      [STATUS_FILES.notices]: {
        schemaVersion: 1,
        notices: [
          {
            id: "old",
            level: "info",
            title: "Past news",
            body: "",
            providers: [],
            since: "2026-09-01T00:00:00Z",
            until: "2026-09-02T00:00:00Z",
          },
        ],
      },
    });
    expect(html).not.toContain("Past news");
  });

  test("states how many providers resolve right now, in the ring and in words", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [
        liveRow("vidlink", "healthy"),
        liveRow("hianime", "healthy"),
        liveRow("miruro", "blocked"),
      ]),
    });
    expect(html).toContain(`of ${codeMetadata.providers.length} resolving`);
    expect(html).toContain("2 of 3 checked providers resolved a stream");
  });

  test("leads with an honest verdict on the whole board", async () => {
    const good = await render({
      [STATUS_FILES.status]: liveStatus(2, [
        liveRow("vidlink", "healthy"),
        liveRow("hianime", "healthy"),
      ]),
    });
    expect(good).toContain("Every checked provider is working");

    const bad = await render({
      [STATUS_FILES.status]: liveStatus(2, [
        liveRow("vidlink", "blocked"),
        liveRow("hianime", "dead"),
      ]),
    });
    expect(bad).toContain("No provider resolved in the last check");
  });

  test("a stale board says it is out of date and greys its ring, rather than sounding confident", async () => {
    const html = await render("down");
    expect(html).toContain("This board is out of date");
    expect(html).toContain("data-dimmed");
    expect(html).not.toContain("Every checked provider is working");
  });

  test("draws the ring from the status colours", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [
        liveRow("vidlink", "healthy"),
        liveRow("miruro", "blocked"),
      ]),
    });
    expect(html).toContain("conic-gradient(");
    expect(html).toContain("var(--kunai-ok)");
    expect(html).toContain("var(--kunai-gated)");
  });

  test("every state has a word, not only a colour, wherever it is drawn", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [
        liveRow("vidlink", "healthy"),
        liveRow("rivestream", "degraded"),
        liveRow("miruro", "blocked"),
        liveRow("anidb", "down"),
        liveRow("videasy", "dead"),
      ]),
    });
    for (const word of ["Healthy", "Degraded", "Region-gated", "Maintenance", "Unreachable"]) {
      expect(html).toContain(word);
    }
  });

  test("a history strip is read as one sentence, hidden from assistive tech as a drawing", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
    });
    expect(html).toMatch(/class="sr-only">[^<]*(recorded days|no daily checks)/);
    expect(html).toMatch(/aria-hidden="true" class="grid h-7/);
  });

  test("each day in a strip draws its own date and state on hover", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
    });
    expect(html).toContain('data-tip="Oct 3 · No check recorded"');
    expect(html).toContain("kunai-strip-cell");
    // A gap is a different thing from a day that was fine.
    expect(html).toContain('data-state="none"');
  });

  test("prints the date axis once, over the first group, and not on every row", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
    });
    expect([...html.matchAll(/30 days ago/g)]).toHaveLength(1);
  });

  test("every provider is a native, keyboard-operable disclosure", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
    });
    expect([...html.matchAll(/<details/g)]).toHaveLength(codeMetadata.providers.length);
    expect([...html.matchAll(/<summary/g)]).toHaveLength(codeMetadata.providers.length);
  });

  test("the open row carries the measurements behind the state", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
    });
    expect(html).toContain("Upstream");
    expect(html).toContain("Reachable · HTTP 200");
    expect(html).toContain("Resolved in 2.3s · 3 streams");
  });

  test("a resolve too fast to measure says so instead of printing 0.0s", async () => {
    const quick = { ...liveRow("youtube", "healthy"), resolveMs: 41 };
    const html = await render({ [STATUS_FILES.status]: liveStatus(2, [quick]) });
    expect(html).toContain("Resolved in under 0.1s");
    expect(html).not.toContain("0.0s");
  });

  test("a blocked provider shows its reason under the strip, where it is seen without opening", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [
        liveRow("miruro", "blocked", "upstream challenges this network (WAF/captcha)"),
      ]),
    });
    expect(html).toContain("upstream challenges this network (WAF/captcha)");
  });

  test("a provider the check has not seen explains that in its detail", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
    });
    expect(html).toContain("has no result for");
    expect(html).toContain("says nothing either way");
  });

  test("says how long a provider has been in its state, before there is a week for a percentage", async () => {
    const html = await render({
      [STATUS_FILES.status]: liveStatus(2, [liveRow("vidlink", "healthy")]),
    });
    expect(html).toMatch(/for 1 day/);
    expect(html).not.toContain("% healthy over");
  });

  test("explains what each state means and how the check works, with the raw data linked", async () => {
    const html = await render("down");
    expect(html).toContain("What the states mean");
    expect(html).toContain("How this is measured");
    expect(html).toContain(`${statusDataBase()}/${STATUS_FILES.status}`);
  });

  test("external links open in a new tab and say so", async () => {
    const html = await render("down");
    expect(html).toContain('target="_blank"');
    expect(html).toContain("opens in a new tab");
  });
});
