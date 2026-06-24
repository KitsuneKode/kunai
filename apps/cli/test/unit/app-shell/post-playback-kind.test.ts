import { describe, expect, test } from "bun:test";

import {
  clearRootContentSession,
  getRootContentSession,
  mountRootContent,
} from "@/app-shell/root-content-state";
import React from "react";

describe("post-playback root content kind", () => {
  test("mountRootContent accepts post-playback as a primary shell kind", () => {
    const session = mountRootContent({
      kind: "post-playback",
      fallbackValue: "done",
      renderContent: () => React.createElement("text", null, "post-play"),
    });

    expect(getRootContentSession()?.kind).toBe("post-playback");
    session.close("done");
    expect(getRootContentSession()).toBeNull();
    clearRootContentSession();
  });
});
