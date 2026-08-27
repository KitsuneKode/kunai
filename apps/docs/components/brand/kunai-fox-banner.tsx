import { KunaiFox, type KunaiFoxPose } from "@/components/brand/kunai-fox";
import type { ReactNode } from "react";

type KunaiFoxBannerProps = {
  readonly pose?: KunaiFoxPose;
  readonly facing?: "left" | "right";
  readonly eyebrow?: string;
  readonly title: string;
  readonly children?: ReactNode;
  readonly compact?: boolean;
};

/** Cute fox + copy strip for docs hubs, home bands, and 404s. */
export function KunaiFoxBanner({
  pose = "idle",
  facing,
  eyebrow,
  title,
  children,
  compact = false,
}: KunaiFoxBannerProps) {
  return (
    <aside className={`kunai-fox-banner${compact ? " kunai-fox-banner--compact" : ""}`}>
      <KunaiFox pose={pose} facing={facing} size={compact ? 88 : 132} animated />
      <div className="kunai-fox-banner__copy">
        {eyebrow ? <p className="kunai-eyebrow m-0">{eyebrow}</p> : null}
        <p className="kunai-fox-banner__title">{title}</p>
        {children ? <div className="kunai-fox-banner__body">{children}</div> : null}
      </div>
    </aside>
  );
}
