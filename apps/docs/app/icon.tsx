import { KunaiMark } from "@/lib/brand/kunai-mark";
import generatedMascot from "@/lib/generated-mascot.json";
import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * The tab icon is Kanna, not the blade.
 *
 * A favicon is the most-repeated brand impression there is — every tab, every
 * bookmark, every history row — and the blade mark is a geometric fox that any
 * project could own. She is the part nobody else has. Rendered from the same
 * bake the OG cards use, so there is one asset behind every small surface
 * rather than a fourth source to keep in step.
 *
 * She survives the size: at 32 the ears, the muzzle and the squint all still
 * read. Below that a browser downscales this, which beats a 16px render of art
 * drawn at 928.
 *
 * Full-bleed and transparent, unlike the OG cards and the home-screen tile. At
 * 32px a plate and a border are the difference between an ear reaching the edge
 * and an ear touching a frame, and transparency is what lets her sit correctly
 * on a light tab strip and a dark one without picking a side.
 *
 * The mark stays as the fallback for the same reason it stays on the cards —
 * it is the insignia, and a missing bake must not produce an empty tab.
 */
export default function Icon() {
  const mascot = generatedMascot.mascotDataUrl;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
      }}
    >
      {mascot.length > 0 ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mascot} alt="" width={32} height={32} style={{ objectFit: "contain" }} />
      ) : (
        <KunaiMark size={24} />
      )}
    </div>,
    { ...size },
  );
}
