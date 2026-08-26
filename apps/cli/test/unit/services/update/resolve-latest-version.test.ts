import { describe, expect, test } from "bun:test";

import type { MetadataFetch } from "@/services/update/latest-version";
import { resolveLatestVersion } from "@/services/update/resolve-latest-version";

describe("resolveLatestVersion", () => {
  test("uses the injected fetch and deadline for package-manager channels", async () => {
    const controller = new AbortController();
    let requestUrl = "";
    let requestSignal: AbortSignal | null | undefined;
    const fetchImpl: MetadataFetch = async (input, init) => {
      requestUrl = String(input);
      requestSignal = init?.signal;
      return new Response(JSON.stringify({ version: "0.3.0" }), { status: 200 });
    };

    expect(await resolveLatestVersion("npm-global", fetchImpl, controller.signal)).toBe("0.3.0");
    expect(requestUrl).toBe("https://registry.npmjs.org/@kitsunekode%2fkunai/latest");
    expect(requestSignal).toBe(controller.signal);
  });

  test("rejects malformed versions from the npm registry", async () => {
    const fetchImpl: MetadataFetch = async () =>
      new Response(JSON.stringify({ version: "0.3.0-beta.1" }), {
        status: 200,
      });

    expect(await resolveLatestVersion("bun-global", fetchImpl)).toBeNull();
  });

  test("returns null when package metadata lookup fails", async () => {
    const fetchImpl: MetadataFetch = async () => {
      throw new Error("network down");
    };

    expect(await resolveLatestVersion("npm-global", fetchImpl)).toBeNull();
  });
});
