import { describe, expect, test } from "bun:test";

import { BrowseShell } from "@/app-shell/browse-shell";
import { RootContentSuspension, useRootContentSuspended } from "@/app-shell/RootContentSuspension";
import { Text, useInput } from "ink";
import React, { act, useEffect, useState } from "react";

import { render } from "../../harness/render-capture";

/**
 * Locks the contract that lets browse/post-play sessions survive a root
 * overlay opening on top of them: the mounted React tree must never unmount
 * while `RootContentSuspension` toggles `suspended`, and every input hook in
 * that tree must stop reacting to keys while hidden.
 *
 * Suspension is driven via `act(setSuspended)` rather than a keystroke toggle
 * so the Provider commit lands before the next `stdin.enqueue` — matching the
 * production overlay open path (session state updates, then the next key).
 */

let probeMountCount = 0;

function RetainedSelectionProbe() {
  const suspended = useRootContentSuspended();
  const [selection, setSelection] = useState(0);

  useEffect(() => {
    probeMountCount += 1;
  }, []);

  useInput((input) => {
    if (suspended) return;
    if (input === "j") {
      setSelection((current) => current + 1);
    }
  });

  return <Text>{`selection=${selection}`}</Text>;
}

type SuspendControl = { current: (next: boolean) => void };

function SuspensionHarness({
  probe,
  control,
}: {
  readonly probe: React.ReactElement;
  readonly control: SuspendControl;
}) {
  const [suspended, setSuspended] = useState(false);
  control.current = setSuspended;
  return <RootContentSuspension suspended={suspended}>{probe}</RootContentSuspension>;
}

function BrowseSuspensionHarness({ control }: { readonly control: SuspendControl }) {
  const [suspended, setSuspended] = useState(false);
  control.current = setSuspended;

  return (
    <RootContentSuspension suspended={suspended}>
      <BrowseShell
        mode="series"
        provider="vidking"
        placeholder="Search title"
        commands={[]}
        onSearch={async () => ({ options: [], subtitle: "" })}
        onResolve={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    </RootContentSuspension>
  );
}

describe("root content retention under suspension", () => {
  test("selection state and mount identity survive suspend/resume", () => {
    probeMountCount = 0;
    const control: SuspendControl = { current: () => {} };
    const handle = render(
      <SuspensionHarness control={control} probe={<RetainedSelectionProbe />} />,
      { columns: 60 },
    );

    try {
      handle.stdin.enqueue("j");
      expect(handle.lastFrame()).toContain("selection=1");

      act(() => control.current(true));
      handle.stdin.enqueue("j");
      act(() => control.current(false));

      expect(handle.lastFrame()).toContain("selection=1");
      expect(probeMountCount).toBe(1);
    } finally {
      handle.unmount();
    }
  });

  test("a real BrowseShell drops keystrokes typed while suspended", () => {
    const control: SuspendControl = { current: () => {} };
    const handle = render(<BrowseSuspensionHarness control={control} />, {
      columns: 100,
      rows: 32,
    });

    try {
      handle.stdin.enqueue(["D", "u", "n", "e"]);
      expect(handle.lastFrame()).toContain("Dune");

      act(() => control.current(true));
      handle.stdin.enqueue(["Z", "Z", "Z"]);
      act(() => control.current(false));

      expect(handle.lastFrame()).not.toContain("DuneZZZ");
      expect(handle.lastFrame()).toContain("Dune");
    } finally {
      handle.unmount();
    }
  });
});
