import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

import type { JsonValue } from "@kunai/types";

import { renderWebCompanionHtml } from "../src/web-companion-html";

// Execute the shipped inline script; the small DOM double records behavior without
// loading providers, real profiles, a browser dependency or wall-clock sleeps.
class Element {
  tagName: string;
  children: Element[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  className = "";
  value = "";
  textContent = "";
  href = "";
  src = "";
  disabled = false;
  preceding: Element[] = [];
  before(element: Element) {
    this.preceding.push(element);
  }
  remove() {}
  open = false;
  listeners: Record<string, Array<() => void>> = {};
  onclick: (() => void) | null = null;
  classList = {
    add: (_value: string) => {},
    remove: (_value: string) => {},
    toggle: (_value: string, _enabled?: boolean) => {},
  };
  constructor(tagName = "div") {
    this.tagName = tagName;
  }
  set innerHTML(value: string) {
    if (value) throw new Error("Dynamic HTML is forbidden in this test DOM");
    this.children = [];
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = String(value);
  }
  getAttribute(key: string) {
    return this.attributes[key] ?? null;
  }
  removeAttribute(key: string) {
    delete this.attributes[key];
    if (key === "src") this.src = "";
    if (key === "href") this.href = "";
  }
  appendChild(child: Element) {
    this.children.push(child);
    return child;
  }
  replaceChildren(...children: Element[]) {
    this.children = children;
    this.textContent = "";
  }
  addEventListener(name: string, callback: () => void) {
    (this.listeners[name] ??= []).push(callback);
  }
  dispatch(name: string) {
    for (const callback of this.listeners[name] ?? []) callback();
    if (name === "click") this.onclick?.();
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.dispatch("close");
  }
  focus() {}
  pause() {}
  load() {}
  play() {
    return Promise.resolve();
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const reply = (body: JsonValue, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
function harness(
  handler: (
    url: string,
    init?: RequestInit,
  ) => ReturnType<typeof reply> | Promise<ReturnType<typeof reply>>,
  hash = "",
) {
  const html = renderWebCompanionHtml();
  const elements = new Map<string, Element>();
  for (const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g))
    elements.set(match[2]!, new Element(match[1]));
  const tabs = ["anime", "series", "movies", "youtube", "remote", "status"].map((lane) => {
    const tab = new Element("button");
    tab.attributes["data-tab"] = lane;
    return tab;
  });
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const history: string[] = [];
  runInNewContext(html.split("<script>")[1]!.split("</script>")[0]!, {
    document: {
      getElementById: (id: string) => elements.get(id),
      querySelectorAll: () => tabs,
      createElement: (tag: string) => new Element(tag),
    },
    window: { location: { hash, origin: "http://127.0.0.1:1234", pathname: "/", search: "" } },
    history: { replaceState: (_state: null, _title: string, url: string) => history.push(url) },
    fetch: (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(handler(url, init));
    },
    URL,
    URLSearchParams,
    AbortController,
    setTimeout: (fn: () => void) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const get = (id: string) => elements.get(id)!;
  const input = (query: string) => {
    get("searchInput").value = query;
    get("searchInput").dispatch("input");
    for (const callback of timers.values()) callback();
    timers.clear();
  };
  const tab = (lane: string) =>
    tabs.find((item) => item.attributes["data-tab"] === lane)!.dispatch("click");
  return { get, calls, input, tab, history, html };
}
function texts(node: Element): string {
  return node.textContent + node.children.map(texts).join(" ");
}
const status = { ok: true, controls: ["play", "stop"], providers: [], playback: { state: "idle" } };
const title = {
  id: "opaque",
  title: '<img src=x onerror="bad()">',
  providerId: "<bad>",
  type: "anime",
};

test("bootstrap exchanges fragment once, removes it and waits before API requests", async () => {
  const auth = deferred<ReturnType<typeof reply>>();
  const ui = harness(
    (url) => (url === "/api/session" ? auth.promise : reply(status)),
    "#token=" + "a".repeat(32),
  );
  ui.input("query");
  await flush();
  expect(ui.history).toEqual(["/"]);
  expect(ui.calls.map((call) => call.url)).toEqual(["/api/session"]);
  expect(JSON.parse(String(ui.calls[0]!.init!.body))).toEqual({ token: "a".repeat(32) });
  auth.resolve(reply({ ok: true }));
  await flush();
  expect(ui.calls.some((call) => call.url.startsWith("/api/search?"))).toBe(true);
});

test("search safely renders provider text, ignores stale replies and remembers each lane query", async () => {
  const old = deferred<ReturnType<typeof reply>>();
  const ui = harness((url) =>
    url.includes("q=old")
      ? old.promise
      : reply(url.startsWith("/api/search") ? { results: [title] } : status),
  );
  ui.input("old");
  await flush();
  ui.input("new");
  await flush();
  expect(ui.get("resultsGrid").children[0]!.tagName).toBe("button");
  expect(texts(ui.get("resultsGrid"))).toContain(title.title);
  old.resolve(reply({ results: [{ ...title, title: "STALE" }] }));
  await flush();
  expect(texts(ui.get("resultsGrid"))).not.toContain("STALE");
  ui.tab("movies");
  await flush();
  expect(ui.get("searchInput").value).toBe("");
  ui.input("film");
  await flush();
  ui.tab("anime");
  await flush();
  expect(ui.get("searchInput").value).toBe("new");
});

test("episode failure is retryable and never creates a synthetic play row", async () => {
  const ui = harness((url) =>
    reply(
      url.startsWith("/api/search")
        ? { results: [title] }
        : url.startsWith("/api/episodes")
          ? { error: "catalog unavailable" }
          : status,
      url.startsWith("/api/episodes") ? 502 : 200,
    ),
  );
  ui.input("title");
  await flush();
  ui.get("resultsGrid").children[0]!.dispatch("click");
  await flush();
  expect(ui.get("sheetOverlay").open).toBe(true);
  expect(texts(ui.get("episodesList"))).toContain("Retry");
  expect(ui.calls.some((call) => call.url.startsWith("/api/stream"))).toBe(false);
  expect(ui.get("castHostBtn").disabled).toBe(true);
});

test("browser uses only returned loopback gateway; close clears media and revokes", async () => {
  const gateway = "http://127.0.0.1:4567/g/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/media";
  const ui = harness((url) =>
    reply(
      url.startsWith("/api/search")
        ? { results: [title] }
        : url.startsWith("/api/episodes")
          ? { episodes: [{ number: 3, season: 2, title: "Actual episode" }] }
          : url.startsWith("/api/stream")
            ? { ok: true, browserPlayable: true, streamUrl: gateway }
            : status,
    ),
  );
  ui.input("title");
  await flush();
  ui.get("resultsGrid").children[0]!.dispatch("click");
  await flush();
  expect(ui.calls.find((call) => call.url.startsWith("/api/stream"))?.url).toContain("season=2");
  ui.get("streamBrowserBtn").dispatch("click");
  await flush();
  expect(ui.get("player").src).toBe(gateway);
  expect(ui.get("openVlcBtn").href).toBe("vlc://" + gateway);
  ui.get("sheetClose").dispatch("click");
  await flush();
  expect(ui.get("player").src).toBe("");
  expect(ui.calls.some((call) => call.url === "/api/release")).toBe(true);
  expect(ui.html).not.toContain("/proxy?url=");
});

test("missing browser format retains real desktop action and reports server errors", async () => {
  const ui = harness((url) =>
    reply(
      url.startsWith("/api/search")
        ? { results: [title] }
        : url.startsWith("/api/episodes")
          ? { episodes: [{ number: 1, title: "Play Title" }] }
          : url.startsWith("/api/stream")
            ? { ok: false, reason: "Use desktop for this format" }
            : url === "/api/control"
              ? { error: "mpv unavailable" }
              : status,
      url === "/api/control" ? 503 : 200,
    ),
  );
  ui.input("title");
  await flush();
  ui.get("resultsGrid").children[0]!.dispatch("click");
  await flush();
  expect(ui.get("streamBrowserBtn").disabled).toBe(true);
  expect(ui.get("castHostBtn").disabled).toBe(false);
  ui.get("castHostBtn").dispatch("click");
  await flush();
  expect(texts(ui.get("sheetStatus"))).toContain("mpv unavailable");
  const command = JSON.parse(
    String(ui.calls.find((call) => call.url === "/api/control")?.init?.body),
  );
  expect(command).toEqual({
    action: "play",
    titleId: "opaque",
    episode: 1,
    season: 1,
    lane: "anime",
  });
});

test("forbidden APIs show reconnect guidance and status controls do not invent support", async () => {
  const ui = harness(() => reply({ error: "Forbidden" }, 403));
  await flush();
  expect(texts(ui.get("connText"))).toContain("Reopen");
  expect(ui.html).toContain("<dialog");
  expect(ui.html).toContain('aria-label="Clear search"');
  expect(ui.html).not.toContain('sendCmd("toggle-pause")');
});

test("season selection reloads the real catalog and fractional episodes stay selectable", async () => {
  const ui = harness((url) =>
    reply(
      url.startsWith("/api/search")
        ? { results: [title] }
        : url.startsWith("/api/episodes")
          ? {
              seasons: [1, 2],
              episodes: [
                { number: 12.5, season: url.includes("season=2") ? 2 : 1, title: "Special" },
              ],
            }
          : url.startsWith("/api/stream")
            ? { ok: false, reason: "Use device" }
            : status,
    ),
  );
  ui.input("title");
  await flush();
  ui.get("resultsGrid").children[0]!.dispatch("click");
  await flush();
  expect(texts(ui.get("episodesList"))).toContain("12.5");
  const picker = ui.get("episodesList").preceding[0]!;
  expect(picker.getAttribute("aria-label")).toBe("Season");
  picker.value = "2";
  picker.dispatch("change");
  await flush();
  expect(ui.calls.filter((call) => call.url.startsWith("/api/episodes")).at(-1)?.url).toContain(
    "season=2",
  );
});

test("an unavailable thumbnail has an explicit fallback without losing the title action", async () => {
  const ui = harness((url) =>
    reply(
      url.startsWith("/api/search")
        ? { results: [{ ...title, posterUrl: "https://cdn.example.test/poster.jpg" }] }
        : status,
    ),
  );
  ui.input("title");
  await flush();
  const card = ui.get("resultsGrid").children[0]!;
  const poster = card.children[0]!;
  expect(poster.children[0]!.tagName).toBe("img");
  poster.children[0]!.dispatch("error");
  expect(texts(poster)).toContain("🎬");
  expect(texts(card)).toContain(title.title);
  expect(card.tagName).toBe("button");
});
