export type PickerModelOption<TValue extends string = string> = {
  readonly id: string;
  readonly value: TValue;
  readonly label: string;
  readonly detail?: string;
  readonly enabled?: boolean;
  readonly disabledReason?: string;
  readonly group?: string;
  readonly keywords?: readonly string[];
};

export type PickerModelItemRow<TValue extends string = string> = {
  readonly type: "item";
  readonly option: PickerModelOption<TValue>;
  readonly selectableIndex: number;
  readonly selected: boolean;
};

export type PickerModelGroupRow = {
  readonly type: "group";
  readonly id: string;
  readonly label: string;
};

export type PickerModelRow<TValue extends string = string> =
  | PickerModelGroupRow
  | PickerModelItemRow<TValue>;

export type PickerModel<TValue extends string = string> = {
  readonly query: string;
  readonly options: readonly PickerModelOption<TValue>[];
  readonly rows: readonly PickerModelRow<TValue>[];
  readonly selectedIndex: number;
  readonly selectedOption: PickerModelOption<TValue> | null;
};
