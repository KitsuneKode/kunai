import { describe, expect, it } from "bun:test";

import { calendarSessionStatusForTransition } from "@/app-shell/hooks/use-calendar-route";

describe("calendarSessionStatusForTransition", () => {
  it("reports a load starting or retrying as loading", () => {
    expect(calendarSessionStatusForTransition(null, "loading")).toBe("loading");
    expect(calendarSessionStatusForTransition("error", "retrying")).toBe("loading");
  });

  it("returns the session to idle when a load fails", () => {
    expect(calendarSessionStatusForTransition("loading", "error")).toBe("idle");
    expect(calendarSessionStatusForTransition("retrying", "error")).toBe("idle");
  });

  it("returns the session to idle when a pending load is abandoned", () => {
    expect(calendarSessionStatusForTransition("loading", "inactive")).toBe("idle");
    expect(calendarSessionStatusForTransition("retrying", "inactive")).toBe("idle");
  });

  it("leaves success to the acceptance callback and ignores non-transitions", () => {
    expect(calendarSessionStatusForTransition("loading", "success")).toBeNull();
    expect(calendarSessionStatusForTransition("loading", "empty")).toBeNull();
    expect(calendarSessionStatusForTransition("loading", "loading")).toBeNull();
    expect(calendarSessionStatusForTransition(null, "inactive")).toBeNull();
    expect(calendarSessionStatusForTransition("success", "inactive")).toBeNull();
  });
});
