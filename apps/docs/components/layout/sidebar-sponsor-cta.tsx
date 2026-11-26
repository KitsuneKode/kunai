import { FOUNDING_SPONSOR_SLOTS, SUPPORT_PATH, sponsors } from "@/lib/support";
import { IconArrowRight, IconHeart } from "@tabler/icons-react";
import Link from "next/link";

/** Compact sponsor entry point tucked into the docs sidebar footer below GitHub stars. */
export function SidebarSponsorCta() {
  const openCount = Math.max(0, FOUNDING_SPONSOR_SLOTS.length - sponsors.length);
  return (
    <Link
      href={`${SUPPORT_PATH}#sponsor-benefits`}
      className="group bg-fd-card/50 hover:bg-fd-card hover:border-fd-primary/40 flex min-h-10 items-center gap-2 rounded-[10px] border border-[var(--kunai-line)] px-2.5 py-1.5 text-xs transition-[background-color,border-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
    >
      <IconHeart
        className="text-fd-primary hover-fine:group-hover:scale-110 size-4 shrink-0 transition-transform duration-150 ease-[var(--ease-out)]"
        stroke={1.6}
      />
      <span className="text-fd-foreground font-medium">Sponsor Kunai</span>
      <span className="text-fd-muted-foreground ml-auto inline-flex items-center gap-1 font-mono text-xs tabular-nums">
        {openCount > 0 ? `${openCount} open` : "Backers"}
        <IconArrowRight
          className="hover-fine:group-hover:translate-x-0.5 size-3 transition-transform duration-150 ease-[var(--ease-out)]"
          stroke={1.6}
        />
      </span>
    </Link>
  );
}
