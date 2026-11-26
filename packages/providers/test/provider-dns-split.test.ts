import { afterEach, describe, expect, test } from "bun:test";

import { setProviderDohResolver, type DohAddress, type DohResolver } from "@kunai/core";
import type { ProviderRuntimeContext } from "@kunai/types";

import { curlResolveArgs } from "../src/shared/curl-impersonate";
import { verifyCandidateStream } from "../src/shared/resolve-gate";

function resolverOf(answer: readonly DohAddress[] | null): DohResolver {
  return {
    resolve: async () => answer,
    stats: () => ({ mode: "doh", answered: 0, systemFallbacks: 0 }),
  };
}

afterEach(() => setProviderDohResolver(null));

describe("curlResolveArgs", () => {
  test("pins curl to the shared DoH answer, v6 bracketed", async () => {
    setProviderDohResolver(
      resolverOf([
        { address: "8.8.4.4", family: 4 },
        { address: "2001:4860:4860::8844", family: 6 },
      ]),
    );
    expect(await curlResolveArgs("https://hianime.example/ajax/v2")).toEqual([
      "--resolve",
      "hianime.example:443:8.8.4.4,[2001:4860:4860::8844]",
    ]);
    expect(await curlResolveArgs("http://mirror.example:8080/x")).toEqual([
      "--resolve",
      "mirror.example:8080:8.8.4.4,[2001:4860:4860::8844]",
    ]);
  });

  test("a loopback or private answer never steers curl; only public addresses are pinned", async () => {
    setProviderDohResolver(
      resolverOf([
        { address: "127.0.0.1", family: 4 },
        { address: "169.254.169.254", family: 4 },
        { address: "8.8.8.8", family: 4 },
      ]),
    );
    expect(await curlResolveArgs("https://hianime.example/")).toEqual([
      "--resolve",
      "hianime.example:443:8.8.8.8",
    ]);
    setProviderDohResolver(resolverOf([{ address: "10.0.0.5", family: 4 }]));
    expect(await curlResolveArgs("https://hianime.example/")).toEqual([]);
  });

  test("no resolver, no answer or a bad URL adds nothing, so curl uses system DNS", async () => {
    expect(await curlResolveArgs("https://hianime.example/")).toEqual([]);
    setProviderDohResolver(resolverOf(null));
    expect(await curlResolveArgs("https://hianime.example/")).toEqual([]);
    expect(await curlResolveArgs("not a url")).toEqual([]);
  });
});

describe("resolve gate DNS", () => {
  test("probes with probeFetch so the probe resolves the way the player will", async () => {
    const used: string[] = [];
    const respond = (label: string) => async (url: string | URL | Request) => {
      used.push(label);
      return String(url).endsWith(".m3u8")
        ? new Response("#EXTM3U\n#EXTINF:4.0,\nsegment-0.ts\n", { status: 200 })
        : new Response(new Uint8Array(4096).fill(0xab), { status: 206 });
    };
    const context: ProviderRuntimeContext = {
      now: () => new Date(0).toISOString(),
      fetch: { runtime: "direct-http", fetch: respond("metadata"), probeFetch: respond("probe") },
    };

    const verdict = await verifyCandidateStream({
      stream: { url: "https://cdn.example/master.m3u8", headers: {} },
      context,
    });

    expect(verdict).toMatchObject({ accepted: true });
    expect(used.length).toBeGreaterThan(0);
    expect(new Set(used)).toEqual(new Set(["probe"]));
  });
});
