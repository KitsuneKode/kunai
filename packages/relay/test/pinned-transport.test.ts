import { expect, test } from "bun:test";
import type { ClientRequest } from "node:http";
import { Readable, Writable } from "node:stream";

import { RelayValidationError } from "../src/forward-headers";
import {
  createPinnedRelayTransport,
  isPublicRelayAddress,
  type RelayAddressResolver,
  type RelayNodeRequest,
  type RelayNodeRequestOptions,
} from "../src/pinned-transport";

const publicAddress = { address: "93.184.216.34", family: 4 as const };

test.each([
  "0.1.2.3",
  "10.0.0.1",
  "100.64.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.0.0.1",
  "192.0.2.1",
  "192.31.196.1",
  "192.52.193.1",
  "192.88.99.1",
  "192.168.0.1",
  "192.175.48.1",
  "198.18.0.1",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "240.0.0.1",
  "::",
  "::1",
  "fe80::1",
  "fec0::1",
  "fc00::1",
  "2001::1",
  "2001:db8::1",
  "2002::1",
  "3fff::1",
  "ff02::1",
])("isPublicRelayAddress rejects non-public address %s", (address) => {
  expect(isPublicRelayAddress(address)).toBe(false);
});

test.each([
  "8.8.8.8",
  "93.184.216.34",
  "100.63.255.255",
  "100.128.0.1",
  "172.32.0.1",
  "2606:4700:4700::1111",
  "::ffff:8.8.8.8",
])("isPublicRelayAddress accepts public address %s", (address) => {
  expect(isPublicRelayAddress(address)).toBe(true);
});

test("pinned transport rejects a mixed public and loopback DNS answer set", async () => {
  let requests = 0;
  const transport = createPinnedRelayTransport({
    resolveAddresses: async () => [publicAddress, { address: "127.0.0.1", family: 4 }],
    request() {
      requests++;
      throw new Error("unsafe answer set reached the socket");
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  await expect(transport("http://upstream.example.test/data")).rejects.toMatchObject({
    code: "host-not-allowed",
    status: 403,
  });
  expect(requests).toBe(0);
});

test("pinned transport rejects a mixed public and link-local A/AAAA answer set", async () => {
  let requests = 0;
  const transport = createPinnedRelayTransport({
    resolveAddresses: async () => [publicAddress, { address: "fe80::1", family: 6 }],
    request() {
      requests++;
      throw new Error("unsafe answer set reached the socket");
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  await expect(transport("https://upstream.example.test/data")).rejects.toBeInstanceOf(
    RelayValidationError,
  );
  expect(requests).toBe(0);
});

test("pinned transport prevents DNS rebinding by dialing the vetted address and preserving HTTP Host", async () => {
  let dialedHostname: string | undefined;
  let hostHeader = "";
  const transport = createPinnedRelayTransport({
    resolveAddresses: async () => [publicAddress],
    request: inspectRequest((options) => {
      dialedHostname = String(options.hostname);
      hostHeader = new Headers(options.headers as HeadersInit).get("host") ?? "";
    }),
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 128,
  });

  const response = await transport("http://upstream.example.test:8080/data");

  expect(response.status).toBe(200);
  expect(dialedHostname).toBe(publicAddress.address);
  expect(String(hostHeader)).toBe("upstream.example.test:8080");
});

test("pinned HTTPS transport preserves the original hostname for TLS SNI", async () => {
  let servername: string | undefined;
  let dialedHostname: string | undefined;
  const transport = createPinnedRelayTransport({
    resolveAddresses: async () => [publicAddress],
    request: inspectRequest((options) => {
      dialedHostname = String(options.hostname);
      servername = options.servername;
    }),
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  const response = await transport("https://upstream.example.test/data");

  expect(response.status).toBe(200);
  expect(dialedHostname).toBe(publicAddress.address);
  expect(servername).toBe("upstream.example.test");
});

test("pinned transport rejects an oversized request before DNS resolution", async () => {
  let resolutions = 0;
  const transport = createPinnedRelayTransport({
    resolveAddresses: async () => {
      resolutions++;
      return [publicAddress];
    },
    request() {
      throw new Error("oversized request reached the socket");
    },
    maxRequestBodyBytes: 8,
    maxResponseBodyBytes: 64,
  });

  await expect(
    transport("http://upstream.example.test/data", { method: "POST", body: "123456789" }),
  ).rejects.toMatchObject({ code: "body-too-large", status: 413 });
  expect(resolutions).toBe(0);
});

test("pinned transport destroys an upstream response as soon as its byte ceiling is crossed", async () => {
  const transport = createPinnedRelayTransport({
    resolveAddresses: async () => [publicAddress],
    request: inspectRequest(() => {}, "1234567890"),
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 8,
  });

  await expect(transport("http://upstream.example.test/data")).rejects.toMatchObject({
    code: "response-too-large",
    status: 502,
  });
});

test("pinned transport refuses an unsafe literal without consulting DNS", async () => {
  let resolutions = 0;
  const transport = createPinnedRelayTransport({
    resolveAddresses: async () => {
      resolutions++;
      return [publicAddress];
    },
    request() {
      throw new Error("unsafe literal reached the socket");
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  await expect(transport("http://169.254.169.254/latest/meta-data")).rejects.toMatchObject({
    code: "host-not-allowed",
  });
  expect(resolutions).toBe(0);
});

function inspectRequest(
  inspect: (options: RelayNodeRequestOptions) => void,
  body = "ok",
): RelayNodeRequest {
  return (options, onResponse): ClientRequest => {
    inspect(options);
    const incoming = Readable.from([
      Buffer.from(body),
    ]) as unknown as import("node:http").IncomingMessage;
    incoming.statusCode = 200;
    incoming.headers = {};
    queueMicrotask(() => onResponse(incoming));
    return new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }) as unknown as ClientRequest;
  };
}

// Compile-time proof that resolver fixtures return the complete DNS answer set.
const _resolverContract: RelayAddressResolver = async () => [publicAddress];
void _resolverContract;
