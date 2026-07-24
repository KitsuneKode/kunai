import { afterEach, describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";

import {
  __testing as transportTesting,
  canUseFileTransmission,
  prepareKittyPayload,
  uploadKittyPayload,
  type KittyPayload,
} from "@/image/kitty-transport";

import { makeRgbJpeg, makeRgbPng } from "../../support/image-fixtures";

const originalWriteFile = transportTesting.runtime.writeFile;
const originalWrite = transportTesting.runtime.write;
const originalTmpdir = transportTesting.runtime.tmpdir;

function captureWrites(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  transportTesting.runtime.write = (text: string) => {
    writes.push(text);
  };
  return {
    writes,
    restore: () => {
      transportTesting.runtime.write = originalWrite;
    },
  };
}

afterEach(() => {
  transportTesting.runtime.writeFile = originalWriteFile;
  transportTesting.runtime.write = originalWrite;
  transportTesting.runtime.tmpdir = originalTmpdir;
});

describe("prepareKittyPayload", () => {
  test("passes PNG bytes through without decoding", () => {
    const png = makeRgbPng(2, 1, [255, 0, 0, 0, 255, 0]);
    const payload = prepareKittyPayload(png);
    expect(payload).toEqual({ kind: "png", data: png });
  });

  test("decodes JPEG in-process to raw RGBA", () => {
    const jpeg = makeRgbJpeg(2, 1, [255, 0, 0, 0, 0, 255]);
    const payload = prepareKittyPayload(jpeg);
    expect(payload?.kind).toBe("rgba");
    if (payload?.kind !== "rgba") return;
    expect(payload.width).toBe(2);
    expect(payload.height).toBe(1);
    expect(payload.data.byteLength).toBe(2 * 1 * 4);
  });

  test("returns null for undecodable input", () => {
    expect(prepareKittyPayload(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(prepareKittyPayload(new Uint8Array())).toBeNull();
  });
});

describe("canUseFileTransmission", () => {
  test("blocks file transmission over SSH", () => {
    expect(canUseFileTransmission({ SSH_CONNECTION: "10.0.0.1 22" } as NodeJS.ProcessEnv)).toBe(
      false,
    );
    expect(canUseFileTransmission({ SSH_TTY: "/dev/pts/1" } as NodeJS.ProcessEnv)).toBe(false);
  });

  test("allows file transmission on local kitty and Ghostty", () => {
    expect(canUseFileTransmission({ KITTY_WINDOW_ID: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(canUseFileTransmission({ TERM_PROGRAM: "ghostty" } as NodeJS.ProcessEnv)).toBe(true);
  });

  test("blocks file transmission on terminals that never documented t=t", () => {
    // q=2 suppresses error replies, so an unsupported t=t fails silently and the
    // poster is simply never drawn. Chunks work anywhere the protocol works.
    expect(canUseFileTransmission({} as NodeJS.ProcessEnv)).toBe(false);
    expect(canUseFileTransmission({ KONSOLE_VERSION: "220400" } as NodeJS.ProcessEnv)).toBe(false);
    expect(canUseFileTransmission({ TERM_PROGRAM: "WezTerm" } as NodeJS.ProcessEnv)).toBe(false);
  });

  test("blocks file transmission inside tmux and screen", () => {
    // The file lives on whichever host the multiplexer server runs on, and the
    // escapes would need passthrough wrapping we do not emit.
    expect(
      canUseFileTransmission({
        KITTY_WINDOW_ID: "1",
        TMUX: "/tmp/tmux-1000/default",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      canUseFileTransmission({ KITTY_WINDOW_ID: "1", STY: "1234.pts-0" } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      canUseFileTransmission({
        KITTY_WINDOW_ID: "1",
        TERM: "screen-256color",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  test("honours KUNAI_IMAGE_TRANSPORT overrides", () => {
    expect(
      canUseFileTransmission({
        SSH_CONNECTION: "1",
        KUNAI_IMAGE_TRANSPORT: "file",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      canUseFileTransmission({
        KITTY_WINDOW_ID: "1",
        KUNAI_IMAGE_TRANSPORT: "direct",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    // Invalid values fall back to auto detection rather than disabling posters.
    expect(
      canUseFileTransmission({
        KITTY_WINDOW_ID: "1",
        KUNAI_IMAGE_TRANSPORT: "bogus",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});

describe("uploadKittyPayload (direct)", () => {
  const rgbaPayload: KittyPayload = {
    kind: "rgba",
    data: new Uint8Array(8 * 4).fill(128),
    width: 4,
    height: 2,
  };

  test("uploads RGBA as f=32 with zlib compression and dimensions", async () => {
    const capture = captureWrites();
    try {
      const result = await uploadKittyPayload(rgbaPayload, {
        imageId: 7,
        rows: 2,
        cols: 4,
        unicodePlaceholder: true,
        env: { KUNAI_IMAGE_TRANSPORT: "direct" } as NodeJS.ProcessEnv,
      });
      expect(result).toEqual({ sent: true, transmission: "direct" });
      const out = capture.writes.join("");
      expect(out).toContain("a=T,f=32,s=4,v=2,o=z,U=1,q=2,i=7,c=4,r=2");
    } finally {
      capture.restore();
    }
  });

  test("compressed body inflates back to the original pixels", async () => {
    const capture = captureWrites();
    try {
      await uploadKittyPayload(rgbaPayload, {
        env: { KUNAI_IMAGE_TRANSPORT: "direct" } as NodeJS.ProcessEnv,
      });
      const out = capture.writes.join("");
      const payloadB64 = out
        .split("\x1b\\")
        .filter((part) => part.startsWith("\x1b_G"))
        .map((part) => part.slice("\x1b_G".length).split(";").slice(1).join(";"))
        .join("");
      const body = Buffer.from(payloadB64, "base64");
      expect(Array.from(inflateSync(body))).toEqual(Array.from(rgbaPayload.data));
    } finally {
      capture.restore();
    }
  });

  test("chunks base64 into <=4096 byte pieces with m flags", async () => {
    const capture = captureWrites();
    const big: KittyPayload = { kind: "png", data: new Uint8Array(9000).fill(7) };
    try {
      await uploadKittyPayload(big, {
        env: { KUNAI_IMAGE_TRANSPORT: "direct" } as NodeJS.ProcessEnv,
        yieldEveryChunks: 0,
      });
      const chunks = capture.writes
        .join("")
        .split("\x1b\\")
        .filter((part) => part.startsWith("\x1b_G"));
      expect(chunks.length).toBeGreaterThan(1);
      for (const [index, chunk] of chunks.entries()) {
        const content = chunk.split(";").slice(1).join(";");
        expect(content.length).toBeLessThanOrEqual(4096);
        const isLast = index === chunks.length - 1;
        expect(chunk).toContain(`m=${isLast ? 0 : 1}`);
      }
      // Only the first chunk carries the full control data.
      expect(chunks[0]).toContain("a=T,f=100,q=2");
      expect(chunks[1]).not.toContain("a=T");
    } finally {
      capture.restore();
    }
  });

  test("PNG payloads are sent as f=100 without compression", async () => {
    const capture = captureWrites();
    const png = makeRgbPng(1, 1, [1, 2, 3]);
    try {
      await uploadKittyPayload(
        { kind: "png", data: png },
        { env: { KUNAI_IMAGE_TRANSPORT: "direct" } as NodeJS.ProcessEnv },
      );
      const out = capture.writes.join("");
      expect(out).toContain("f=100");
      expect(out).not.toContain("o=z");
    } finally {
      capture.restore();
    }
  });

  test("empty payloads send nothing", async () => {
    const capture = captureWrites();
    try {
      const result = await uploadKittyPayload({ kind: "png", data: new Uint8Array() });
      expect(result.sent).toBe(false);
      expect(capture.writes.length).toBe(0);
    } finally {
      capture.restore();
    }
  });
});

describe("uploadKittyPayload (t=t file transmission)", () => {
  test("writes a temp file and sends its base64 path", async () => {
    const capture = captureWrites();
    // Held in an object rather than two `let` bindings: TypeScript's control-flow
    // analysis cannot see that the callback ran, so plain locals narrow to `null`
    // at the assertions below and every matcher call fails to typecheck.
    const written: { path: string; body: readonly number[] } = { path: "", body: [] };
    transportTesting.runtime.writeFile = async (path, data) => {
      written.path = path;
      written.body = Array.from(data);
    };
    const payload: KittyPayload = { kind: "png", data: new Uint8Array([1, 2, 3, 4]) };
    try {
      const result = await uploadKittyPayload(payload, {
        preferFileTransmission: true,
        env: { KITTY_WINDOW_ID: "1" } as NodeJS.ProcessEnv,
      });
      expect(result).toEqual({ sent: true, transmission: "file" });
      expect(written.path).toContain("tty-graphics-protocol");
      expect(written.body).toEqual(Array.from(payload.data));
      const out = capture.writes.join("");
      expect(out).toContain("t=t");
      // The escape payload is the base64-encoded file path, per spec.
      expect(out).toContain(Buffer.from(written.path, "utf8").toString("base64"));
      // No chunked upload followed the file escape.
      expect(out).not.toContain("m=1;");
    } finally {
      capture.restore();
    }
  });

  test("falls back to direct chunks when the temp write fails", async () => {
    const capture = captureWrites();
    transportTesting.runtime.writeFile = async () => {
      throw new Error("disk full");
    };
    try {
      const result = await uploadKittyPayload(
        { kind: "png", data: new Uint8Array([9, 9]) },
        { preferFileTransmission: true, env: { KITTY_WINDOW_ID: "1" } as NodeJS.ProcessEnv },
      );
      expect(result).toEqual({ sent: true, transmission: "direct" });
      expect(capture.writes.join("")).toContain("m=0;");
    } finally {
      capture.restore();
    }
  });

  test("never uses files over SSH", async () => {
    const capture = captureWrites();
    let fileWrites = 0;
    transportTesting.runtime.writeFile = async () => {
      fileWrites += 1;
    };
    try {
      const result = await uploadKittyPayload(
        { kind: "png", data: new Uint8Array([9, 9]) },
        {
          preferFileTransmission: true,
          env: { SSH_CONNECTION: "10.0.0.1 22" } as NodeJS.ProcessEnv,
        },
      );
      expect(result.transmission).toBe("direct");
      expect(fileWrites).toBe(0);
    } finally {
      capture.restore();
    }
  });

  test("file transmission sends raw RGBA, never deflated", async () => {
    // The bytes go to local disk rather than through the PTY, so deflating them
    // would only buy temp-file size at the cost of a synchronous stall on the
    // path whose entire purpose is to be the fast one.
    const capture = captureWrites();
    const rgba = new Uint8Array(4 * 4).fill(200);
    const written: { body: readonly number[] } = { body: [] };
    transportTesting.runtime.writeFile = async (_path, data) => {
      written.body = Array.from(data);
    };
    try {
      const result = await uploadKittyPayload(
        { kind: "rgba", data: rgba, width: 4, height: 1 },
        {
          preferFileTransmission: true,
          env: { KITTY_WINDOW_ID: "1" } as NodeJS.ProcessEnv,
        },
      );
      expect(result).toEqual({ sent: true, transmission: "file" });
      const out = capture.writes.join("");
      expect(out).toContain("f=32,s=4,v=1");
      expect(out).not.toContain("o=z");
      expect(written.body).toEqual(Array.from(rgba));
    } finally {
      capture.restore();
    }
  });

  test("re-encodes with compression when the temp write fails mid-flight", async () => {
    const capture = captureWrites();
    transportTesting.runtime.writeFile = async () => {
      throw new Error("read-only filesystem");
    };
    try {
      const result = await uploadKittyPayload(
        { kind: "rgba", data: new Uint8Array(4 * 4).fill(200), width: 4, height: 1 },
        {
          preferFileTransmission: true,
          env: { KITTY_WINDOW_ID: "1" } as NodeJS.ProcessEnv,
        },
      );
      expect(result).toEqual({ sent: true, transmission: "direct" });
      // The PTY fallback must not inherit the uncompressed file encoding.
      expect(capture.writes.join("")).toContain("o=z");
    } finally {
      capture.restore();
    }
  });
});
