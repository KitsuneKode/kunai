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
import type { RelayTransport } from "../src/types";

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

test("pinned transport rejects Request input instead of silently dropping its state", async () => {
  let resolutions = 0;
  const transport = createPinnedRelayTransport({
    resolveAddresses: async () => {
      resolutions++;
      return [publicAddress];
    },
    request() {
      throw new Error("Request input reached the socket");
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  await expect(
    transport(
      new Request("https://upstream.example.test/data", {
        method: "POST",
        headers: { "x-probe": "must-not-be-dropped" },
        body: "payload",
      }) as never,
    ),
  ).rejects.toMatchObject({ code: "bad-request", status: 400 });
  expect(resolutions).toBe(0);
});

test("pinned transport aborts while DNS resolution is still pending", async () => {
  let resolveDns: ((addresses: readonly [typeof publicAddress]) => void) | undefined;
  let requests = 0;
  const transport = createPinnedRelayTransport({
    resolveAddresses: () =>
      new Promise((resolve) => {
        resolveDns = resolve;
      }),
    request() {
      requests++;
      throw new Error("expired DNS result reached the socket");
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });
  const controller = new AbortController();
  const pending = transport("https://upstream.example.test/data", { signal: controller.signal });
  controller.abort("relay upstream timeout");

  const outcome = await Promise.race([
    pending.then(
      () => "resolved",
      (error: unknown) => (error as { name?: string }).name,
    ),
    Bun.sleep(50).then(() => "still-pending"),
  ]);

  expect(outcome).toBe("AbortError");
  resolveDns?.([publicAddress]);
  await Bun.sleep(0);
  expect(requests).toBe(0);
});

test("pinned transport falls back to the next vetted address for a GET connection failure", async () => {
  const secondAddress = { address: "93.184.216.35", family: 4 as const };
  const attempts: Array<{ hostname: string; host: string | null; servername?: string }> = [];
  const transport = createPinnedRelayTransport({
    resolveAddresses: async () => [publicAddress, secondAddress],
    request(options, onResponse) {
      attempts.push({
        hostname: String(options.hostname),
        host: new Headers(options.headers as HeadersInit).get("host"),
        servername: options.servername,
      });
      const outgoing = writableRequest();
      if (attempts.length === 1) {
        queueMicrotask(() => {
          outgoing.emit(
            "error",
            Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }),
          );
        });
      } else {
        queueMicrotask(() => onResponse(nodeResponse("ok")));
      }
      return outgoing;
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  const response = await transport("https://upstream.example.test/data", { method: "GET" });

  expect(await response.text()).toBe("ok");
  expect(attempts).toEqual([
    {
      hostname: publicAddress.address,
      host: "upstream.example.test",
      servername: "upstream.example.test",
    },
    {
      hostname: secondAddress.address,
      host: "upstream.example.test",
      servername: "upstream.example.test",
    },
  ]);
});

test("pinned transport does not replay POST after an ambiguous connection failure", async () => {
  const attempts: string[] = [];
  const transport = createPinnedRelayTransport({
    resolveAddresses: async () => [publicAddress, { address: "93.184.216.35", family: 4 }],
    request(options) {
      attempts.push(String(options.hostname));
      const outgoing = writableRequest();
      queueMicrotask(() => {
        outgoing.emit(
          "error",
          Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
        );
      });
      return outgoing;
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  await expect(
    transport("https://upstream.example.test/data", { method: "POST", body: "query" }),
  ).rejects.toMatchObject({ code: "ECONNRESET" });
  expect(attempts).toEqual([publicAddress.address]);
});

test("pinned transport does not retry GET after an upstream response has started", async () => {
  const attempts: string[] = [];
  const transport = createPinnedRelayTransport({
    resolveAddresses: async () => [publicAddress, { address: "93.184.216.35", family: 4 }],
    request(options, onResponse) {
      attempts.push(String(options.hostname));
      const incoming = new Readable({
        read() {},
      }) as unknown as import("node:http").IncomingMessage;
      incoming.statusCode = 200;
      incoming.headers = {};
      queueMicrotask(() => {
        onResponse(incoming);
        incoming.emit("error", Object.assign(new Error("response reset"), { code: "ECONNRESET" }));
      });
      return writableRequest();
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  await expect(transport("https://upstream.example.test/data")).rejects.toMatchObject({
    code: "ECONNRESET",
  });
  expect(attempts).toEqual([publicAddress.address]);
});

test("pinned transport does not try another address after cancellation", async () => {
  const attempts: string[] = [];
  const controller = new AbortController();
  const transport = createPinnedRelayTransport({
    resolveAddresses: async () => [publicAddress, { address: "93.184.216.35", family: 4 }],
    request(options) {
      attempts.push(String(options.hostname));
      const outgoing = writableRequest();
      queueMicrotask(() => {
        controller.abort("relay upstream timeout");
        outgoing.emit(
          "error",
          Object.assign(new Error("The operation was aborted"), {
            name: "AbortError",
            code: "ABORT_ERR",
          }),
        );
      });
      return outgoing;
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  await expect(
    transport("https://upstream.example.test/data", { signal: controller.signal }),
  ).rejects.toMatchObject({ code: "ABORT_ERR" });
  expect(attempts).toEqual([publicAddress.address]);
});

test("pinned transport emits only sanitized stable fields for a rejected DNS set", async () => {
  const diagnostics: unknown[] = [];
  const transport = createPinnedRelayTransport({
    providerId: "probe-provider",
    diagnostics: (event) => diagnostics.push(event),
    resolveAddresses: async () => [publicAddress, { address: "127.0.0.1", family: 4 }],
    request() {
      throw new Error("unsafe DNS set reached the socket");
    },
    maxRequestBodyBytes: 128,
    maxResponseBodyBytes: 64,
  });

  await expect(
    transport("https://upstream.example.test/private-path?token=query-secret", {
      method: "POST",
      headers: { "x-session-token": "header-secret" },
      body: "body-secret",
    }),
  ).rejects.toMatchObject({ code: "host-not-allowed" });

  expect(diagnostics).toEqual([
    {
      event: "dns-rejected",
      providerId: "probe-provider",
      hostname: "upstream.example.test",
      answerCount: 2,
      families: [4],
      code: "NON_PUBLIC_ADDRESS",
    },
  ]);
  const serialized = JSON.stringify(diagnostics);
  expect(serialized).not.toContain("private-path");
  expect(serialized).not.toContain("query-secret");
  expect(serialized).not.toContain("header-secret");
  expect(serialized).not.toContain("body-secret");
  expect(serialized).not.toContain("127.0.0.1");
});

test("pinned transport diagnostics omit raw connection errors during safe fallback", async () => {
  const diagnostics: unknown[] = [];
  let attempts = 0;
  const transport = createPinnedRelayTransport({
    providerId: "probe-provider",
    diagnostics: (event) => diagnostics.push(event),
    resolveAddresses: async () => [publicAddress, { address: "93.184.216.35", family: 4 }],
    request(_options, onResponse) {
      attempts++;
      const outgoing = writableRequest();
      if (attempts === 1) {
        queueMicrotask(() => {
          outgoing.emit(
            "error",
            Object.assign(new Error("raw-error-secret"), { code: "ECONNREFUSED" }),
          );
        });
      } else {
        queueMicrotask(() => onResponse(nodeResponse("ok")));
      }
      return outgoing;
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  const response = await transport("https://upstream.example.test/data");

  expect(response.status).toBe(200);
  expect(diagnostics).toEqual([
    {
      event: "connection-failed",
      providerId: "probe-provider",
      hostname: "upstream.example.test",
      family: 4,
      attempt: 1,
      answerCount: 2,
      code: "ECONNREFUSED",
    },
  ]);
  expect(JSON.stringify(diagnostics)).not.toContain("raw-error-secret");
  expect(JSON.stringify(diagnostics)).not.toContain(publicAddress.address);
});

test("pinned transport diagnostics do not expose a literal upstream address", async () => {
  const diagnostics: unknown[] = [];
  const transport = createPinnedRelayTransport({
    providerId: "probe-provider",
    diagnostics: (event) => diagnostics.push(event),
    request() {
      const outgoing = writableRequest();
      queueMicrotask(() => {
        outgoing.emit(
          "error",
          Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }),
        );
      });
      return outgoing;
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  await expect(transport(`https://${publicAddress.address}/data`)).rejects.toMatchObject({
    code: "ECONNREFUSED",
  });
  expect(diagnostics).toEqual([
    {
      event: "connection-failed",
      providerId: "probe-provider",
      hostname: "ip-literal",
      family: 4,
      attempt: 1,
      answerCount: 1,
      code: "ECONNREFUSED",
    },
  ]);
  expect(JSON.stringify(diagnostics)).not.toContain(publicAddress.address);
});

test("pinned transport emits a sanitized diagnostic when DNS resolution fails", async () => {
  const diagnostics: unknown[] = [];
  const transport = createPinnedRelayTransport({
    providerId: "probe-provider",
    diagnostics: (event) => diagnostics.push(event),
    resolveAddresses: async () => {
      throw Object.assign(new Error("raw-dns-secret"), { code: "EAI_AGAIN" });
    },
    request() {
      throw new Error("failed DNS reached the socket");
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  await expect(transport("https://upstream.example.test/data")).rejects.toMatchObject({
    code: "EAI_AGAIN",
  });
  expect(diagnostics).toEqual([
    {
      event: "dns-failed",
      providerId: "probe-provider",
      hostname: "upstream.example.test",
      code: "EAI_AGAIN",
    },
  ]);
  expect(JSON.stringify(diagnostics)).not.toContain("raw-dns-secret");
});

test("pinned transport diagnoses an empty DNS answer without opening a socket", async () => {
  const diagnostics: unknown[] = [];
  const transport = createPinnedRelayTransport({
    providerId: "probe-provider",
    diagnostics: (event) => diagnostics.push(event),
    resolveAddresses: async () => [],
    request() {
      throw new Error("empty DNS answer reached the socket");
    },
    maxRequestBodyBytes: 64,
    maxResponseBodyBytes: 64,
  });

  await expect(transport("https://upstream.example.test/data")).rejects.toMatchObject({
    code: "upstream-error",
  });
  expect(diagnostics).toEqual([
    {
      event: "dns-failed",
      providerId: "probe-provider",
      hostname: "upstream.example.test",
      code: "NO_ADDRESSES",
    },
  ]);
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

function writableRequest(): ClientRequest {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  }) as unknown as ClientRequest;
}

function nodeResponse(body: string): import("node:http").IncomingMessage {
  const incoming = Readable.from([
    Buffer.from(body),
  ]) as unknown as import("node:http").IncomingMessage;
  incoming.statusCode = 200;
  incoming.headers = {};
  return incoming;
}

// Compile-time proof that resolver fixtures return the complete DNS answer set.
const _resolverContract: RelayAddressResolver = async () => [publicAddress];
void _resolverContract;

const _relayTransportUrlInput: Parameters<RelayTransport>[0] = new URL("https://example.test");
// @ts-expect-error Relay transport inputs cannot carry implicit Request state.
const _relayTransportRequestInput: Parameters<RelayTransport>[0] = new Request(
  "https://example.test",
);
void _relayTransportUrlInput;
void _relayTransportRequestInput;
