import { expect, test } from "bun:test";

import {
  createRelayDevServerOptions,
  resolveRelayDevelopmentPolicy,
} from "../../src/relay-runtime-policy";

test("relay development defaults to numeric IPv4 loopback on port 8787", () => {
  expect(resolveRelayDevelopmentPolicy({})).toEqual({
    hostname: "127.0.0.1",
    port: 8787,
    authorization: { mode: "local-loopback" },
    corsAllowedOrigins: [],
  });
});

test.each(["127.0.0.1", "::1"])("relay development permits tokenless bind to %s", (hostname) => {
  expect(resolveRelayDevelopmentPolicy({ RELAY_HOST: hostname })).toEqual({
    hostname,
    port: 8787,
    authorization: { mode: "local-loopback" },
    corsAllowedOrigins: [],
  });
});

test.each(["", "   "])("relay development treats a blank host as the safe default", (host) => {
  expect(resolveRelayDevelopmentPolicy({ RELAY_HOST: host })).toEqual({
    hostname: "127.0.0.1",
    port: 8787,
    authorization: { mode: "local-loopback" },
    corsAllowedOrigins: [],
  });
});

test.each(["0.0.0.0", "::", "localhost", "192.168.1.20"])(
  "relay development rejects tokenless non-loopback bind to %s",
  (hostname) => {
    expect(() => resolveRelayDevelopmentPolicy({ RELAY_HOST: hostname })).toThrow("RELAY_TOKEN");
  },
);

test.each([undefined, "", "   "])(
  "relay development rejects a non-loopback bind with unusable token %s",
  (token) => {
    expect(() =>
      resolveRelayDevelopmentPolicy({ RELAY_HOST: "0.0.0.0", RELAY_TOKEN: token }),
    ).toThrow("RELAY_TOKEN");
  },
);

test.each(["0.0.0.0", "::", "localhost", "192.168.1.20"])(
  "relay development uses bearer authorization for tokened bind to %s",
  (hostname) => {
    expect(
      resolveRelayDevelopmentPolicy({ RELAY_HOST: ` ${hostname} `, RELAY_TOKEN: " secret " }),
    ).toEqual({
      hostname,
      port: 8787,
      authorization: { mode: "bearer", token: "secret" },
      corsAllowedOrigins: [],
    });
  },
);

test("relay development uses bearer authorization when loopback has a token", () => {
  expect(resolveRelayDevelopmentPolicy({ RELAY_TOKEN: "secret" })).toEqual({
    hostname: "127.0.0.1",
    port: 8787,
    authorization: { mode: "bearer", token: "secret" },
    corsAllowedOrigins: [],
  });
});

test.each(["0", "-1", "65536", "8787.5", "abc"])(
  "relay development rejects invalid port %s",
  (port) => {
    expect(() => resolveRelayDevelopmentPolicy({ PORT: port })).toThrow("PORT");
  },
);

test("relay development carries resolved host, port, and auth into server behavior", async () => {
  const policy = resolveRelayDevelopmentPolicy({
    RELAY_HOST: "0.0.0.0",
    RELAY_TOKEN: "secret",
    PORT: "9000",
  });
  const options = createRelayDevServerOptions(policy);

  expect(options.hostname).toBe("0.0.0.0");
  expect(options.port).toBe(9000);

  const response = await options.fetch(
    new Request("http://relay.test/rpc/allanime", {
      method: "POST",
      body: JSON.stringify({
        method: "GET",
        upstreamUrl: "https://api.allanime.day/api",
      }),
    }),
  );
  expect(response.status).toBe(401);
});

test("relay development parses RELAY_CORS_ORIGINS into an origin allowlist", () => {
  const policy = resolveRelayDevelopmentPolicy({
    RELAY_CORS_ORIGINS: " https://app.example , http://localhost:5173 ,, ",
  });
  expect(policy.corsAllowedOrigins).toEqual(["https://app.example", "http://localhost:5173"]);
});

test.each([undefined, "", "   ", " , ,"])(
  "relay development keeps CORS off for unusable input %s",
  (origins) => {
    expect(
      resolveRelayDevelopmentPolicy({ RELAY_CORS_ORIGINS: origins }).corsAllowedOrigins,
    ).toEqual([]);
  },
);

test.each(["not a url", "https://app.example/path", "https://app.example?q=1"])(
  "relay development rejects non-origin entry %s",
  (origin) => {
    expect(() => resolveRelayDevelopmentPolicy({ RELAY_CORS_ORIGINS: origin })).toThrow(
      "RELAY_CORS_ORIGINS",
    );
  },
);
