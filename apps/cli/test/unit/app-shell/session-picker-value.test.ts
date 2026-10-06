import { describe, expect, test } from "bun:test";

import { EPISODE_PICKER_SWITCH_SEASON, parsePickerValue } from "@/app-shell/session-picker";

describe("parsePickerValue", () => {
  test("decodes plain episode numbers", () => {
    expect(parsePickerValue("7")).toBe(7);
    expect(parsePickerValue(" 12 ")).toBe(12);
  });

  test("cancel shapes stay cancelled", () => {
    expect(parsePickerValue(null)).toBeNull();
    expect(parsePickerValue(undefined)).toBeNull();
    expect(parsePickerValue("")).toBeNull();
  });

  test("reserved tokens and garbage never become episode numbers", () => {
    expect(parsePickerValue(EPISODE_PICKER_SWITCH_SEASON)).toBeNull();
    expect(parsePickerValue("NaN")).toBeNull();
    expect(parsePickerValue("12abc")).toBeNull();
    expect(parsePickerValue("--dump-json")).toBeNull();
  });
});
