import { afterEach, describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import { providerFetch, ProviderHttpError } from "../src/runtime/fetch";
import { setActiveProviderHotfixManifest } from "../src/shared/hotfix-runtime";
import type { ProviderHotfixManifest } from "../src/shared/manifest-bundle";

type Call = { readonly url: string; readonly init?: RequestInit };

function contextWith(route: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = [];
  // SAFETY: deliberately partial runtime context — providerFetch only reads `fetch`.
  const context: ProviderRuntimeContext = {
    fetch: {
      async fetch(input: string | URL | Request, init?: RequestInit) {
        const url = input instanceof Request ? input.url : String(input);
        calls.push({ url, init });
        return route(url, init);
      },
    },
  } as never;
  return { context, calls };
}

function activate(providers: ProviderHotfixManifest["providers"]) {
  const now = Date.now();
  setActiveProviderHotfixManifest({
    schemaVersion: 1,
    revision: 1,
    generatedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 86_400_000).toISOString(),
    providers,
  });
}

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } });

afterEach(() => setActiveProviderHotfixManifest(null));

describe("redirects from hotfix-supplied hosts are re-checked per hop", () => {
  test("a signed mirror cannot hand the request to loopback or plain http", async () => {
    activate({ rivestream: { mirrors: ["https://mirror.example"] } });
    for (const target of [
      "http://127.0.0.1:8080/meta",
      "https://localhost./meta",
      "https://169.254.169.254/latest",
      "http://cdn.example/x",
    ]) {
      const { context, calls } = contextWith(() => redirect(target));
      await expect(providerFetch(context, "https://mirror.example/api")).rejects.toBeInstanceOf(
        ProviderHttpError,
      );
      // The refused target was never requested.
      expect(calls.map((call) => call.url)).toEqual(["https://mirror.example/api"]);
      expect(calls[0]?.init?.redirect).toBe("manual");
    }
  });

  test("a public HTTPS redirect is followed, and 303 turns POST into GET", async () => {
    activate({ rivestream: { mirrors: ["https://mirror.example"] } });
    const { context, calls } = contextWith((url) =>
      url === "https://mirror.example/api"
        ? redirect("https://cdn.example/final", 303)
        : new Response("ok", { status: 200 }),
    );
    const response = await providerFetch(context, "https://mirror.example/api", {
      method: "POST",
      body: "x",
    });
    expect(await response.text()).toBe("ok");
    expect(calls.map((call) => call.url)).toEqual([
      "https://mirror.example/api",
      "https://cdn.example/final",
    ]);
    expect(calls[1]?.init?.method).toBe("GET");
  });

  test("bundled-host traffic is untouched when no manifest supplied the origin", async () => {
    activate({ rivestream: { mirrors: ["https://mirror.example"] } });
    const { context, calls } = contextWith(() => new Response("ok"));
    await providerFetch(context, "https://bundled.example/api", { headers: { a: "1" } });
    expect(calls[0]?.init?.redirect).toBeUndefined();

    setActiveProviderHotfixManifest(null);
    await providerFetch(context, "https://mirror.example/api");
    expect(calls[1]?.init).toBeUndefined();
  });

  test("a redirect loop stops after the hop limit", async () => {
    activate({ rivestream: { mirrors: ["https://mirror.example"] } });
    const { context, calls } = contextWith(() => redirect("https://mirror.example/again"));
    await expect(providerFetch(context, "https://mirror.example/api")).rejects.toBeInstanceOf(
      ProviderHttpError,
    );
    expect(calls.length).toBe(6);
  });
});
