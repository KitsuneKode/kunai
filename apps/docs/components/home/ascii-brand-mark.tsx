import { ASCII_KUNAI, ASCII_KUNAI_COMPACT } from "@/lib/brand/ascii-kunai";
import { cn } from "@/lib/utils";

type AsciiBrandMarkProps = {
  readonly compact?: boolean;
  readonly className?: string;
};

export function AsciiBrandMark({ compact = false, className }: AsciiBrandMarkProps) {
  const art = compact ? ASCII_KUNAI_COMPACT : ASCII_KUNAI;
  return (
    <div className={cn("kunai-ascii-mark", className)}>
      <span className="sr-only">Kunai</span>
      <pre aria-hidden className="kunai-ascii-pre">
        {art}
      </pre>
    </div>
  );
}
