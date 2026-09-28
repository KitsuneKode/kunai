import { KunaiMark } from "@/lib/brand/kunai-mark";
import { kunaiBrand } from "@/lib/brand/tokens";
import generatedMascot from "@/lib/generated-mascot.json";
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * The home-screen icon, matching the tab icon.
 *
 * Same reasoning as `icon.tsx`: she is the identity and the blade is the
 * insignia. At 180 there is room for her to be drawn properly rather than
 * squeezed, so she gets the full tile with the gradient behind her.
 */
export default function AppleIcon() {
  const mascot = generatedMascot.mascotDataUrl;

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
      {mascot.length > 0 ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mascot} alt="" width={150} height={150} style={{ objectFit: "contain" }} />
      ) : (
        <KunaiMark size={118} />
      )}
    </div>,
    { ...size },
  );
}
