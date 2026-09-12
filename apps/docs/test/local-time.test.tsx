import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { formatLocalTimestamp, LocalTime } from "../components/analytics/local-time";

/**
 * `LocalTime` swaps a server-rendered UTC label for the viewer's clock after
 * mount. The swap itself is React's `useEffect`/`useState` contract and needs a
 * DOM to run, which this repo's tests do not have. Everything that can actually
 * go wrong — parsing, the invalid-date guard, formatting in a real zone — lives
 * in `formatLocalTimestamp`, which is tested here directly.
 */
describe("formatLocalTimestamp", () => {
  /**
   * Wall-clock fields in an explicit zone, assembled from `formatToParts`.
   * Asserting ICU's formatted string would pin its punctuation and spacing —
   * newer ICU puts a narrow no-break space before "PM" — which differs across
   * the platforms CI runs on. The fields are what this test is about.
   */
  const wallClock = (timeZone: string) => (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const field = (type: string) => parts.find((part) => part.type === type)?.value;
    return `${field("year")}-${field("month")}-${field("day")} ${field("hour")}:${field("minute")}`;
  };

  test("a viewer in IST sees the IST wall-clock time", () => {
    // 00:27 UTC is 05:57 IST, the same calendar day.
    expect(formatLocalTimestamp("2026-09-11T00:27:00.827Z", wallClock("Asia/Kolkata"))).toBe(
      "2026-09-11 05:57",
    );
  });

  test("a viewer in New York sees the previous evening", () => {
    // 00:27 UTC on 11 September is 20:27 EDT on 10 September.
    expect(formatLocalTimestamp("2026-09-11T00:27:00.827Z", wallClock("America/New_York"))).toBe(
      "2026-09-10 20:27",
    );
  });

  test("an unparseable value yields null, so the UTC label stays", () => {
    expect(formatLocalTimestamp("not a timestamp")).toBeNull();
  });

  test("the default formatter produces a label for a valid instant", () => {
    // The exact text depends on the viewer's locale, which is the point, so
    // only its presence is asserted.
    expect(formatLocalTimestamp("2026-09-11T00:27:00.827Z")).toBeTruthy();
  });
});

describe("LocalTime server render", () => {
  test("renders the UTC label, not the local one, before any effect runs", () => {
    // What the server sends and what the first client render must match, so
    // hydration does not mismatch.
    const html = renderToStaticMarkup(
      <LocalTime iso="2026-09-11T00:27:00.827Z" utcLabel="2026-09-11 00:27:00 UTC" />,
    );
    expect(html).toContain(">2026-09-11 00:27:00 UTC<");
  });
});
