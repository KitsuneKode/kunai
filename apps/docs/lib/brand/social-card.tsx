import { KunaiMark } from "@/lib/brand/kunai-mark";
import { kunaiBrand } from "@/lib/brand/tokens";
import type { ReactNode } from "react";

export type SocialKind = "anime" | "series" | "movie" | "video";

type SocialCardProps = {
  readonly eyebrow: string;
  readonly headline: string[];
  readonly subline: string;
  readonly command: string;
  readonly footer: string;
  readonly kind?: SocialKind;
};

const KIND_META = [
  { id: "anime" as const, label: "anime", color: kunaiBrand.typeAnime },
  { id: "series" as const, label: "series", color: kunaiBrand.typeSeries },
  { id: "movie" as const, label: "movies", color: kunaiBrand.typeMovie },
] as const;

/**
 * Which of the three companions should read as "present" on a card.
 *
 * Docs OG has no kind, so the whole crew stands with the watcher. A share
 * card lights the matching kind; a YouTube `video` share uses the movie
 * companion rather than inventing a fourth figure.
 */
export function isKindCrewActive(
  highlight: SocialKind | undefined,
  id: "anime" | "series" | "movie",
): boolean {
  if (highlight === undefined) return true;
  if (highlight === "video") return id === "movie";
  return highlight === id;
}

function KindCrew({ highlight }: { readonly highlight?: SocialKind }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
      {KIND_META.map((item) => (
        <KindCharacter
          key={item.id}
          id={item.id}
          label={item.label}
          color={item.color}
          active={isKindCrewActive(highlight, item.id)}
        />
      ))}
    </div>
  );
}

function KindCharacter({
  id,
  label,
  color,
  active,
}: {
  readonly id: "anime" | "series" | "movie";
  readonly label: string;
  readonly color: string;
  readonly active: boolean;
}) {
  const size = active ? 56 : 44;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        opacity: active ? 1 : 0.34,
      }}
    >
      <div
        style={{
          display: "flex",
          width: size,
          height: Math.round(size * 1.14),
          alignItems: "flex-end",
          justifyContent: "center",
        }}
      >
        {id === "anime" ? <AnimeBuddy color={color} size={size} /> : null}
        {id === "series" ? <SeriesBuddy color={color} size={size} /> : null}
        {id === "movie" ? <MovieBuddy color={color} size={size} /> : null}
      </div>
      <span style={{ fontSize: 11, color: kunaiBrand.muted, fontFamily: "monospace" }}>
        {label}
      </span>
    </div>
  );
}

/** Tiny kitsune cub in the anime hue — same ear language as the watcher. */
function AnimeBuddy({ color, size }: { readonly color: string; readonly size: number }) {
  const soft = kunaiBrand.accentSoft;
  const ink = kunaiBrand.ink;
  return (
    <svg width={size} height={size} viewBox="0 0 56 56">
      <path d="M12 24 L18 6 L26 22 Z" fill={color} />
      <path d="M30 22 L38 6 L44 24 Z" fill={color} />
      <path d="M16 22 L18 11 L23 21 Z" fill={soft} />
      <path d="M33 21 L38 11 L40 22 Z" fill={soft} />
      <circle cx="28" cy="32" r="15" fill={color} />
      <circle cx="28" cy="38" r="7" fill={soft} />
      <circle cx="22" cy="30" r="2.2" fill={ink} />
      <circle cx="34" cy="30" r="2.2" fill={ink} />
      <circle cx="18" cy="36" r="2.6" fill={soft} opacity="0.75" />
      <circle cx="38" cy="36" r="2.6" fill={soft} opacity="0.75" />
      <path
        d="M25 40 Q28 43 31 40"
        stroke={ink}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Face on a little TV — the series companion. */
function SeriesBuddy({ color, size }: { readonly color: string; readonly size: number }) {
  const ink = kunaiBrand.ink;
  return (
    <svg width={size} height={size} viewBox="0 0 56 56">
      <path d="M18 16 L12 5" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <path d="M38 16 L44 5" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <rect x="8" y="14" width="40" height="30" rx="8" fill={color} />
      <rect x="12" y="18" width="32" height="18" rx="5" fill={ink} />
      <circle cx="22" cy="27" r="2.4" fill={color} />
      <circle cx="34" cy="27" r="2.4" fill={color} />
      <path
        d="M24 32 Q28 36 32 32"
        stroke={color}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="16" y="44" width="7" height="8" rx="2" fill={color} />
      <rect x="33" y="44" width="7" height="8" rx="2" fill={color} />
    </svg>
  );
}

/** Smiling clapper — the movie companion. */
function MovieBuddy({ color, size }: { readonly color: string; readonly size: number }) {
  const ink = kunaiBrand.ink;
  const stripe = kunaiBrand.bg;
  return (
    <svg width={size} height={size} viewBox="0 0 56 56">
      <path d="M8 20 L46 10 L48 18 L10 28 Z" fill={color} />
      <path d="M14 18 L18 9" stroke={stripe} strokeWidth="3" />
      <path d="M24 16 L28 7" stroke={stripe} strokeWidth="3" />
      <path d="M34 13 L38 4" stroke={stripe} strokeWidth="3" />
      <rect x="8" y="24" width="40" height="26" rx="6" fill={color} />
      <circle cx="20" cy="35" r="2.4" fill={ink} />
      <circle cx="36" cy="35" r="2.4" fill={ink} />
      <path
        d="M22 42 Q28 46 34 42"
        stroke={ink}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TerminalStrip({ command }: { readonly command: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        borderRadius: 12,
        border: `1px solid ${kunaiBrand.line}`,
        background: kunaiBrand.surface,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 28,
          padding: "0 16px",
          background: kunaiBrand.surfaceElevated,
        }}
      >
        <div
          style={{ width: 8, height: 8, borderRadius: 999, background: kunaiBrand.accentDeep }}
        />
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: kunaiBrand.muted,
            opacity: 0.45,
          }}
        />
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: kunaiBrand.muted,
            opacity: 0.45,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "14px 18px",
          fontFamily: "monospace",
          fontSize: 22,
          color: kunaiBrand.textDim,
        }}
      >
        <span style={{ color: kunaiBrand.accent, marginRight: 10 }}>{">"}</span>
        {command}
      </div>
    </div>
  );
}

function MascotStage({
  mascotSrc,
  kind,
}: {
  readonly mascotSrc?: string;
  readonly kind?: SocialKind;
}) {
  if (!mascotSrc) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          width: 360,
        }}
      >
        <KunaiMark size={200} />
        <KindCrew highlight={kind} />
      </div>
    );
  }

  // Stacked, not overlaid. The crew used to sit absolutely in the lower-left,
  // which worked when the mascot was a corner peek on a dark square with empty
  // space beside it. Kanna's bust is centred and fills its frame, so that
  // placement put three figures on top of her face — and their labels off the
  // bottom edge. The premise changed with the art; the layout has to follow.
  //
  // 260 rather than 360: the baked master is 192px square, sized to its inline
  // budget, and drawing it half again as large only makes it soft.
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
        width: 360,
      }}
    >
      <img src={mascotSrc} alt="" width={260} height={260} style={{ objectFit: "contain" }} />
      <KindCrew highlight={kind} />
    </div>
  );
}

export function KunaiSocialCard({
  eyebrow,
  headline,
  subline,
  command,
  footer,
  kind,
  mascotSrc,
}: SocialCardProps & { readonly mascotSrc?: string }) {
  const leftColumn: ReactNode = <MascotStage mascotSrc={mascotSrc} kind={kind} />;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: `linear-gradient(135deg, ${kunaiBrand.bg} 0%, ${kunaiBrand.surfaceElevated} 100%)`,
        color: kunaiBrand.text,
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 18% 42%, ${kunaiBrand.accentGlow}, transparent 55%)`,
        }}
      />
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          padding: "56px 72px",
          gap: 40,
          position: "relative",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {leftColumn}
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            justifyContent: "center",
            gap: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <KunaiMark size={46} />
            <div
              style={{
                display: "flex",
                fontSize: 22,
                letterSpacing: "0.28em",
                color: kunaiBrand.accent,
                fontFamily: "monospace",
              }}
            >
              {eyebrow}
            </div>
          </div>
          {headline.map((line) => (
            <div
              key={line}
              style={{
                display: "flex",
                fontSize: 58,
                lineHeight: 1.05,
                fontWeight: 500,
              }}
            >
              {line}
            </div>
          ))}
          <div
            style={{
              display: "flex",
              fontSize: 22,
              lineHeight: 1.35,
              color: kunaiBrand.textDim,
              fontFamily: "monospace",
              maxWidth: 760,
            }}
          >
            {subline}
          </div>
          <div style={{ display: "flex", marginTop: 8, maxWidth: 760 }}>
            <TerminalStrip command={command} />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 12,
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 14,
                color: kunaiBrand.muted,
                fontFamily: "monospace",
              }}
            >
              {footer}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
