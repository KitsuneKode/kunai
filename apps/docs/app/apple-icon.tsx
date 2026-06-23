import { KunaiMark } from "@/lib/brand/kunai-mark";
import { kunaiBrand } from "@/lib/brand/tokens";
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
        background: `linear-gradient(145deg, ${kunaiBrand.bg}, ${kunaiBrand.surfaceElevated})`,
        borderRadius: 36,
        border: `1px solid ${kunaiBrand.line}`,
      }}
    >
      <KunaiMark size={118} />
    </div>,
    { ...size },
  );
}
