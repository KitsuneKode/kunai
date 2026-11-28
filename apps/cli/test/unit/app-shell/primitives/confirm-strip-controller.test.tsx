import { expect, test } from "bun:test";

import { useConfirmStripController } from "@/app-shell/primitives/use-confirm-strip";
import { useInput } from "ink";
import React, { act } from "react";

import { render } from "../../../harness/render-capture";

function Probe({ states }: { readonly states: string[] }) {
  const confirm = useConfirmStripController();
  useInput((input) => {
    if (input !== "x") return;
    confirm.transition({
      type: "arm",
      targetId: "row:1",
      label: "Row",
      verb: "delete",
      visibleIds: ["row:1"],
    });
    states.push(confirm.getState().kind);
    confirm.transition({ type: "confirm" });
    states.push(confirm.getState().kind);
  });
  return null;
}

test("useConfirmStripController exposes ref-authoritative state inside one input commit", async () => {
  const states: string[] = [];
  const handle = render(<Probe states={states} />, { columns: 40, rows: 10 });
  try {
    await act(async () => {
      handle.stdin.enqueue("x");
    });
    expect(states).toEqual(["armed", "executing"]);
  } finally {
    handle.unmount();
  }
});
