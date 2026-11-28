import { describe, expect, it } from "bun:test";

import { calendarSessionStatusForTransition } from "@/app-shell/hooks/use-calendar-route";

describe("calendarSessionStatusForTransition", () => {
  it("maps the mounted route into honest session status", () => {
    expect(calendarSessionStatusForTransition(null, "loading")).toBe("loading");
    expect(calendarSessionStatusForTransition("loading", "error")).toBe("error");
    expect(calendarSessionStatusForTransition("loading", "inactive")).toBe("idle");
    expect(calendarSessionStatusForTransition("error", "error")).toBeNull();
  });
});
