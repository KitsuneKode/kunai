import { describe, expect, test } from "bun:test";

import {
  buildCastMediaCommand,
  decodeCastEnvelope,
  encodeCastEnvelope,
} from "@/services/playback/cast/GoogleCastClient";

describe("Cast V2 protobuf envelope", () => {
  test("round-trips the UTF-8 JSON message fields used by Cast namespaces", () => {
    const envelope = {
      sourceId: "sender-test",
      destinationId: "receiver-0",
      namespace: "urn:x-cast:com.google.cast.receiver",
      payload: JSON.stringify({ type: "GET_STATUS", requestId: 7 }),
    };

    expect(decodeCastEnvelope(encodeCastEnvelope(envelope))).toEqual(envelope);
  });

  test("rejects truncated envelopes", () => {
    expect(decodeCastEnvelope(Uint8Array.from([0x12, 0x20, 0x41]))).toBeNull();
  });

  test("does not attach a stale media session to a new LOAD", () => {
    const load = buildCastMediaCommand({ type: "LOAD", media: { contentId: "test" } }, 17);
    const pause = buildCastMediaCommand({ type: "PAUSE" }, 17);

    expect(load).toEqual({ type: "LOAD", media: { contentId: "test" } });
    expect(pause).toEqual({ type: "PAUSE", mediaSessionId: 17 });
  });
});
