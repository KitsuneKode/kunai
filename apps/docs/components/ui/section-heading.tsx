"use client";

import { domAnimation, LazyMotion, m } from "motion/react";
import type { ReactNode } from "react";

type SectionHeadingProps = {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly className?: string;
  readonly variant?: "docs" | "home";
  readonly animate?: boolean;
  readonly children?: ReactNode;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  className = "kunai-section-head",
  variant = "docs",
  animate = true,
  children,
}: SectionHeadingProps) {
  const headingClass =
    variant === "home"
      ? "kunai-home-h2 text-fd-foreground"
      : "kunai-display-title text-fd-foreground";

  const content = (
    <>
      {eyebrow ? <p className="kunai-eyebrow">{eyebrow}</p> : null}
      <h2 className={headingClass}>{title}</h2>
      {description ? (
        <p className="text-fd-muted-foreground mt-3 max-w-2xl text-sm leading-relaxed text-pretty md:text-[0.9375rem]">
          {description}
        </p>
      ) : null}
      {children}
    </>
  );

  if (!animate) {
    return <div className={className}>{content}</div>;
  }

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "0px" }}
        transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
        className={className}
      >
        {content}
      </m.div>
    </LazyMotion>
  );
}
