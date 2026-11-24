import { describe, expect, test } from "bun:test";

import { PlaybackLedgerSlot } from "@/app/playback/playback-ledger-slot";
import type { PlaybackHistoryLedger } from "@/services/continuation/playback-history-ledger";

function fakeLedger(log: string[], name: string): PlaybackHistoryLedger {
  const ledger: Pick<PlaybackHistoryLedger, "checkpoint" | "discard"> = {
    checkpoint: () => log.push(`${name}:checkpoint`),
    discard: () => log.push(`${name}:discard`),
  };
  // SAFETY: the slot only ever calls checkpoint() and discard() on its ledger.
  return ledger as PlaybackHistoryLedger;
}

function checkpointRegistry() {
  const callbacks = new Set<() => void>();
  return {
    register: (callback: () => void) => {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    flush: () => {
      for (const callback of callbacks) callback();
    },
    size: () => callbacks.size,
  };
}

describe("PlaybackLedgerSlot", () => {
  test("a shutdown flush checkpoints the attached ledger", () => {
    const log: string[] = [];
    const registry = checkpointRegistry();
    const slot = new PlaybackLedgerSlot();
    const ledger = fakeLedger(log, "a");

    slot.attach(ledger, registry.register);
    registry.flush();

    expect(slot.current).toBe(ledger);
    expect(log).toEqual(["a:checkpoint"]);
  });

  test("release forgets the ledger and drops only this slot's registration", () => {
    const log: string[] = [];
    const registry = checkpointRegistry();
    const other = registry.register(() => log.push("other:checkpoint"));
    const slot = new PlaybackLedgerSlot();
    slot.attach(fakeLedger(log, "a"), registry.register);

    slot.release();
    registry.flush();

    expect(slot.current).toBeNull();
    expect(log).toEqual(["other:checkpoint"]);
    expect(registry.size()).toBe(1);
    other();
  });

  test("discard drops pending writes before releasing", () => {
    const log: string[] = [];
    const registry = checkpointRegistry();
    const slot = new PlaybackLedgerSlot();
    slot.attach(fakeLedger(log, "a"), registry.register);

    slot.discard();
    slot.discard();
    registry.flush();

    expect(slot.current).toBeNull();
    expect(log).toEqual(["a:discard"]);
    expect(registry.size()).toBe(0);
  });
});
