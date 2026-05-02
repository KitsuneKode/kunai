import { describe, expect, test } from "bun:test";

import {
  buildMpvIpcCommand,
  MPV_INITIAL_PROPERTIES,
  MPV_OBSERVED_PROPERTIES,
  parseMpvIpcLine,
} from "@/infra/player/mpv-ipc";

describe("mpv-ipc", () => {
  test("builds newline-delimited ipc commands without a request id", () => {
    expect(buildMpvIpcCommand(["get_property", "duration"])).toBe(
      `${JSON.stringify({ command: ["get_property", "duration"] })}\n`,
    );
  });

  test("builds newline-delimited ipc commands with a request id", () => {
    expect(buildMpvIpcCommand(["observe_property", 4, "time-pos"], 4)).toBe(
      `${JSON.stringify({ command: ["observe_property", 4, "time-pos"], request_id: 4 })}\n`,
    );
  });

  test("builds playback control ipc commands", () => {
    expect(buildMpvIpcCommand(["quit"])).toBe(`${JSON.stringify({ command: ["quit"] })}\n`);
    expect(buildMpvIpcCommand(["sub-reload"])).toBe(
      `${JSON.stringify({ command: ["sub-reload"] })}\n`,
    );
  });

  test("parses valid newline-delimited ipc payloads", () => {
    expect(parseMpvIpcLine('{"event":"property-change","name":"duration","data":1440}\n')).toEqual({
      event: "property-change",
      name: "duration",
      data: 1440,
    });
  });

  test("returns null for empty or invalid lines", () => {
    expect(parseMpvIpcLine("")).toBeNull();
    expect(parseMpvIpcLine("not-json")).toBeNull();
    expect(parseMpvIpcLine("[]")).toBeNull();
  });

  test("requests the expected initial and observed properties", () => {
    expect(MPV_INITIAL_PROPERTIES).toEqual(["playback-time", "duration", "percent-pos"]);
    expect(MPV_OBSERVED_PROPERTIES).toEqual([
      "time-pos",
      "playback-time",
      "duration",
      "percent-pos",
      "pause",
      "eof-reached",
      "idle-active",
      "core-idle",
      "filename",
      "media-title",
      "track-list",
    ]);
  });

  test("parses successful command responses with request ids", () => {
    expect(parseMpvIpcLine('{"request_id":12,"error":"success","data":true}\n')).toEqual({
      request_id: 12,
      error: "success",
      data: true,
    });
  });
});
