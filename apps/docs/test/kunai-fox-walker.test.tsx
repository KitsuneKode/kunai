import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { KunaiFoxWalker, partTransforms, WALKER_PARTS } from "../components/brand/kunai-fox-walker";
import { gaitPose, STANDING_POSE } from "../lib/fox-gait";

describe("partTransforms", () => {
  test("names a transform for every part the drawing exposes", () => {
    const transforms = partTransforms(gaitPose(0.3));
    for (const part of WALKER_PARTS) expect(transforms[part]).toMatch(/\S/);
  });

  test("a different point in the stride moves the legs", () => {
    const a = partTransforms(gaitPose(0.1));
    const b = partTransforms(gaitPose(0.6));
    expect(a.frontNear).not.toBe(b.frontNear);
    expect(a.backFar).not.toBe(b.backFar);
  });
});

describe("KunaiFoxWalker", () => {
  const html = renderToStaticMarkup(<KunaiFoxWalker size={64} />);

  test("renders every addressable part, so the rig can find all of them", () => {
    for (const part of WALKER_PARTS) expect(html).toContain(`data-part="${part}"`);
  });

  test("server output is already a standing pose, not an unposed pile of shapes", () => {
    const standing = partTransforms(STANDING_POSE);
    expect(html).toContain(`data-part="frontNear" transform="${standing.frontNear}"`);
    expect(html).toContain(`data-part="rig" transform="${standing.rig}"`);
  });

  test("is decorative: hidden from assistive tech and out of the tab order", () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).not.toContain("<title");
  });

  test("facing is a flag the stylesheet flips, not a second drawing", () => {
    const left = renderToStaticMarkup(<KunaiFoxWalker facing="left" />);
    expect(left).toContain('data-facing="left"');
    expect(html).toContain('data-facing="right"');
  });
});
