import { KunaiFox, type KunaiFoxPose } from "@/components/brand/kunai-fox";
import type { ReactNode } from "react";

type KunaiFoxBannerProps = {
  readonly pose?: KunaiFoxPose;
  readonly eyebrow?: string;
  readonly title: string;
  readonly heading?: "p" | "h1";
  readonly children?: ReactNode;
};

/** Cute fox + copy strip for docs hubs, home bands, and 404s. */
export function KunaiFoxBanner({
  pose = "idle",
  eyebrow,
  title,
  heading = "p",
  children,
}: KunaiFoxBannerProps) {
  const TitleTag = heading;
  return (
    <aside className="kunai-fox-banner">
      <KunaiFox pose={pose} size={132} animated />
      <div className="kunai-fox-banner__copy">
        {eyebrow ? <p className="kunai-eyebrow m-0">{eyebrow}</p> : null}
        <TitleTag className="kunai-fox-banner__title">{title}</TitleTag>
        {children ? <div className="kunai-fox-banner__body">{children}</div> : null}
      </div>
    </aside>
  );
}
