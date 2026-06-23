import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #100b0f, #2a2030)",
        borderRadius: 36,
        color: "#ff8fb0",
        fontSize: 96,
        fontWeight: 300,
      }}
    >
      K
    </div>,
    { ...size },
  );
}
