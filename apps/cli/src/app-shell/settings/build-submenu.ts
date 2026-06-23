import type { ShellPickerOption } from "../types";
import type { SettingRowDef, SettingsRegistryContext } from "./types";

export type SettingsSubmenuView = {
  readonly title: string;
  readonly subtitle: string;
  readonly choices: readonly ShellPickerOption<string>[];
};

function markCurrent(
  options: readonly ShellPickerOption<string>[],
  current: string,
): ShellPickerOption<string>[] {
  return options.map((option) => ({
    ...option,
    label:
      option.value === current
        ? option.label.includes("·  current")
          ? option.label
          : `${option.label}  ·  current`
        : option.label.replace(/  ·  current$/, ""),
  }));
}

export function buildSettingsSubmenuView(
  submenuId: string,
  ctx: SettingsRegistryContext,
  defById: ReadonlyMap<string, SettingRowDef>,
): SettingsSubmenuView | null {
  const def = defById.get(submenuId);
  if (!def) return null;

  if (def.kind === "submenu") {
    return {
      title: def.label,
      subtitle: def.summarize(ctx.config),
      choices: def.buildChoices(ctx),
    };
  }

  if (def.kind === "enum" && def.presentation !== "segment") {
    const current = def.read(ctx.config);
    return {
      title: def.label,
      subtitle: `Current ${current}`,
      choices: markCurrent(
        def.options.map((option) => ({
          value: option.value,
          label: option.label,
          detail: option.detail,
        })),
        current,
      ),
    };
  }

  if (def.kind === "reorder") {
    const order = def.resolveOrder(ctx.config);
    const options = def.providerOptions(ctx);
    return {
      title: def.label,
      subtitle: "Shift+↑/↓ or [ ] reorder  ·  first = default",
      choices: order.map((providerId, index) => {
        const option = options.find((entry) => entry.value === providerId);
        const name = option?.label.replace(/  ·  current$/, "") ?? providerId;
        return {
          value: providerId,
          label: `${index + 1}. ${name}`,
          detail: index === 0 ? "Default — tried first" : `Fallback #${index}`,
        };
      }),
    };
  }

  return null;
}
