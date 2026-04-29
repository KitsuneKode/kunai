import { useCallback, useEffect, useState } from "react";

export type LineEditorKey = {
  backspace?: boolean;
  delete?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  tab?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  home?: boolean;
  end?: boolean;
};

export type LineEditorState = {
  value: string;
  cursor: number;
  killRing: string;
};

export type LineEditorResult = {
  state: LineEditorState;
  handled: boolean;
  submitted: boolean;
  redrew: boolean;
};

type SegmenterSegment = {
  index: number;
  segment: string;
};

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function graphemeBoundaries(value: string): number[] {
  if (value.length === 0) return [0];

  if (segmenter) {
    const boundaries = [0];
    for (const segment of segmenter.segment(value) as Iterable<SegmenterSegment>) {
      boundaries.push(segment.index + segment.segment.length);
    }
    return Array.from(new Set(boundaries)).sort((left, right) => left - right);
  }

  const boundaries = [0];
  let offset = 0;
  for (const char of Array.from(value)) {
    offset += char.length;
    boundaries.push(offset);
  }
  return boundaries;
}

export function clampCursor(value: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return value.length;
  return Math.min(Math.max(0, Math.trunc(cursor)), value.length);
}

function previousGrapheme(value: string, cursor: number): number {
  const current = clampCursor(value, cursor);
  const boundaries = graphemeBoundaries(value);
  for (let index = boundaries.length - 1; index >= 0; index--) {
    const boundary = boundaries[index] ?? 0;
    if (boundary < current) return boundary;
  }
  return 0;
}

function nextGrapheme(value: string, cursor: number): number {
  const current = clampCursor(value, cursor);
  for (const boundary of graphemeBoundaries(value)) {
    if (boundary > current) return boundary;
  }
  return value.length;
}

function isWhitespace(char: string | undefined): boolean {
  return !char || /\s/u.test(char);
}

export function previousWordBoundary(value: string, cursor: number): number {
  const chars = Array.from(value);
  const boundaries = graphemeBoundaries(value);
  let boundaryIndex = boundaries.findIndex((boundary) => boundary >= clampCursor(value, cursor));
  if (boundaryIndex < 0) boundaryIndex = boundaries.length - 1;

  while (boundaryIndex > 0 && isWhitespace(chars[boundaryIndex - 1])) {
    boundaryIndex--;
  }
  while (boundaryIndex > 0 && !isWhitespace(chars[boundaryIndex - 1])) {
    boundaryIndex--;
  }

  return boundaries[boundaryIndex] ?? 0;
}

export function nextWordBoundary(value: string, cursor: number): number {
  const chars = Array.from(value);
  const boundaries = graphemeBoundaries(value);
  let boundaryIndex = boundaries.findIndex((boundary) => boundary >= clampCursor(value, cursor));
  if (boundaryIndex < 0) boundaryIndex = boundaries.length - 1;

  while (boundaryIndex < chars.length && !isWhitespace(chars[boundaryIndex])) {
    boundaryIndex++;
  }
  while (boundaryIndex < chars.length && isWhitespace(chars[boundaryIndex])) {
    boundaryIndex++;
  }

  return boundaries[boundaryIndex] ?? value.length;
}

function replaceRange(value: string, start: number, end: number, replacement = ""): string {
  return `${value.slice(0, start)}${replacement}${value.slice(end)}`;
}

export function createLineEditorState(value = ""): LineEditorState {
  return {
    value,
    cursor: value.length,
    killRing: "",
  };
}

export function applyLineEditorInput(
  state: LineEditorState,
  input: string,
  key: LineEditorKey,
): LineEditorResult {
  const cursor = clampCursor(state.value, state.cursor);
  const current: LineEditorState = { ...state, cursor };
  const lowerInput = input.toLowerCase();

  if (key.return) {
    return { state: current, handled: true, submitted: true, redrew: false };
  }

  if (key.home || (key.ctrl && lowerInput === "a")) {
    return { state: { ...current, cursor: 0 }, handled: true, submitted: false, redrew: false };
  }

  if (key.end || (key.ctrl && lowerInput === "e")) {
    return {
      state: { ...current, cursor: current.value.length },
      handled: true,
      submitted: false,
      redrew: false,
    };
  }

  if (key.leftArrow || (key.ctrl && lowerInput === "b")) {
    return {
      state: { ...current, cursor: previousGrapheme(current.value, cursor) },
      handled: true,
      submitted: false,
      redrew: false,
    };
  }

  if (key.rightArrow || (key.ctrl && lowerInput === "f")) {
    return {
      state: { ...current, cursor: nextGrapheme(current.value, cursor) },
      handled: true,
      submitted: false,
      redrew: false,
    };
  }

  if (key.meta && lowerInput === "b") {
    return {
      state: { ...current, cursor: previousWordBoundary(current.value, cursor) },
      handled: true,
      submitted: false,
      redrew: false,
    };
  }

  if (key.meta && lowerInput === "f") {
    return {
      state: { ...current, cursor: nextWordBoundary(current.value, cursor) },
      handled: true,
      submitted: false,
      redrew: false,
    };
  }

  if (key.ctrl && lowerInput === "u") {
    return {
      state: {
        value: current.value.slice(cursor),
        cursor: 0,
        killRing: current.value.slice(0, cursor),
      },
      handled: true,
      submitted: false,
      redrew: false,
    };
  }

  if (key.ctrl && lowerInput === "k") {
    return {
      state: {
        value: current.value.slice(0, cursor),
        cursor,
        killRing: current.value.slice(cursor),
      },
      handled: true,
      submitted: false,
      redrew: false,
    };
  }

  if (key.ctrl && lowerInput === "w") {
    const start = previousWordBoundary(current.value, cursor);
    return {
      state: {
        value: replaceRange(current.value, start, cursor),
        cursor: start,
        killRing: current.value.slice(start, cursor),
      },
      handled: true,
      submitted: false,
      redrew: false,
    };
  }

  if (key.ctrl && lowerInput === "y") {
    if (!current.killRing) {
      return { state: current, handled: true, submitted: false, redrew: false };
    }
    return {
      state: {
        ...current,
        value: replaceRange(current.value, cursor, cursor, current.killRing),
        cursor: cursor + current.killRing.length,
      },
      handled: true,
      submitted: false,
      redrew: false,
    };
  }

  if (key.ctrl && lowerInput === "l") {
    return { state: current, handled: true, submitted: false, redrew: true };
  }

  if (key.backspace) {
    const start = previousGrapheme(current.value, cursor);
    return {
      state: {
        ...current,
        value: replaceRange(current.value, start, cursor),
        cursor: start,
      },
      handled: true,
      submitted: false,
      redrew: false,
    };
  }

  if (key.delete) {
    const end = nextGrapheme(current.value, cursor);
    return {
      state: {
        ...current,
        value: replaceRange(current.value, cursor, end),
      },
      handled: true,
      submitted: false,
      redrew: false,
    };
  }

  if (
    input &&
    !key.ctrl &&
    !key.meta &&
    !key.upArrow &&
    !key.downArrow &&
    !key.tab &&
    !key.escape
  ) {
    return {
      state: {
        ...current,
        value: replaceRange(current.value, cursor, cursor, input),
        cursor: cursor + input.length,
      },
      handled: true,
      submitted: false,
      redrew: false,
    };
  }

  return { state: current, handled: false, submitted: false, redrew: false };
}

export function splitCursor(
  value: string,
  cursor: number,
): {
  before: string;
  cursorChar: string;
  after: string;
} {
  const safeCursor = clampCursor(value, cursor);
  const end = nextGrapheme(value, safeCursor);

  return {
    before: value.slice(0, safeCursor),
    cursorChar: value.slice(safeCursor, end),
    after: value.slice(end),
  };
}

export function useLineEditor({
  value,
  onChange,
  onSubmit,
  onRedraw,
}: {
  value: string;
  onChange: (nextValue: string) => void;
  onSubmit?: (value: string) => void;
  onRedraw?: () => void;
}) {
  const [cursor, setCursor] = useState(value.length);
  const [killRing, setKillRing] = useState("");

  useEffect(() => {
    setCursor((current) => clampCursor(value, current));
  }, [value]);

  const handleInput = useCallback(
    (input: string, key: LineEditorKey): boolean => {
      const result = applyLineEditorInput({ value, cursor, killRing }, input, key);
      if (!result.handled) return false;

      setCursor(result.state.cursor);
      setKillRing(result.state.killRing);
      if (result.state.value !== value) {
        onChange(result.state.value);
      }
      if (result.submitted) {
        onSubmit?.(result.state.value);
      }
      if (result.redrew) {
        onRedraw?.();
      }

      return true;
    },
    [cursor, killRing, onChange, onRedraw, onSubmit, value],
  );

  const setValue = useCallback(
    (nextValue: string, nextCursor = nextValue.length) => {
      onChange(nextValue);
      setCursor(clampCursor(nextValue, nextCursor));
    },
    [onChange],
  );

  return {
    cursor: clampCursor(value, cursor),
    killRing,
    handleInput,
    setCursor,
    setValue,
  };
}
