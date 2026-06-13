"use client";

import { motion } from "motion/react";

export function HeroHeadline({ title }: { readonly title: string }) {
  const words = title.split(" ");

  return (
    <h1 className="m-0 max-w-5xl bg-gradient-to-br from-white via-[#f4d8e4] to-[#f09cb5] bg-clip-text font-serif text-5xl leading-[0.98] font-light tracking-tight text-balance text-transparent md:text-6xl xl:text-7xl">
      {words.map((word, index) => (
        <motion.span
          key={`${word}-${index}`}
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
      ))}
    </h1>
  );
}
