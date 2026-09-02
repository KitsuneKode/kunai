import { expect, test } from "bun:test";

import { filterForwardHeaders } from "../src/forward-headers";

/**
 * VidLink answers `deliveryType: "file"` without `x-playback-environment:
 * webkit` — bcdn MP4s flagged `requiresProxy` that 429 every non-browser
 * client. The relay dropped the header, so a relayed VidLink lane resolved and
 * then would not play, while the same request direct played fine. The relay
 * being the only difference is what made it hard to see.
 */
test("forwards the VidLink playback environment header", () => {
  const forwarded = filterForwardHeaders({
    "x-playback-environment": "webkit",
    "user-agent": "kunai",
  });

  expect(forwarded["x-playback-environment"]).toBe("webkit");
});

test("still drops credentials and unlisted headers", () => {
  const forwarded = filterForwardHeaders({
    authorization: "Bearer secret",
    cookie: "session=secret",
    "x-not-allowed": "nope",
    connection: "keep-alive",
    referer: "https://example.test/",
  });

  expect(forwarded.authorization).toBeUndefined();
  expect(forwarded.cookie).toBeUndefined();
  expect(forwarded["x-not-allowed"]).toBeUndefined();
  expect(forwarded.connection).toBeUndefined();
  expect(forwarded.Referer).toBe("https://example.test/");
});
