import type { CSSProperties } from "react";

/** A CSS custom property name, e.g. `--lane`. */
export type CssVarName = `--${string}`;

/**
 * Inline style with CSS custom properties. React's `CSSProperties` does not
 * model `--*` names, so this is the one place that bridges the two.
 */
export function withCssVars(
  vars: Readonly<Record<CssVarName, string | number>>,
  style: CSSProperties = {},
): CSSProperties {
  // SAFETY: custom properties are valid inline style keys in React; the cast only
  // widens CSSProperties to admit the `--*` names it does not declare.
  return { ...style, ...vars } as CSSProperties;
}
