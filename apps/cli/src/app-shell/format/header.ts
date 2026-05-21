export type HeaderInput = {
  readonly brand: string;
  readonly destination: string;
  readonly context?: string;
  readonly status?: string;
  readonly size?: string;
};

export type HeaderParts = {
  readonly brand: string;
  readonly pill: string;
  readonly context: string;
  readonly right: string;
};

/**
 * Composes the single canonical header. The destination becomes a padded pill;
 * status + size collapse into one right-aligned string. This is the one home
 * for brand/destination/context/status — content must not re-render them.
 */
export function composeHeader(input: HeaderInput): HeaderParts {
  const right = [input.status, input.size]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return {
    brand: input.brand,
    pill: ` ${input.destination} `,
    context: input.context ?? "",
    right,
  };
}
