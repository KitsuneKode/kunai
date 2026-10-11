import { Badge } from "@/components/ui/badge";

const statusVariant = {
  shipped: "ok",
  beta: "accent",
  planned: "muted",
} as const;

type DocsStatus = keyof typeof statusVariant;

type DocsStatusBadgeProps = {
  readonly status?: string;
};

export function DocsStatusBadge({ status }: DocsStatusBadgeProps) {
  // `shipped` is the steady state — a badge on every finished page is chrome,
  // not signal. Only out-of-band states earn the chip.
  if (!status || status === "shipped" || !(status in statusVariant)) {
    return null;
  }

  const variant = statusVariant[status as DocsStatus];

  return (
    <Badge variant={variant} className="not-prose mb-3 w-fit capitalize">
      {status}
    </Badge>
  );
}
