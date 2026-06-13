import { expect, test } from "bun:test";

import { exceedsMemoryCap, memoryCapMb, parseVmRssKb } from "@/infra/diagnostics/memory-watchdog";

test("parseVmRssKb extracts VmRSS from /proc status text", () => {
  const status = "Name:\tbun\nVmPeak:\t  900000 kB\nVmRSS:\t  123456 kB\nThreads:\t5\n";
  expect(parseVmRssKb(status)).toBe(123456);
});

test("parseVmRssKb returns null when VmRSS is absent", () => {
  expect(parseVmRssKb("Name:\tbun\nThreads:\t5\n")).toBeNull();
});

test("exceedsMemoryCap compares RSS bytes against the MB cap", () => {
  expect(exceedsMemoryCap(2_000 * 1048576, 1536)).toBe(true);
  expect(exceedsMemoryCap(500 * 1048576, 1536)).toBe(false);
  expect(exceedsMemoryCap(1536 * 1048576, 1536)).toBe(true); // boundary inclusive
});

test("memoryCapMb honors KUNAI_MEM_CAP_MB, else defaults", () => {
  expect(memoryCapMb({ KUNAI_MEM_CAP_MB: "2048" })).toBe(2048);
  expect(memoryCapMb({})).toBe(1536);
  expect(memoryCapMb({ KUNAI_MEM_CAP_MB: "garbage" })).toBe(1536);
  expect(memoryCapMb({ KUNAI_MEM_CAP_MB: "0" })).toBe(1536);
});
