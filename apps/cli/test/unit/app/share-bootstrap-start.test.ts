import { describe, expect, it } from "bun:test";

import {
  consumeShareBootstrapStartSeconds,
  primeShareBootstrapStartSeconds,
  setShareBootstrapStartSeconds,
} from "@/app/share-bootstrap-start";

describe("share bootstrap start mailbox", () => {
  it("stores and consumes a one-shot start position", () => {
    setShareBootstrapStartSeconds(120);
    expect(consumeShareBootstrapStartSeconds()).toBe(120);
    expect(consumeShareBootstrapStartSeconds()).toBeUndefined();
  });

  it("ignores undefined primes", () => {
    setShareBootstrapStartSeconds(45);
    primeShareBootstrapStartSeconds(undefined);
    expect(consumeShareBootstrapStartSeconds()).toBe(45);
  });

  it("overwrites with the latest primed value", () => {
    primeShareBootstrapStartSeconds(10);
    primeShareBootstrapStartSeconds(99);
    expect(consumeShareBootstrapStartSeconds()).toBe(99);
  });
});
