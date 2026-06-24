"use client";

import { motion } from "motion/react";

export function HeroHeadline({ title }: { readonly title: string }) {
  const words = title.split(" ");

  return (
    <h1 className="kunai-type-display m-0 max-w-6xl">
      {words.map((word, index, array) => {
        const offset = array.slice(0, index).join(" ").length;
        const key = `${offset}:${word}`;
        return (
          <motion.span
            key={key}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.08 + index * 0.04,
              duration: 0.45,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="mr-[0.2em] inline-block"
          >
            {word}
          </motion.span>
        );
      })}
    </h1>
  );
}
