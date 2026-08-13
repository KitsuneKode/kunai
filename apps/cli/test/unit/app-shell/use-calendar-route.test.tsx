// =============================================================================
// use-calendar-route.test.tsx — the mounted calendar route contract.
//
// The calendar surface must exist BEFORE its I/O starts, so the route hook owns
// loading / retrying / success / empty / error as mounted state rather than the
// controller awaiting a bundle and only then opening a shell. Every assertion
// here uses a deferred promise the test resolves by hand; no timers, no sleeps.
// =============================================================================

import { describe, expect, test } from "bun:test";

import {
  useCalendarRoute,
  type CalendarRouteRequest,
  type CalendarRouteState,
} from "@/app-shell/hooks/use-calendar-route";
import type { BrowseShellOption, BrowseShellSearchResponse } from "@/app-shell/types";
import { Text } from "ink";
import React, { act, useState } from "react";

import { render } from "../../harness/render-capture";

type Row = { readonly id: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nothing awaits a rejection until the hook does; keep Bun from reporting an
  // unhandled rejection between construction and the hook's await.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function option(id: string): BrowseShellOption<Row> {
  return { label: id, value: { id } };
}

function response(ids: readonly string[]): BrowseShellSearchResponse<Row> {
  return {
    options: ids.map(option),
    subtitle: `${ids.length} this week`,
    emptyMessage: "No releases found for the next week",
  };
}

function calendarRequest(requestKey: number): CalendarRouteRequest {
  return { kind: "calendar", requestKey };
}

type HarnessControl = {
  readonly retry: () => void;
  readonly setRequest: (request: CalendarRouteRequest | undefined) => void;
};

/**
 * Renders the route state as one greppable line. The request lives in harness
 * state so a newer route can supersede the previous one WITHOUT remounting —
 * a remount would abort through effect cleanup and prove nothing about the
 * hook's own supersede path.
 */
function Harness({
  initialRequest,
  load,
  onAccepted,
  onState,
  onControl,
}: {
  readonly initialRequest?: CalendarRouteRequest;
  readonly load: (signal: AbortSignal) => Promise<BrowseShellSearchResponse<Row>>;
  readonly onAccepted?: (
    request: CalendarRouteRequest,
    response: BrowseShellSearchResponse<Row>,
  ) => void;
  readonly onState?: (state: CalendarRouteState<Row>) => void;
  readonly onControl?: (control: HarnessControl) => void;
}) {
  const [request, setRequest] = useState<CalendarRouteRequest | undefined>(initialRequest);
  const route = useCalendarRoute<Row>({
    request,
    load,
    onAccepted: onAccepted ?? (() => {}),
  });
  onState?.(route.state);
  onControl?.({ retry: route.retry, setRequest });
  const detail =
    route.state.kind === "success" || route.state.kind === "empty"
      ? `${route.state.response.options.length}|${route.state.response.subtitle}`
      : route.state.kind === "error"
        ? route.state.message
        : "";
  return <Text>{`route:${route.state.kind} ${detail}`}</Text>;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("useCalendarRoute", () => {
  test("mounts loading before the calendar request resolves", () => {
    const pending = deferred<BrowseShellSearchResponse<Row>>();
    const handle = render(
      <Harness initialRequest={calendarRequest(1)} load={() => pending.promise} />,
    );
    try {
      expect(handle.lastFrame()).toContain("route:loading");
    } finally {
      handle.unmount();
    }
  });

  test("stays inactive with no calendar request", () => {
    let loads = 0;
    const handle = render(
      <Harness
        load={async () => {
          loads += 1;
          return response([]);
        }}
      />,
    );
    try {
      expect(handle.lastFrame()).toContain("route:inactive");
      expect(loads).toBe(0);
    } finally {
      handle.unmount();
    }
  });

  test("classifies a zero-option response as empty while keeping the response identity", async () => {
    const pending = deferred<BrowseShellSearchResponse<Row>>();
    const accepted: string[] = [];
    const handle = render(
      <Harness
        initialRequest={calendarRequest(1)}
        load={() => pending.promise}
        onAccepted={(request, value) => accepted.push(`${request.requestKey}:${value.subtitle}`)}
      />,
    );
    try {
      await act(async () => {
        pending.resolve({
          options: [],
          subtitle: "No releases found for the next week",
          emptyMessage: "No releases found for the next week. Search still works.",
        });
        await flush();
      });
      expect(handle.lastFrame()).toContain("route:empty");
      expect(handle.lastFrame()).toContain("0|No releases found for the next week");
      expect(accepted).toEqual(["1:No releases found for the next week"]);
    } finally {
      handle.unmount();
    }
  });

  test("classifies a populated response as success", async () => {
    const pending = deferred<BrowseShellSearchResponse<Row>>();
    const handle = render(
      <Harness initialRequest={calendarRequest(1)} load={() => pending.promise} />,
    );
    try {
      await act(async () => {
        pending.resolve(response(["a", "b"]));
        await flush();
      });
      expect(handle.lastFrame()).toContain("route:success");
      expect(handle.lastFrame()).toContain("2|2 this week");
    } finally {
      handle.unmount();
    }
  });

  test("transitions a rejection to bounded error copy", async () => {
    const pending = deferred<BrowseShellSearchResponse<Row>>();
    const handle = render(
      <Harness initialRequest={calendarRequest(1)} load={() => pending.promise} />,
    );
    try {
      await act(async () => {
        pending.reject(new Error("anilist 503 https://graphql.anilist.co/?token=secret"));
        await flush();
      });
      const frame = handle.lastFrame();
      expect(frame).toContain("route:error");
      expect(frame).not.toContain("https://");
      expect(frame).not.toContain("secret");
    } finally {
      handle.unmount();
    }
  });

  test("retry moves through retrying to success without remounting the surface", async () => {
    const attempts: Array<ReturnType<typeof deferred<BrowseShellSearchResponse<Row>>>> = [];
    const states: Array<CalendarRouteState<Row>["kind"]> = [];
    let control: HarnessControl | undefined;
    const handle = render(
      <Harness
        initialRequest={calendarRequest(1)}
        load={() => {
          const next = deferred<BrowseShellSearchResponse<Row>>();
          attempts.push(next);
          return next.promise;
        }}
        onState={(state) => {
          if (states.at(-1) !== state.kind) states.push(state.kind);
        }}
        onControl={(next) => {
          control = next;
        }}
      />,
    );
    try {
      await act(async () => {
        attempts[0]?.reject(new Error("schedule source failed"));
        await flush();
      });
      expect(handle.lastFrame()).toContain("route:error");

      await act(async () => {
        control?.retry();
        await flush();
      });
      expect(states).toContain("retrying");

      await act(async () => {
        attempts[1]?.resolve(response(["a"]));
        await flush();
      });
      expect(handle.lastFrame()).toContain("route:success");
      expect(attempts.length).toBe(2);
      // Retry re-runs the loader in place: the very first state is still the
      // mount's `loading`, proving the route never went back to `inactive`.
      expect(states[0]).toBe("loading");
      expect(states).toEqual(["loading", "error", "retrying", "success"]);
    } finally {
      handle.unmount();
    }
  });

  test("a newer request aborts the previous request signal", async () => {
    const signals: AbortSignal[] = [];
    let control: HarnessControl | undefined;
    const load = (signal: AbortSignal) => {
      signals.push(signal);
      return deferred<BrowseShellSearchResponse<Row>>().promise;
    };
    const handle = render(
      <Harness
        initialRequest={calendarRequest(1)}
        load={load}
        onControl={(next) => {
          control = next;
        }}
      />,
    );
    try {
      expect(signals[0]?.aborted).toBe(false);
      await act(async () => {
        control?.setRequest(calendarRequest(2));
        await flush();
      });
      expect(signals.length).toBe(2);
      expect(signals[0]?.aborted).toBe(true);
      expect(signals[1]?.aborted).toBe(false);
    } finally {
      handle.unmount();
    }
  });

  test("a superseded response can never be accepted", async () => {
    const pendings: Array<ReturnType<typeof deferred<BrowseShellSearchResponse<Row>>>> = [];
    const accepted: number[] = [];
    let control: HarnessControl | undefined;
    const handle = render(
      <Harness
        initialRequest={calendarRequest(1)}
        load={() => {
          const next = deferred<BrowseShellSearchResponse<Row>>();
          pendings.push(next);
          return next.promise;
        }}
        onAccepted={(request) => accepted.push(request.requestKey)}
        onControl={(next) => {
          control = next;
        }}
      />,
    );
    try {
      await act(async () => {
        control?.setRequest(calendarRequest(2));
        await flush();
      });
      await act(async () => {
        pendings[1]?.resolve(response(["fresh"]));
        await flush();
      });
      await act(async () => {
        // The stale first request finishes last — it must not paint or commit.
        pendings[0]?.resolve(response(["stale", "stale2", "stale3"]));
        await flush();
      });
      expect(accepted).toEqual([2]);
      expect(handle.lastFrame()).toContain("1|1 this week");
    } finally {
      handle.unmount();
    }
  });

  test("unmount aborts the in-flight request", () => {
    const signals: AbortSignal[] = [];
    const pending = deferred<BrowseShellSearchResponse<Row>>();
    const handle = render(
      <Harness
        initialRequest={calendarRequest(1)}
        load={(signal) => {
          signals.push(signal);
          return pending.promise;
        }}
      />,
    );
    handle.unmount();
    expect(signals[0]?.aborted).toBe(true);
  });

  test("an abort rejection never flashes error or empty state", async () => {
    const signals: AbortSignal[] = [];
    const pendings: Array<ReturnType<typeof deferred<BrowseShellSearchResponse<Row>>>> = [];
    const seen: Array<CalendarRouteState<Row>["kind"]> = [];
    let control: HarnessControl | undefined;
    const handle = render(
      <Harness
        initialRequest={calendarRequest(1)}
        load={(signal) => {
          signals.push(signal);
          const next = deferred<BrowseShellSearchResponse<Row>>();
          pendings.push(next);
          return next.promise;
        }}
        onState={(state) => {
          if (seen.at(-1) !== state.kind) seen.push(state.kind);
        }}
        onControl={(next) => {
          control = next;
        }}
      />,
    );
    try {
      await act(async () => {
        control?.setRequest(calendarRequest(2));
        await flush();
      });
      await act(async () => {
        // The aborted first request rejects with the DOM abort reason.
        pendings[0]?.reject(signals[0]?.reason);
        await flush();
      });
      expect(seen).not.toContain("error");
      expect(seen).not.toContain("empty");
      expect(handle.lastFrame()).toContain("route:loading");
    } finally {
      handle.unmount();
    }
  });
});
