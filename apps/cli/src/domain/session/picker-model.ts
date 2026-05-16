import { rankFuzzyMatches } from "./fuzzy-match";
import type { PickerModel, PickerModelOption, PickerModelRow } from "./PickerModel";

export type BuildPickerModelInput<TValue extends string = string> = {
  readonly query?: string;
  readonly options: readonly PickerModelOption<TValue>[];
  readonly selectedIndex?: number;
  readonly groupOrder?: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
};

export function buildPickerModel<TValue extends string = string>(
  input: BuildPickerModelInput<TValue>,
): PickerModel<TValue> {
  const query = input.query ?? "";
  const filtered = filterPickerOptions(input.options, query);
  const ordered = orderPickerOptions(filtered, input.groupOrder);
  const selectedIndex = clampIndex(input.selectedIndex ?? 0, ordered.length);
  const rows = buildRows(ordered, selectedIndex, input.groupLabels);

  return {
    query,
    options: ordered,
    rows,
    selectedIndex,
    selectedOption: ordered[selectedIndex] ?? null,
  };
}

export function movePickerModelSelection<TValue extends string>(
  model: PickerModel<TValue>,
  delta: number,
): number {
  if (model.options.length === 0) return 0;
  return wrapIndex(model.selectedIndex + delta, model.options.length);
}

export function selectPickerModelValue<TValue extends string>(
  model: PickerModel<TValue>,
): TValue | null {
  return model.selectedOption?.value ?? null;
}

function filterPickerOptions<TValue extends string>(
  options: readonly PickerModelOption<TValue>[],
  query: string,
): readonly PickerModelOption<TValue>[] {
  const normalized = query.trim().replace(/^\//, "").toLowerCase();
  if (!normalized) return options;

  return rankFuzzyMatches(options, normalized, (option) => [
    ...(option.keywords ?? []).map((keyword) => ({ value: keyword, weight: -4 })),
    { value: option.label, weight: 0 },
    { value: option.detail, weight: 12 },
    { value: option.group, weight: 20 },
  ]);
}

function orderPickerOptions<TValue extends string>(
  options: readonly PickerModelOption<TValue>[],
  groupOrder?: readonly string[],
): readonly PickerModelOption<TValue>[] {
  if (!groupOrder?.length) return options;

  const groupRank = new Map(groupOrder.map((group, index) => [group, index]));
  return [...options].sort((a, b) => {
    const aRank = groupRank.get(a.group ?? "") ?? groupOrder.length;
    const bRank = groupRank.get(b.group ?? "") ?? groupOrder.length;
    if (aRank !== bRank) return aRank - bRank;
    return options.indexOf(a) - options.indexOf(b);
  });
}

function buildRows<TValue extends string>(
  options: readonly PickerModelOption<TValue>[],
  selectedIndex: number,
  groupLabels?: Readonly<Record<string, string>>,
): readonly PickerModelRow<TValue>[] {
  const rows: PickerModelRow<TValue>[] = [];
  let previousGroup: string | undefined;
  for (const [index, option] of options.entries()) {
    if (option.group && option.group !== previousGroup) {
      rows.push({
        type: "group",
        id: option.group,
        label: groupLabels?.[option.group] ?? option.group,
      });
      previousGroup = option.group;
    }
    rows.push({
      type: "item",
      option,
      selectableIndex: index,
      selected: index === selectedIndex,
    });
  }
  return rows;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(0, index), length - 1);
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}
