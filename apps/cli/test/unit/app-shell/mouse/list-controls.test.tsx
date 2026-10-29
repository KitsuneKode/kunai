import { expect, test } from "bun:test";

import { ListShell } from "@/app-shell/ink-shell";
import { act } from "react";

import { renderWithPointer } from "../../../support/pointer-render";

test("picker consent and destructive rows require Enter", () => {
  const submitted: string[] = [];
  const handle = renderWithPointer(
    <ListShell
      title="Choices"
      subtitle=""
      options={[
        { value: "normal", label: "Normal" },
        { value: "enable", label: "Enable analytics", keyboardOnly: true },
        { value: "delete", label: "Delete", destructive: true },
      ]}
      onSubmit={(value) => submitted.push(value)}
      onCancel={() => {}}
    />,
    { columns: 100, rows: 30 },
  );
  try {
    handle.click("list:opt:Enable analytics");
    handle.click("list:opt:Enable analytics");
    handle.click("list:opt:Delete");
    handle.click("list:opt:Delete");
    expect(submitted).toEqual([]);
    handle.click("list:opt:Enable analytics");
    act(() => handle.stdin.enqueue(["\r"]));
    expect(submitted).toEqual(["enable"]);
  } finally {
    handle.unmount();
  }
});

test("a different ordinary choice focuses before activation, and duplicate input cannot submit twice", () => {
  const submitted: string[] = [];
  const handle = renderWithPointer(
    <ListShell
      title="Choices"
      subtitle=""
      options={[
        { value: "first", label: "First" },
        { value: "next", label: "Next" },
        { value: "disabled", label: "Disabled", disabled: true },
      ]}
      onSubmit={(value) => submitted.push(value)}
      onCancel={() => {}}
    />,
    { columns: 100, rows: 30 },
  );
  try {
    expect(handle.dispatcher.debugRegions().some((r) => r.id === "list:opt:Disabled")).toBe(false);
    handle.click("list:opt:Next");
    expect(submitted).toEqual([]);
    handle.click("list:opt:Next");
    act(() => handle.stdin.enqueue(["\r", "\r"]));
    expect(submitted).toEqual(["next"]);
  } finally {
    handle.unmount();
  }
});

test("a picker palette removes underlying mouse choices", () => {
  const handle = renderWithPointer(
    <ListShell
      title="Choices"
      subtitle=""
      options={[{ value: "normal", label: "Normal" }]}
      actionContext={{ commands: [], onAction: () => "handled" }}
      onSubmit={() => {
        throw new Error("Underlying choice activated");
      }}
      onCancel={() => {}}
    />,
    { columns: 100, rows: 30 },
  );
  try {
    expect(handle.dispatcher.debugRegions().some((r) => r.id.startsWith("list:opt:"))).toBe(true);
    act(() => handle.stdin.enqueue(["/"]));
    expect(handle.dispatcher.debugRegions().some((r) => r.id.startsWith("list:opt:"))).toBe(false);
  } finally {
    handle.unmount();
  }
});
