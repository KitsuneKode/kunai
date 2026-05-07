import type { ShellPickerOption } from "./types";

export type PickerRequest = {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly options: readonly ShellPickerOption<string>[];
  readonly initialIndex?: number;
  readonly filterQuery?: string;
  readonly emptyMessage?: string;
};

export type PickerState = {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly options: readonly ShellPickerOption<string>[];
  readonly selectedIndex: number;
  readonly filterQuery: string;
  readonly emptyMessage: string;
};

export type PickerResult =
  | { readonly type: "selected"; readonly id: string; readonly value: string }
  | { readonly type: "cancelled"; readonly id: string };

export type PickerEscapeResult =
  | { readonly type: "state"; readonly state: PickerState }
  | { readonly type: "cancelled"; readonly id: string };

export function createPickerState(request: PickerRequest): PickerState {
  const filterQuery = request.filterQuery ?? "";
  const selectedIndex = clampIndex(
    request.initialIndex ?? 0,
    filterOptions(request.options, filterQuery).length,
  );

  return {
    id: request.id,
    title: request.title,
    subtitle: request.subtitle,
    options: request.options,
    selectedIndex,
    filterQuery,
    emptyMessage: request.emptyMessage ?? "No matching options",
  };
}

export function getFilteredPickerOptions(state: PickerState): readonly ShellPickerOption<string>[] {
  return filterOptions(state.options, state.filterQuery);
}

export function updatePickerFilter(state: PickerState, filterQuery: string): PickerState {
  return {
    ...state,
    filterQuery,
    selectedIndex: 0,
  };
}

export function movePickerSelection(state: PickerState, delta: number): PickerState {
  const filtered = getFilteredPickerOptions(state);
  if (filtered.length === 0) {
    return { ...state, selectedIndex: 0 };
  }

  return {
    ...state,
    selectedIndex: wrapIndex(state.selectedIndex + delta, filtered.length),
  };
}

export function confirmPickerSelection(state: PickerState): PickerResult | null {
  const selected = getFilteredPickerOptions(state)[state.selectedIndex];
  if (!selected) return null;
  return {
    type: "selected",
    id: state.id,
    value: selected.value,
  };
}

export function resolvePickerEscape(state: PickerState): PickerEscapeResult {
  if (state.filterQuery.length > 0) {
    return {
      type: "state",
      state: {
        ...state,
        filterQuery: "",
        selectedIndex: 0,
      },
    };
  }

  return { type: "cancelled", id: state.id };
}

function filterOptions(
  options: readonly ShellPickerOption<string>[],
  filterQuery: string,
): readonly ShellPickerOption<string>[] {
  const normalized = filterQuery.trim().toLowerCase();
  if (!normalized) return options;

  return options.filter((option) =>
    `${option.label} ${option.detail ?? ""} ${option.badge ?? ""}`
      .toLowerCase()
      .includes(normalized),
  );
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(0, index), length - 1);
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}
