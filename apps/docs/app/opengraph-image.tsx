import { ImageResponse } from "next/og";

export const alt = "Kunai Docs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "linear-gradient(135deg, #100b0f 0%, #2a2030 100%)",
        color: "#f6eff4",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          fontSize: 28,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "#ff8fb0",
          marginBottom: 24,
        }}
      >
        Kunai Docs
      </div>
      <div style={{ fontSize: 64, fontWeight: 300, lineHeight: 1.1, maxWidth: 900 }}>
        Terminal-first playback guides
      </div>
      <div style={{ fontSize: 28, marginTop: 32, color: "#cabfca", maxWidth: 800 }}>
        Search, resolve direct streams, hand off to mpv, and recover without losing your place.
      </div>
    </div>,
    { ...size },
  );
}
