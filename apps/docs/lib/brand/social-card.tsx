import { KunaiMark } from "@/lib/brand/kunai-mark";
import { kunaiBrand } from "@/lib/brand/tokens";
import type { ReactNode } from "react";

type SocialCardProps = {
  readonly eyebrow: string;
  readonly headline: string[];
  readonly subline: string;
  readonly command: string;
  readonly footer: string;
};

function KindDots() {
  const items = [
    { color: kunaiBrand.typeAnime, label: "anime" },
    { color: kunaiBrand.typeSeries, label: "series" },
    { color: kunaiBrand.typeMovie, label: "movies" },
  ] as const;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: item.color,
            }}
          />
          <span style={{ fontSize: 14, color: kunaiBrand.muted, fontFamily: "monospace" }}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
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

export function KunaiSocialCard({
  eyebrow,
  headline,
  subline,
  command,
  footer,
  mascotSrc,
}: SocialCardProps & { readonly mascotSrc?: string }) {
  const leftColumn: ReactNode = mascotSrc ? (
    <img src={mascotSrc} alt="" width={320} height={284} style={{ objectFit: "contain" }} />
  ) : (
    <KunaiMark size={220} />
  );

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
          gap: 48,
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
              fontSize: 22,
              lineHeight: 1.35,
              color: kunaiBrand.textDim,
              fontFamily: "monospace",
              maxWidth: 760,
            }}
          >
            {subline}
          </div>
          <div style={{ marginTop: 8, maxWidth: 760 }}>
            <TerminalStrip command={command} />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 12,
              width: "100%",
            }}
          >
            <KindDots />
            <div style={{ fontSize: 14, color: kunaiBrand.muted, fontFamily: "monospace" }}>
              {footer}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
