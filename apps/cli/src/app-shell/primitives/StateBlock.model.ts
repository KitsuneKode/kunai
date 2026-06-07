import type { ActionRowModel } from "./ActionList.model";

export type StateBlockKind = "loading" | "empty" | "info" | "success" | "error";
export type StateBlockTone = "muted" | "info" | "success" | "danger";

export type StateBlockModel = {
  readonly kind: StateBlockKind;
  readonly title: string;
  readonly detail?: string;
  readonly actions?: readonly ActionRowModel[];
};

export function getStateBlockGlyph(kind: StateBlockKind): string {
  if (kind === "loading") return "◐";
  if (kind === "empty") return "·";
  if (kind === "success") return "✓";
  if (kind === "error") return "×";
  return "●";
}

export function getStateBlockTone(kind: StateBlockKind): StateBlockTone {
  if (kind === "error") return "danger";
  if (kind === "success") return "success";
  if (kind === "info" || kind === "loading") return "info";
  return "muted";
}
