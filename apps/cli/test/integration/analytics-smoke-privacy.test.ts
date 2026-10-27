import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// Execute the actual entrypoint with fetch replaced before import. Even its
// unsafe old default cannot reach a real endpoint in this regression test.
async function smoke(endpoint?: string, status = 204, testEndpoint = endpoint, optIn = "1") {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
    const requests = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url: String(url), redirect: init.redirect ?? null, digest: /^[a-f0-9]{64}$/.test(body.installId) });
      return new Response(null, { status: 'title' in body ? 400 : ${status} });
    };
    process.on('exit', () => console.log(JSON.stringify({ requests })));
    await import('./test/live/analytics-endpoint.smoke.ts');
  `,
    ],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: {
        ...process.env,
        KUNAI_LIVE_ANALYTICS: optIn,
        KUNAI_ANALYTICS_URL: endpoint ?? "",
        KUNAI_ANALYTICS_TEST_URL: testEndpoint ?? "",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const lines = out.trim().split("\n");
  const requests = JSON.parse(lines.at(-1) ?? "{}").requests;
  return { code, err, requests, report: JSON.parse(lines.at(-2) ?? "{}") };
}

for (const endpoint of [
  undefined,
  "https://analytics.kunai.kitsunekode.in/api/ping",
  "https://self-hosted.example.test/api/ping",
  "http://127.0.0.1.evil.test:3000/api/ping",
  "http://user:secret@127.0.0.1:3000/api/ping",
  "http://127.0.0.1/api/ping",
  "http://127.0.0.1:3000/api/ping?target=production",
  "http://127.0.0.1:3000/api/ping#fragment",
  "http://localhost:3000/api/ping",
]) {
  test(`analytics smoke refuses missing or non-fixture endpoint ${endpoint ? new URL(endpoint).hostname : "default"}`, async () => {
    const result = await smoke(endpoint);
    expect(result.requests).toEqual([]);
    expect(result.code).toBe(1);
  });
}

test.each(["http://127.0.0.1:43199/api/ping", "http://[::1]:43199/api/ping"])(
  "analytics smoke awaits delivery and refuses redirects at %s",
  async (endpoint) => {
    const result = await smoke(endpoint);
    expect(result.code, result.err).toBe(0);
    expect(result.requests).toEqual([
      { url: endpoint, redirect: "error", digest: true },
      { url: endpoint, redirect: "error", digest: true },
    ]);
    expect(result.report.pingStatus).toBe(204);
  },
);

test("analytics smoke never uses the normal endpoint override as a test endpoint", async () => {
  const result = await smoke("http://127.0.0.1:43199/api/ping", 204, "");
  expect(result.requests).toEqual([]);
  expect(result.code).toBe(1);
});

test("analytics smoke skips without explicit opt-in and sends nothing", async () => {
  const result = await smoke(undefined, 204, undefined, "0");
  expect(result.requests).toEqual([]);
  expect(result.code).toBe(0);
  expect(result.report.skipped).toBe(true);
});

test("analytics smoke fails when its local fixture rejects the valid ping", async () => {
  const result = await smoke("http://127.0.0.1:43199/api/ping", 503);
  expect(result.code).toBe(1);
  expect(result.report.failures).toContain("ping-not-accepted:503");
});
