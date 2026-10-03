import { describe, expect, test } from "bun:test";

import { fetchGuardedRemoteTarget } from "@/infra/net/guarded-remote-fetch";

function response(status: number, headers?: Record<string, string>): Response {
  return new Response("", { status, headers });
}

function fakeFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    return impl(url, init ?? {});
    // SAFETY: the stub implements the fetch call shape the guard exercises; preconnect is unused here.
  }) as typeof fetch;
}

describe("guarded remote fetch", () => {
  test("refuses private literal targets before any request", async () => {
    let called = false;
    const impl = fakeFetch(() => {
      called = true;
      return response(200);
    });

    await expect(
      fetchGuardedRemoteTarget("http://169.254.169.254/x", {}, { fetchImpl: impl }),
    ).rejects.toThrow("Blocked unsafe target");
    expect(called).toBe(false);
  });

  test("refuses a redirect into private address space", async () => {
    const urls: string[] = [];
    const impl = fakeFetch((url) => {
      urls.push(url);
      if (url === "http://cdn.example/poster.jpg") {
        return response(302, { location: "http://192.168.1.1/admin" });
      }
      return response(200);
    });

    // http source so the literal check — not the downgrade rule — fires.
    await expect(
      fetchGuardedRemoteTarget("http://cdn.example/poster.jpg", {}, { fetchImpl: impl }),
    ).rejects.toThrow("Blocked unsafe target");
    expect(urls).toEqual(["http://cdn.example/poster.jpg"]);
  });

  test("follows a public redirect hop to a public target", async () => {
    const urls: string[] = [];
    const impl = fakeFetch((url) => {
      urls.push(url);
      if (url === "https://cdn.example/a.jpg") {
        return response(301, { location: "https://img.example/b.jpg" });
      }
      return response(200);
    });

    const res = await fetchGuardedRemoteTarget(
      "https://cdn.example/a.jpg",
      {},
      { fetchImpl: impl },
    );
    expect(res.status).toBe(200);
    expect(urls).toEqual(["https://cdn.example/a.jpg", "https://img.example/b.jpg"]);
  });

  test("strips credential headers when a redirect crosses origins", async () => {
    const seen: Headers[] = [];
    const impl = fakeFetch((url, init) => {
      seen.push(new Headers(init.headers));
      if (url === "https://cdn.example/a.jpg") {
        return response(302, { location: "https://other.example/b.jpg" });
      }
      return response(200);
    });

    await fetchGuardedRemoteTarget(
      "https://cdn.example/a.jpg",
      { headers: { cookie: "s=1", authorization: "Bearer t", accept: "image/*" } },
      { fetchImpl: impl },
    );

    const hop2 = seen[1];
    expect(hop2).toBeDefined();
    if (!hop2) return;
    expect(hop2.get("cookie")).toBeNull();
    expect(hop2.get("authorization")).toBeNull();
    expect(hop2.get("accept")).toBe("image/*");
  });

  test("rejects an https downgrade mid-redirect", async () => {
    const impl = fakeFetch((url) =>
      url === "https://cdn.example/a.jpg"
        ? response(302, { location: "http://cdn.example/a.jpg" })
        : response(200),
    );

    await expect(
      fetchGuardedRemoteTarget("https://cdn.example/a.jpg", {}, { fetchImpl: impl }),
    ).rejects.toThrow("Blocked https downgrade");
  });

  test("httpsOnly refuses a non-https initial target and redirect", async () => {
    const impl = fakeFetch(() => response(200));
    await expect(
      fetchGuardedRemoteTarget(
        "http://cdn.example/a.jpg",
        {},
        {
          fetchImpl: impl,
          httpsOnly: true,
        },
      ),
    ).rejects.toThrow("Blocked non-https target");
  });

  test("non-redirect responses return without extra hops", async () => {
    let calls = 0;
    const impl = fakeFetch(() => {
      calls += 1;
      return response(404);
    });

    const res = await fetchGuardedRemoteTarget("https://cdn.example/x", {}, { fetchImpl: impl });
    expect(res.status).toBe(404);
    expect(calls).toBe(1);
  });

  test("caps redirect chains", async () => {
    const impl = fakeFetch(() => response(302, { location: "https://cdn.example/next" }));
    await expect(
      fetchGuardedRemoteTarget("https://cdn.example/start", {}, { fetchImpl: impl, maxHops: 2 }),
    ).rejects.toThrow("Redirect chain exceeded");
  });
});
