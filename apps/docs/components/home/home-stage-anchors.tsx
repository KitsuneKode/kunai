"use client";

import { useHomeStage } from "@/components/home/home-stage-context";
import type { ReactNode } from "react";

export function TerminalStageAnchor({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const { terminalStageRef } = useHomeStage();
  return (
    <div ref={terminalStageRef} className={className}>
      {children}
    </div>
  );
}

export function DirectorySectionAnchor({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const { directoryRef } = useHomeStage();
  return (
    <section ref={directoryRef} className={className}>
      {children}
    </section>
  );
}
