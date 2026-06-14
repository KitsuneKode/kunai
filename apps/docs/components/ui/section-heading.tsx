"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

type SectionHeadingProps = {
  readonly eyebrow: string;
  readonly title: string;
  readonly description?: string;
  readonly className?: string;
  readonly children?: ReactNode;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  className = "kunai-section-head",
  children,
}: SectionHeadingProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
      className={className}
    >
      <p className="kunai-eyebrow">{eyebrow}</p>
      <h2 className="kunai-display-title text-fd-foreground">{title}</h2>
      {description ? (
        <p className="text-fd-muted-foreground mt-4 max-w-3xl text-sm leading-relaxed text-pretty md:text-base">
          {description}
        </p>
      ) : null}
      {children}
    </motion.div>
  );
}
