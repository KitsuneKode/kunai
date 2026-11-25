import { describe, expect, test } from "bun:test";

import {
  createDohResolver,
  proxyAppliesTo,
  shouldBypassDoh,
  type DohFetch,
} from "../src/doh-resolver";

type Answer = { type: number; data: string; TTL?: number };

function dnsJson(answers: readonly Answer[], status = 0): Response {
  return new Response(JSON.stringify({ Status: status, Answer: answers }), {
    status: 200,
    headers: { "content-type": "application/dns-json" },
  });
}

/** A DoH server: answers per `type` query param, records every call. */
function server(byType: Partial<Record<1 | 28, readonly Answer[]>>, status = 0) {
  const calls: string[] = [];
  const fetch: DohFetch = async (input) => {
    calls.push(input);
    const type = new URL(input).searchParams.get("type") === "28" ? 28 : 1;
    return dnsJson(byType[type] ?? [], status);
  };
  return { calls, fetch };
}

const A = (data: string, TTL = 300): Answer => ({ type: 1, data, TTL });
const AAAA = (data: string, TTL = 300): Answer => ({ type: 28, data, TTL });

describe("createDohResolver", () => {
  test("answers v4 first and caches for the record TTL", async () => {
    let clock = 1_000;
    const doh = server({ 1: [A("203.0.113.7", 60)], 28: [AAAA("2001:db8::7")] });
    const resolver = createDohResolver({ fetch: doh.fetch, now: () => clock });

    expect(await resolver.resolve("API.Example.com.")).toEqual([
      { address: "203.0.113.7", family: 4 },
    ]);
    const firstCalls = doh.calls.length;
    clock += 59_000;
    await resolver.resolve("api.example.com");
    expect(doh.calls.length).toBe(firstCalls);
    clock += 2_000;
    await resolver.resolve("api.example.com");
    expect(doh.calls.length).toBeGreaterThan(firstCalls);
  });

  test("uses v6 only when there is no v4 answer", async () => {
    const doh = server({ 28: [AAAA("2001:db8::9")] });
    const resolver = createDohResolver({ fetch: doh.fetch });
    expect(await resolver.resolve("v6only.example")).toEqual([
      { address: "2001:db8::9", family: 6 },
    ]);
  });

  test("NXDOMAIN hands the name to system DNS and is remembered briefly", async () => {
    const doh = server({}, 3);
    const resolver = createDohResolver({ fetch: doh.fetch });
    expect(await resolver.resolve("intranet.example")).toBeNull();
    const calls = doh.calls.length;
    expect(await resolver.resolve("intranet.example")).toBeNull();
    expect(doh.calls.length).toBe(calls);
  });

  test("SERVFAIL is not an answer: the next endpoint is tried", async () => {
    const seen: string[] = [];
    const fetch: DohFetch = async (input) => {
      const url = new URL(input);
      seen.push(url.host);
      if (url.host === "198.51.100.1") return dnsJson([], 2);
      return dnsJson(url.searchParams.get("type") === "1" ? [A("203.0.113.5")] : []);
    };
    const resolver = createDohResolver({
      fetch,
      endpoints: ["https://198.51.100.1/dns-query", "https://198.51.100.2/dns-query"],
    });
    expect(await resolver.resolve("fallback.example")).toEqual([
      { address: "203.0.113.5", family: 4 },
    ]);
    expect(seen).toContain("198.51.100.2");
  });

  test("an unreachable DoH endpoint opens the breaker; lookups go straight to system DNS", async () => {
    let clock = 0;
    let calls = 0;
    const opened: string[] = [];
    const resolver = createDohResolver({
      fetch: async () => {
        calls += 1;
        throw new TypeError("connect ECONNREFUSED");
      },
      now: () => clock,
      failureThreshold: 2,
      cooldownMs: 60_000,
      onBreakerOpen: (reason) => opened.push(reason),
    });

    expect(await resolver.resolve("a.example")).toBeNull();
    expect(await resolver.resolve("b.example")).toBeNull();
    expect(opened).toHaveLength(1);
    const callsWhenOpened = calls;
    expect(await resolver.resolve("c.example")).toBeNull();
    expect(calls).toBe(callsWhenOpened);
    expect(resolver.stats().breakerOpenUntil).toBe(60_000);

    clock = 60_001;
    await resolver.resolve("d.example");
    expect(calls).toBeGreaterThan(callsWhenOpened);
  });

  test("a slow endpoint costs one bounded query, then system DNS", async () => {
    const deadlines: AbortController[] = [];
    const resolver = createDohResolver({
      queryTimeoutMs: 1500,
      endpoints: ["https://198.51.100.9/dns-query"],
      timeoutSignal: (ms) => {
        expect(ms).toBe(1500);
        const controller = new AbortController();
        deadlines.push(controller);
        return controller.signal;
      },
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });
    const pending = resolver.resolve("slow.example");
    await Promise.resolve();
    // Both the A and the AAAA query are bounded by their own deadline.
    expect(deadlines).toHaveLength(2);
    for (const deadline of deadlines) deadline.abort(new DOMException("timed out", "TimeoutError"));
    expect(await pending).toBeNull();
    expect(resolver.stats().lastFailure).toBe("timeout");
  });

  test("the caller's cancellation propagates and is not counted as DoH failing", async () => {
    const controller = new AbortController();
    const opened: string[] = [];
    const resolver = createDohResolver({
      failureThreshold: 1,
      onBreakerOpen: (reason) => opened.push(reason),
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });
    const pending = resolver.resolve("cancel.example", controller.signal);
    controller.abort(new DOMException("user cancelled", "AbortError"));
    await expect(pending).rejects.toThrow("user cancelled");
    expect(opened).toEqual([]);
  });

  test("local and literal names never leave the machine", async () => {
    const doh = server({ 1: [A("203.0.113.1")] });
    const resolver = createDohResolver({ fetch: doh.fetch });
    for (const host of ["localhost", "nas.lan", "printer.local", "router", "192.168.1.4", "::1"]) {
      expect(await resolver.resolve(host)).toBeNull();
    }
    expect(doh.calls).toEqual([]);
  });
});

describe("shouldBypassDoh", () => {
  test("public names go through DoH; local, single-label and literals do not", () => {
    expect(shouldBypassDoh("scrapper.rivestream.app")).toBe(false);
    expect(shouldBypassDoh("home.arpa")).toBe(false);
    expect(shouldBypassDoh("box.home.arpa")).toBe(true);
    expect(shouldBypassDoh("[2001:db8::1]")).toBe(true);
    expect(shouldBypassDoh("10.0.0.2")).toBe(true);
    expect(shouldBypassDoh("addon.internal")).toBe(true);
  });
});

describe("proxyAppliesTo", () => {
  const url = new URL("https://api.example.com/x");

  test("an HTTPS proxy carries https requests", () => {
    expect(proxyAppliesTo(url, { HTTPS_PROXY: "http://proxy:3128" })).toBe(true);
    expect(proxyAppliesTo(url, { HTTP_PROXY: "http://proxy:3128" })).toBe(false);
    expect(proxyAppliesTo(url, { ALL_PROXY: "socks5://proxy:1080" })).toBe(true);
  });

  test("NO_PROXY exempts exact hosts, subdomains and *", () => {
    const env = { HTTPS_PROXY: "http://proxy:3128" };
    expect(proxyAppliesTo(url, { ...env, NO_PROXY: "example.com" })).toBe(false);
    expect(proxyAppliesTo(url, { ...env, no_proxy: ".example.com:443" })).toBe(false);
    expect(proxyAppliesTo(url, { ...env, NO_PROXY: "*" })).toBe(false);
    expect(proxyAppliesTo(url, { ...env, NO_PROXY: "other.org" })).toBe(true);
  });
});
