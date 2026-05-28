import { describe, expect, test } from "bun:test";

import {
  clearRootContentSession,
  getRootContentSession,
  mountRootContent,
  type RootContentKind,
} from "@/app-shell/root-content-state";
import React from "react";

describe("root content state", () => {
  test("supports all primary mounted-shell content kinds", () => {
    const kinds: readonly RootContentKind[] = [
      "browse",
      "loading",
      "playback",
      "post-playback",
      "picker",
    ];

    for (const kind of kinds) {
      const session = mountRootContent({
        kind,
        fallbackValue: "done",
        renderContent: () => React.createElement("text", null, kind),
      });

      expect(getRootContentSession()?.kind).toBe(kind);
      session.close("done");
      expect(getRootContentSession()).toBeNull();
    }

    clearRootContentSession();
  });
});
