import type { ReactNode } from "react";

type ProviderDocSectionProps = {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
};

/** Stable `#id` target for ProviderTable links (ids match codegen provider ids). */
export function ProviderDocSection({ id, title, children }: ProviderDocSectionProps) {
  return (
    <section id={id} className="scroll-mt-28">
      <h3 className="text-fd-foreground mt-8 mb-3 text-xl font-normal tracking-tight">{title}</h3>
      <div className="text-fd-muted-foreground [&_p]:my-2 [&_pre]:my-3">{children}</div>
    </section>
  );
}
