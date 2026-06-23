import { expect, test } from "bun:test";

import { createRelayFetchPort } from "../src/create-relay-fetch-port";
import { buildProviderRelayRegistry } from "../src/registry";
import {
  isProviderRelayEnabledForProvider,
  resolveEffectiveProviderRelayConfig,
} from "../src/resolve-relay-config";

const registry = buildProviderRelayRegistry([
  {
    providerId: "allanime",
    manifest: {
      relayProfile: {
        upstreamHosts: ["api.allanime.day"],
      },
    },
  },
] as never);

test("resolveEffectiveProviderRelayConfig respects enabled flag and env overrides", () => {
  const effective = resolveEffectiveProviderRelayConfig(
    { baseUrl: "https://relay.example", enabled: false, token: "cfg" },
    { baseUrl: "https://env.example", token: "env" },
  );
  expect(effective.active).toBe(false);
  expect(effective.baseUrl).toBeUndefined();

  const active = resolveEffectiveProviderRelayConfig(
    { baseUrl: "https://relay.example/", enabled: true },
    {},
  );
  expect(active.active).toBe(true);
  expect(active.baseUrl).toBe("https://relay.example");

  const envWins = resolveEffectiveProviderRelayConfig(
    { baseUrl: "https://relay.example" },
    { baseUrl: "https://env.example/" },
  );
  expect(envWins.baseUrl).toBe("https://env.example");
  expect(envWins.active).toBe(true);
});

test("isProviderRelayEnabledForProvider defaults to enabled", () => {
  expect(isProviderRelayEnabledForProvider({}, "allanime")).toBe(true);
  expect(
    isProviderRelayEnabledForProvider({ providers: { allanime: { enabled: false } } }, "allanime"),
  ).toBe(false);
});

test("createRelayFetchPort skips relay when globally disabled", async () => {
  let direct = false;
  const port = createRelayFetchPort({
    relayConfig: { baseUrl: "https://relay.example", enabled: false },
    registry,
    async fetch(input) {
      direct = String(input) === "https://api.allanime.day/api";
      return Response.json({ direct: true });
    },
  });

  await port.fetch("https://api.allanime.day/api");
  expect(direct).toBe(true);
});
