import {
  idleConfirmStripState,
  transitionConfirmStrip,
  type ConfirmStripAction,
  type ConfirmStripState,
  type ConfirmStripTransition,
} from "@/app-shell/primitives/ConfirmStrip.model";

export function createConfirmStripHarness(initial: ConfirmStripState = idleConfirmStripState) {
  let state = initial;
  return {
    get state() {
      return state;
    },
    transition(action: ConfirmStripAction): ConfirmStripTransition {
      const next = transitionConfirmStrip(state, action);
      state = next.state;
      return next;
    },
  };
}

export function armedConfirmStripHarness(input?: {
  readonly targetId?: string;
  readonly label?: string;
  readonly verb?: string;
  readonly visibleIds?: readonly string[];
}) {
  const visibleIds = input?.visibleIds ?? ["title:tmdb:1", "episode:tmdb:1:1:2"];
  const harness = createConfirmStripHarness();
  harness.transition({
    type: "arm",
    targetId: input?.targetId ?? "episode:tmdb:1:1:2",
    label: input?.label ?? "Demo · S01E02",
    verb: input?.verb ?? "delete",
    visibleIds,
  });
  return harness;
}
