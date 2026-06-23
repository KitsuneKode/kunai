import type { CSSProperties } from "react";

import { kunaiBrand } from "./tokens";

type KunaiMarkProps = {
  readonly size: number;
  readonly style?: CSSProperties;
};

/** Fox-blade mark from `.design/brand/kunai-mark.svg`, scaled for Satori OG renders. */
export function KunaiMark({ size, style }: KunaiMarkProps) {
  const scale = size / 64;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={style} aria-hidden>
      <path
        d="M32 59 L50 31 L45.5 13 L37 29 L32 33 L27 29 L18.5 13 L14 31 Z"
        fill={kunaiBrand.markFill}
        stroke={kunaiBrand.markStroke}
        strokeWidth={1.5 * scale}
        strokeLinejoin="round"
      />
      <path
        d="M32 33 L32 59"
        stroke={kunaiBrand.markStroke}
        strokeWidth={1.4 * scale}
        strokeLinecap="round"
        opacity={0.7}
      />
      <rect x={24} y={35} width={4} height={4} rx={0.6} fill={kunaiBrand.ink} />
      <rect x={36} y={35} width={4} height={4} rx={0.6} fill={kunaiBrand.ink} />
      <path
        d="M22 22 l3 4"
        stroke={kunaiBrand.markSpark}
        strokeWidth={1.6 * scale}
        strokeLinecap="round"
      />
      <path
        d="M42 22 l-3 4"
        stroke={kunaiBrand.markSpark}
        strokeWidth={1.6 * scale}
        strokeLinecap="round"
      />
    </svg>
  );
}
