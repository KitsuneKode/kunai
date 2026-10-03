import type { ReactNode } from "react";

/**
 * One tile of the home bento: a double bezel with a label and a line of detail.
 *
 * An outer shell with a hairline and an inner plate with its own highlight, and
 * radii that nest (inner = outer minus the shell padding). The plate carries
 * `data-bento-tile`, which `BentoStage` uses to draw the pointer spotlight on it.
 * Plain markup with no hooks, so the server tiles and the client tiles share it.
 */
export function BentoTile({
  className = "",
  label,
  detail,
  children,
}: {
  readonly className?: string;
  readonly label: string;
  readonly detail: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <section className={`kunai-surface-shell ${className}`}>
      <div
        data-bento-tile=""
        className="kunai-surface-shell__inner kunai-bento-plate flex h-full flex-col p-6 md:p-7"
      >
        <h3 className="kunai-step-label m-0">{label}</h3>
        {detail ? (
          <p className="kunai-type-body mt-3 max-w-prose text-sm text-pretty">{detail}</p>
        ) : null}
        {children}
      </div>
    </section>
  );
}
