import { KunaiFox } from "@/components/brand/kunai-fox";
import { Button } from "@/components/ui/button";
import { FOUNDING_SPONSOR_SLOTS, SPONSOR_URL, SUPPORT_PATH, type Sponsor } from "@/lib/support";
import { IconPlus } from "@tabler/icons-react";
import Link from "next/link";

/**
 * The people and products who back Kunai.
 *
 * When empty, renders a StickItUpX-inspired interactive sponsor dock showing
 * exact open founding slots so prospective sponsors can picture their mark
 * right beside Kunai before clicking through.
 */
export function SponsorWall({
  sponsors,
  withAction = true,
  wide = false,
}: {
  readonly sponsors: readonly Sponsor[];
  /**
   * Whether the empty wall carries its own "Be the first" button pointing at
   * `SPONSOR_URL`. A section that already has a Sponsor button turns this off
   * so one view never repeats the same external action twice.
   */
  readonly withAction?: boolean;
  /** Wider 4-column slot rail on dedicated /support view. */
  readonly wide?: boolean;
}) {
  if (sponsors.length === 0) {
    return (
      <div className="kunai-sponsor-dock-wrap">
        <div className="kunai-sponsor-dock" aria-label="Open founding sponsor slots">
          <span className="kunai-sponsor-dock__brand" aria-hidden="true">
            <KunaiFox pose="idle" size={20} compact />
            <span>Kunai</span>
          </span>

          <span className="kunai-sponsor-dock__sep" aria-hidden="true" />

          <div
            className={`kunai-sponsor-dock__slots${wide ? " kunai-sponsor-dock__slots--wide" : ""}`}
          >
            {FOUNDING_SPONSOR_SLOTS.map((slot) => {
              const inner = (
                <>
                  <span className="kunai-sponsor-slot__rest">
                    <IconPlus className="size-3.5" stroke={1.75} aria-hidden="true" />
                    <span>Your logo</span>
                  </span>
                  <span className="kunai-sponsor-slot__preview" aria-hidden="true">
                    <span className="kunai-sponsor-slot__mark" />
                    <span>Your brand</span>
                  </span>
                </>
              );

              return withAction ? (
                <a
                  key={slot.id}
                  href={SPONSOR_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={`${slot.label} · ${slot.hint}`}
                  className="kunai-sponsor-slot"
                >
                  {inner}
                  <span className="sr-only">
                    : claim {slot.label} ({slot.hint}) on GitHub Sponsors (opens in a new tab)
                  </span>
                </a>
              ) : (
                <Link
                  key={slot.id}
                  href={`${SUPPORT_PATH}#sponsor-benefits`}
                  title={`${slot.label} · ${slot.hint}`}
                  className="kunai-sponsor-slot"
                >
                  {inner}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-xs leading-5 text-[var(--home-text-4,var(--color-fd-muted-foreground))]">
            No sponsors yet · Shown on homepage · docs · README.
          </p>
          {withAction ? (
            <Button
              size="sm"
              variant="outline"
              render={<Link href={SPONSOR_URL} target="_blank" rel="noreferrer noopener" />}
              nativeButton={false}
            >
              Be the first
              <span className="sr-only"> (opens GitHub Sponsors in a new tab)</span>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {sponsors.map((sponsor) => (
        <li key={sponsor.name}>
          {sponsor.url ? (
            <a
              href={sponsor.url}
              target="_blank"
              rel="noreferrer noopener"
              className="border-border bg-card hover-fine:border-primary inline-flex items-center rounded-lg border px-3 py-1.5 text-sm transition-[border-color,transform] duration-[var(--dur-press)] ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:active:scale-100"
            >
              {sponsor.name}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span className="border-border bg-card inline-flex items-center rounded-lg border px-3 py-1.5 text-sm">
              {sponsor.name}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
