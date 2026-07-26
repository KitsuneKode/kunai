import type { TitleControlAction, TitleControlContext } from "./title-control-actions";
import { buildTitleControlActions } from "./title-control-actions";

export type TitleControlMenuGroupId = "primary" | "providers-data" | "this-title";

export type TitleControlMenuGroup = {
  readonly id: TitleControlMenuGroupId;
  readonly label: string;
  /** Primary is always visible; secondary groups start collapsed. */
  readonly disclosed: boolean;
  readonly actions: readonly TitleControlAction[];
};

export type TitleControlMenuModel = {
  readonly title: string;
  readonly subtitle: string;
  readonly groups: readonly TitleControlMenuGroup[];
  /** Poster for the Current Selection pane; absent when the title has none. */
  readonly posterUrl?: string;
};

const GROUP_LABELS: Record<TitleControlMenuGroupId, string> = {
  primary: "Primary",
  "providers-data": "Providers & data",
  "this-title": "This title",
};

const GROUP_ORDER: readonly TitleControlMenuGroupId[] = ["primary", "providers-data", "this-title"];

function buildSubtitle(ctx: TitleControlContext): string {
  const parts: string[] = [];
  if (ctx.titleName) parts.push(ctx.titleName);
  if (ctx.providerName) parts.push(ctx.providerName);
  if (ctx.isAnime) parts.push("anime");
  return parts.length > 0 ? parts.join(" · ") : "Choose an action for this title";
}

/** Progressive-disclosure menu model driven by the action selector. */
export function buildTitleControlMenuModel(ctx: TitleControlContext): TitleControlMenuModel {
  const actions = buildTitleControlActions(ctx);
  const groups = GROUP_ORDER.map((id) => ({
    id,
    label: GROUP_LABELS[id],
    disclosed: id === "primary",
    actions: actions.filter((action) => action.group === id),
  })).filter((group) => group.actions.length > 0);

  return {
    title: "Where to start?",
    subtitle: buildSubtitle(ctx),
    groups,
    ...(ctx.posterUrl ? { posterUrl: ctx.posterUrl } : {}),
  };
}

export type TitleControlMenuOption<T> = {
  readonly value: T;
  readonly label: string;
  readonly detail?: string;
  readonly disabled?: boolean;
  /** Carried per-option because the preview pane reads it off the selected row. */
  readonly previewImageUrl?: string;
  /** Discards data or resets state; the surface renders it in a warning tone. */
  readonly destructive?: boolean;
};

export type TitleControlMenuExpandToken =
  | "__expand-providers-data__"
  | "__expand-this-title__"
  | "__collapse-providers-data__"
  | "__collapse-this-title__";

export function titleControlMenuOptions(
  model: TitleControlMenuModel,
  expanded: ReadonlySet<TitleControlMenuGroupId>,
): readonly TitleControlMenuOption<TitleControlAction["id"] | TitleControlMenuExpandToken>[] {
  const options: TitleControlMenuOption<TitleControlAction["id"] | TitleControlMenuExpandToken>[] =
    [];

  for (const group of model.groups) {
    const showActions = group.disclosed || expanded.has(group.id);
    if (!showActions) {
      const enabledCount = group.actions.filter((action) => action.enabled).length;
      if (enabledCount === 0) continue;
      options.push({
        value:
          group.id === "providers-data" ? "__expand-providers-data__" : "__expand-this-title__",
        label: `▸ ${group.label}`,
        detail: `${enabledCount} more`,
      });
      continue;
    }

    if (!group.disclosed) {
      options.push({
        value:
          group.id === "providers-data" ? "__collapse-providers-data__" : "__collapse-this-title__",
        label: `▾ ${group.label}`,
      });
    }

    for (const action of group.actions) {
      options.push({
        value: action.id,
        // A leading glyph makes the row scannable before it is read. Disabled
        // rows lose theirs: an unavailable action should not carry the same
        // visual weight as one you can actually pick.
        label: action.enabled && action.icon ? `${action.icon} ${action.label}` : action.label,
        detail: action.enabled ? action.detail : (action.reason ?? "Unavailable"),
        disabled: !action.enabled,
        ...(action.destructive ? { destructive: true } : {}),
      });
    }
  }

  // The preview pane reads the poster off the selected row, so every row has to
  // carry it — including the group expand/collapse rows, otherwise the poster
  // blinks out whenever the cursor lands on one.
  if (!model.posterUrl) return options;
  return options.map((option) => ({ ...option, previewImageUrl: model.posterUrl }));
}

export function applyTitleControlMenuExpand(
  token: TitleControlMenuExpandToken,
  expanded: ReadonlySet<TitleControlMenuGroupId>,
): ReadonlySet<TitleControlMenuGroupId> {
  const next = new Set(expanded);
  switch (token) {
    case "__expand-providers-data__":
      next.add("providers-data");
      return next;
    case "__expand-this-title__":
      next.add("this-title");
      return next;
    case "__collapse-providers-data__":
      next.delete("providers-data");
      return next;
    case "__collapse-this-title__":
      next.delete("this-title");
      return next;
  }
}

export function isTitleControlMenuExpandToken(value: string): value is TitleControlMenuExpandToken {
  return (
    value === "__expand-providers-data__" ||
    value === "__expand-this-title__" ||
    value === "__collapse-providers-data__" ||
    value === "__collapse-this-title__"
  );
}
