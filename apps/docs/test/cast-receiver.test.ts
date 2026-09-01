import { expect, test } from "bun:test";

import { GET } from "../app/cast-receiver/route";

test("custom Cast receiver publishes the versioned clock contract", async () => {
  const response = GET();
  const html = await response.text();

  expect(response.headers.get("content-type")).toContain("text/html");
  expect(response.headers.get("content-security-policy")).toContain("www.gstatic.com");
  expect(html).toContain("cast_receiver_framework.js");
  expect(html).toContain("urn:x-cast:dev.kunai.receiver.v1");
  expect(html).toContain("Experimental audio-only receiver");
  expect(html).toContain("TIME_UPDATE");
});
