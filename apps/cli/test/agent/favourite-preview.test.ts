import { expect, test } from "bun:test";

import { createAgentSession } from "./agent-driver";
import { K } from "./keys";

test("favourite preview follows the persisted toggle in both directions", async () => {
  const session = await createAgentSession({
    label: "favourite-preview",
    columns: 180,
    rows: 46,
  });
  try {
    await session.waitForFrame((frame) => frame.includes("Search title"), "browse");
    session.press("movie", K.enter);
    await session.waitForFrame(
      (frame) => frame.includes("Not favourited · f to add"),
      "initial preview",
    );

    session.press("f");
    await session.waitForBackend(
      (inspector) => inspector.tableRows("data.list_items").length === 1,
      "favourite committed",
    );
    await session.waitForFrame(
      (frame) => frame.includes("Favourited · f to remove"),
      "preview offers remove",
    );
    expect(session.inspect().tableRows("data.list_items")[0]).toContain("smoke-movie");

    session.press("f");
    await session.waitForBackend(
      (inspector) => inspector.tableRows("data.list_items").length === 0,
      "favourite removed",
    );
    await session.waitForFrame(
      (frame) => frame.includes("Not favourited · f to add"),
      "preview offers add again",
    );
    session.assertPrivacyClean();
  } finally {
    await session.dispose();
  }
});
