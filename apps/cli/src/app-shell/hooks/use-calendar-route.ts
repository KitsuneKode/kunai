// =============================================================================
// use-calendar-route.ts — the mounted calendar route state machine.
//
// The calendar used to load OUTSIDE the shell: the controller awaited a schedule
// bundle and only opened browse once rows existed. A slow source therefore
// showed nothing — no chrome, no loader, no Esc — and a failing one dropped the
// user on generic browse idle copy with no way to retry.
//
// This hook inverts that. The surface mounts first and owns five explicit
// states; the request runs underneath it, one AbortController per attempt, with
// a latest-request gate so a superseded or cancelled completion can never
// commit global state or paint.
// =============================================================================

import { createLatestRequestGate } from "@/app-shell/browse-async";
import type { CalendarTypeTab } from "@/app-shell/calendar-ui.model";
import type { BrowseShellSearchResponse } from "@/app-shell/types";
import { useCallback, useEffect, useRef, useState } from "react";

export type CalendarRouteRequest = {
  readonly kind: "calendar";
  /** Monotonic per-open identity. A newer key supersedes the request in flight. */
  readonly requestKey: number;
  readonly initialTypeTab?: CalendarTypeTab;
};

export type CalendarRouteState<T> =
  | { readonly kind: "inactive" }
  | { readonly kind: "loading"; readonly requestKey: number }
  | { readonly kind: "retrying"; readonly requestKey: number }
  | {
      readonly kind: "success";
      readonly requestKey: number;
      readonly response: BrowseShellSearchResponse<T>;
    }
  | {
      readonly kind: "empty";
      readonly requestKey: number;
      readonly response: BrowseShellSearchResponse<T>;
    }
  | {
      readonly kind: "error";
      readonly requestKey: number;
      readonly message: string;
    };

/**
 * User-facing failure copy. Source errors carry URLs, tokens, and stack noise;
 * the surface gets one bounded sentence and the detail continues through
 * structured diagnostics instead.
 */
export const CALENDAR_ROUTE_ERROR_MESSAGE =
  "Could not reach the release schedule. Your library and search still work.";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

type RetryTicket = { readonly forKey: number; readonly count: number };

export function useCalendarRoute<T>({
  request,
  load,
  onAccepted,
}: {
  readonly request?: CalendarRouteRequest;
  readonly load: (signal: AbortSignal) => Promise<BrowseShellSearchResponse<T>>;
  readonly onAccepted: (
    request: CalendarRouteRequest,
    response: BrowseShellSearchResponse<T>,
  ) => void;
}): {
  readonly state: CalendarRouteState<T>;
  readonly retry: () => void;
} {
  // Initialised from the request, not from the effect: a routed calendar must be
  // `loading` on its FIRST render, so the very first committed frame is already
  // the schedule surface rather than a one-frame flash of browse idle.
  const [state, setState] = useState<CalendarRouteState<T>>(() =>
    request === undefined
      ? { kind: "inactive" }
      : { kind: "loading", requestKey: request.requestKey },
  );
  const [retryTicket, setRetryTicket] = useState<RetryTicket | null>(null);

  // Props that change identity every render must not restart the request; the
  // effect keys off the request identity and its retry count alone.
  const loadRef = useRef(load);
  loadRef.current = load;
  const acceptedRef = useRef(onAccepted);
  acceptedRef.current = onAccepted;
  const requestRef = useRef(request);
  requestRef.current = request;

  const gateRef = useRef(createLatestRequestGate());
  const controllerRef = useRef<AbortController | null>(null);

  const requestKey = request?.requestKey;
  // A retry belongs to one request. A newer route starts at attempt 0 again, so
  // its first frame is `loading`, not a stale `retrying`.
  const retryCount = retryTicket && retryTicket.forKey === requestKey ? retryTicket.count : 0;

  const retry = useCallback(() => {
    if (requestKey === undefined) return;
    setRetryTicket((previous) =>
      previous && previous.forKey === requestKey
        ? { forKey: requestKey, count: previous.count + 1 }
        : { forKey: requestKey, count: 1 },
    );
  }, [requestKey]);

  useEffect(() => {
    // Any previous attempt loses its claim the moment a new one begins, so a
    // completion that lands after this point cannot accept or paint.
    controllerRef.current?.abort();
    gateRef.current.invalidate();

    const activeRequest = requestRef.current;
    if (activeRequest === undefined) {
      controllerRef.current = null;
      setState({ kind: "inactive" });
      return undefined;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    const token = gateRef.current.begin();
    let cleanedUp = false;
    const stale = () => cleanedUp || controller.signal.aborted || !gateRef.current.isCurrent(token);

    setState({
      kind: retryCount > 0 ? "retrying" : "loading",
      requestKey: activeRequest.requestKey,
    });

    void (async () => {
      try {
        const response = await loadRef.current(controller.signal);
        if (stale()) return;
        // The single acceptance commit point for this request.
        acceptedRef.current(activeRequest, response);
        setState({
          kind: response.options.length === 0 ? "empty" : "success",
          requestKey: activeRequest.requestKey,
          response,
        });
      } catch (error) {
        if (stale()) return;
        // An abort is a user decision, never a failure to report.
        if (isAbortError(error)) return;
        setState({
          kind: "error",
          requestKey: activeRequest.requestKey,
          message: CALENDAR_ROUTE_ERROR_MESSAGE,
        });
      }
    })();

    return () => {
      cleanedUp = true;
      controller.abort();
    };
  }, [requestKey, retryCount]);

  return { state, retry };
}
