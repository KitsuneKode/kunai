const baseUrl = (process.env.KUNAI_RELAY_BASE_URL ?? process.env.RELAY_URL ?? "").replace(
  /\/$/,
  "",
);
const token = process.env.KUNAI_RELAY_TOKEN ?? process.env.RELAY_TOKEN ?? "";

if (!baseUrl) {
  console.error("Set KUNAI_RELAY_BASE_URL or RELAY_URL");
  process.exit(1);
}

type Check = {
  readonly name: string;
  readonly run: () => Promise<void>;
};

const checks: Check[] = [
  {
    name: "health",
    async run() {
      const response = await fetch(`${baseUrl}/health`);
      if (!response.ok) throw new Error(`health returned ${response.status}`);
      const body = (await response.json()) as { ok?: boolean; service?: string };
      if (!body.ok || body.service !== "kunai-relay") {
        throw new Error(`unexpected health body: ${JSON.stringify(body)}`);
      }
    },
  },
  {
    name: "rpc-unauthorized-without-token",
    async run() {
      const response = await fetch(`${baseUrl}/rpc/allanime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "GET",
          upstreamUrl: "https://api.allanime.day/api",
        }),
      });
      if (response.status !== 401) {
        throw new Error(`expected 401 without token, got ${response.status}`);
      }
    },
  },
];

if (token) {
  checks.push({
    name: "rpc-host-not-allowed",
    async run() {
      const response = await fetch(`${baseUrl}/rpc/allanime`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          method: "GET",
          upstreamUrl: "https://example.com/not-allowed",
        }),
      });
      if (response.status !== 403) {
        throw new Error(`expected 403 for disallowed host, got ${response.status}`);
      }
    },
  });
}

let failed = 0;
for (const check of checks) {
  try {
    await check.run();
    console.log(`ok  ${check.name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`fail ${check.name}: ${message}`);
  }
}

if (failed > 0) process.exit(1);
