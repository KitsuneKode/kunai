import { describe, expect, test } from "bun:test";

import {
  buildProviderStatusReport,
  formatProviderStatusTable,
  runProviderStatusCommand,
  type ProviderStatusFetch,
  type ProviderStatusReport,
} from "@/services/providers/run-provider-status";

describe("run-provider-status", () => {
  test("builds report with debrid services unconfigured when no tokens set", async () => {
    const mockFetch: ProviderStatusFetch = async () => new Response("OK", { status: 200 });
    const mockGetEnv = () => undefined;

    const report = await buildProviderStatusReport({
      fetchFn: mockFetch,
      getEnv: mockGetEnv,
      timeoutMs: 100,
    });

    expect(report.total).toBeGreaterThan(5);
    const rd = report.entries.find((e) => e.id === "real-debrid");
    const ad = report.entries.find((e) => e.id === "all-debrid");

    expect(rd?.status).toBe("UNCONFIGURED");
    expect(rd?.configured).toBe(false);
    expect(ad?.status).toBe("UNCONFIGURED");
    expect(ad?.configured).toBe(false);
  });

  test("probes real-debrid as ONLINE when token is valid and user is premium", async () => {
    const mockFetch: ProviderStatusFetch = async (url) => {
      const u = String(url);
      if (u.includes("api.real-debrid.com")) {
        return new Response(
          JSON.stringify({
            id: 1,
            username: "kitsune",
            type: "premium",
            expiration: "2027-01-01",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("OK", { status: 200 });
    };

    const mockGetEnv = (key: string) => {
      if (key === "REAL_DEBRID_API_KEY") return "valid-token";
      return undefined;
    };

    const report = await buildProviderStatusReport({
      fetchFn: mockFetch,
      getEnv: mockGetEnv,
      timeoutMs: 500,
    });

    const rd = report.entries.find((e) => e.id === "real-debrid");
    expect(rd?.status).toBe("ONLINE");
    expect(rd?.configured).toBe(true);
    expect(rd?.notes).toContain("Premium");
    expect(rd?.notes).toContain("kitsune");
  });

  test("handles 401/403 as AUTH_ERROR for debrid services", async () => {
    const mockFetch: ProviderStatusFetch = async (url) => {
      const u = String(url);
      if (u.includes("api.real-debrid.com")) {
        return new Response(JSON.stringify({ error: "bad_token" }), { status: 401 });
      }
      return new Response("OK", { status: 200 });
    };

    const mockGetEnv = (key: string) => {
      if (key === "REAL_DEBRID_API_KEY") return "expired-token";
      return undefined;
    };

    const report = await buildProviderStatusReport({
      fetchFn: mockFetch,
      getEnv: mockGetEnv,
      timeoutMs: 500,
    });

    const rd = report.entries.find((e) => e.id === "real-debrid");
    expect(rd?.status).toBe("AUTH_ERROR");
    expect(rd?.notes).toContain("bad_token");
  });

  test("marks Cloudflare challenges when 403 has cloudflare server header", async () => {
    const mockFetch: ProviderStatusFetch = async (url) => {
      const u = String(url);
      if (u.includes("hianime.at")) {
        return new Response("Just a moment...", {
          status: 403,
          headers: { server: "cloudflare" },
        });
      }
      return new Response("OK", { status: 200 });
    };

    const report = await buildProviderStatusReport({
      fetchFn: mockFetch,
      getEnv: () => undefined,
      timeoutMs: 500,
    });

    const hianime = report.entries.find((e) => e.id === "hianime");
    expect(hianime?.status).toBe("CLOUDFLARE");
    expect(hianime?.notes).toContain("Cloudflare");
  });

  test("formatProviderStatusTable produces aligned table without throwing", () => {
    const sampleReport: ProviderStatusReport = {
      timestamp: "2026-11-03T18:00:00Z",
      total: 3,
      online: 2,
      entries: [
        {
          id: "real-debrid",
          name: "Real-Debrid",
          category: "debrid",
          configured: true,
          status: "ONLINE",
          latencyMs: 120,
          notes: "Premium account (testuser)",
        },
        {
          id: "all-debrid",
          name: "AllDebrid",
          category: "debrid",
          configured: false,
          status: "UNCONFIGURED",
          latencyMs: null,
          notes: "Set ALLDEBRID_API_KEY",
        },
        {
          id: "hianime",
          name: "HiAnime",
          category: "anime",
          configured: true,
          status: "ONLINE",
          latencyMs: 85,
          notes: "HTTP 200",
        },
      ],
    };

    const output = formatProviderStatusTable(sampleReport, { isTty: false, noColor: true });
    expect(output).toContain("Kunai Provider & Debrid Status");
    expect(output).toContain("Real-Debrid");
    expect(output).toContain("AllDebrid");
    expect(output).toContain("HiAnime");
    expect(output).toContain("ONLINE");
    expect(output).toContain("UNCONFIGURED");
  });

  test("runProviderStatusCommand writes JSON when --json is passed", async () => {
    let captured = "";
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      captured += String(chunk);
      return true;
    };

    try {
      const mockFetch: ProviderStatusFetch = async () => new Response("OK", { status: 200 });
      const exitCode = await runProviderStatusCommand(["--json"], {
        fetchFn: mockFetch,
        getEnv: () => undefined,
        json: true,
      });

      expect(exitCode).toBe(0);
      // SAFETY: runProviderStatusCommand writes serialized ProviderStatusReport JSON
      const parsed = JSON.parse(captured) as ProviderStatusReport;
      expect(parsed.total).toBeGreaterThan(0);
      expect(Array.isArray(parsed.entries)).toBe(true);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
