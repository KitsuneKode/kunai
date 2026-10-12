import { MouseDispatcher, MouseDispatchProvider } from "@/app-shell/mouse/MouseRegions";
import type { MouseEvent } from "@/app-shell/mouse/terminal-mouse";
import { act, type ReactElement } from "react";

import { render, type CaptureOptions } from "../harness/render-capture";

/** Drive the semantic pointer boundary through measured, real Ink components. */
export function renderWithPointer(node: ReactElement, options: CaptureOptions = {}) {
  const dispatcher = new MouseDispatcher();
  const handle = render(
    <MouseDispatchProvider dispatcher={dispatcher}>{node}</MouseDispatchProvider>,
    options,
  );
  const send = (id: string, event: Pick<MouseEvent, "kind" | "button">) => {
    const region = dispatcher.debugRegions().find((row) => row.id === id);
    if (!region) throw new Error(`Visible mouse region missing: ${id}`);
    return dispatcher.dispatch({
      ...event,
      x: region.rect.x + Math.floor(region.rect.width / 2),
      y: region.rect.y + Math.floor(region.rect.height / 2),
      ctrl: false,
      shift: false,
      alt: false,
    });
  };
  return {
    ...handle,
    dispatcher,
    click: (id: string) =>
      act(() => {
        send(id, { kind: "press", button: "left" });
        send(id, { kind: "release", button: "left" });
      }),
    wheel: (id: string, direction: "up" | "down") =>
      act(() => {
        send(id, { kind: "wheel", button: direction === "up" ? "wheel-up" : "wheel-down" });
      }),
  };
}
