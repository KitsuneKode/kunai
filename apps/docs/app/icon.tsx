import { KunaiMark } from "@/lib/brand/kunai-mark";
import { kunaiBrand } from "@/lib/brand/tokens";
import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: kunaiBrand.surface,
        borderRadius: 8,
        border: `1px solid ${kunaiBrand.line}`,
      }}
    >
      <KunaiMark size={24} />
    </div>,
    { ...size },
  );
}
