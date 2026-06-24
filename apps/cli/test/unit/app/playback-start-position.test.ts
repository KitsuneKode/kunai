import { describe, expect, it } from "bun:test";

import { resolveBootstrapStartSeconds } from "@/app/playback-resume-from-history";

describe("resolveBootstrapStartSeconds", () => {
  it("prefers the larger of shared vs history", () => {
    expect(resolveBootstrapStartSeconds({ sharedStartSeconds: 90, historyResumeSeconds: 30 })).toBe(
      90,
    );
    expect(
      resolveBootstrapStartSeconds({ sharedStartSeconds: 10, historyResumeSeconds: 120 }),
    ).toBe(120);
  });

  it("returns shared when no history", () => {
    expect(resolveBootstrapStartSeconds({ sharedStartSeconds: 45 })).toBe(45);
  });

  it("returns undefined when neither present", () => {
    expect(resolveBootstrapStartSeconds({})).toBeUndefined();
  });
});
