import { expect, test } from "bun:test";

import { getKannaPaused, setKannaPaused, subscribeKannaMotion } from "../lib/kanna-motion";

test("all readers share pause/resume and disposed readers are not notified", () => {
  const observed: boolean[][] = [[], []];
  const stopA = subscribeKannaMotion(() => observed[0]!.push(getKannaPaused()));
  const stopB = subscribeKannaMotion(() => observed[1]!.push(getKannaPaused()));
  try {
    setKannaPaused(true);
    setKannaPaused(true);
    expect(observed).toEqual([[true], [true]]);
    stopA();
    setKannaPaused(false);
    expect(observed).toEqual([[true], [true, false]]);
  } finally {
    stopA();
    stopB();
    setKannaPaused(false);
  }
});
