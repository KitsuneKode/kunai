import { describe, expect, test } from "bun:test";

import {
  applyLineEditorInput,
  createLineEditorState,
  type LineEditorState,
} from "@/app-shell/line-editor";

function edit(
  state: LineEditorState,
  input: string,
  key: Parameters<typeof applyLineEditorInput>[2],
) {
  return applyLineEditorInput(state, input, key).state;
}

describe("line editor", () => {
  test("inserts text at the cursor and preserves the tail", () => {
    let state = createLineEditorState("helo");
    state = edit(state, "", { leftArrow: true });
    state = edit(state, "l", {});

    expect(state.value).toBe("hello");
    expect(state.cursor).toBe(4);
  });

  test("supports readline start/end and character movement", () => {
    let state = createLineEditorState("abc");
    state = edit(state, "a", { ctrl: true });
    state = edit(state, "X", {});
    state = edit(state, "e", { ctrl: true });
    state = edit(state, "Y", {});
    state = edit(state, "b", { ctrl: true });
    state = edit(state, "Z", {});

    expect(state.value).toBe("XabcZY");
  });

  test("supports word movement and word deletion", () => {
    let state = createLineEditorState("alpha beta gamma");
    state = edit(state, "b", { meta: true });
    state = edit(state, "w", { ctrl: true });

    expect(state.value).toBe("alpha gamma");
    expect(state.cursor).toBe("alpha ".length);
    expect(state.killRing).toBe("beta ");
  });

  test("supports kill and yank around the cursor", () => {
    let state = createLineEditorState("alpha beta");
    state = edit(state, "b", { meta: true });
    state = edit(state, "k", { ctrl: true });

    expect(state.value).toBe("alpha ");
    expect(state.killRing).toBe("beta");

    state = edit(state, "a", { ctrl: true });
    state = edit(state, "y", { ctrl: true });

    expect(state.value).toBe("betaalpha ");
  });

  test("deletes full graphemes instead of half surrogate pairs", () => {
    let state = createLineEditorState("a🦊b");
    state = edit(state, "", { leftArrow: true });
    state = edit(state, "", { backspace: true });

    expect(state.value).toBe("ab");
    expect(state.cursor).toBe(1);
  });

  test("ignores navigation keys it does not own", () => {
    const state = createLineEditorState("query");
    const result = applyLineEditorInput(state, "", { upArrow: true });

    expect(result.handled).toBe(false);
    expect(result.state.value).toBe("query");
  });

  test("ignores terminal device-attribute replies leaked into stdin", () => {
    let state = createLineEditorState("Breaking bad");

    state = edit(state, "\x1b[?62;22;52c", {});
    expect(state.value).toBe("Breaking bad");

    state = edit(state, "[:62;22;52c", {});
    expect(state.value).toBe("Breaking bad");
  });
});
