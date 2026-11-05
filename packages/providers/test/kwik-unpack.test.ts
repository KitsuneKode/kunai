import { describe, expect, test } from "bun:test";

import {
  decodeBaseN,
  extractKwikStreamFromEmbed,
  parseKwikFormToken,
  unpackDeanEdwards,
} from "../src/shared/kwik-unpack";

describe("decodeBaseN", () => {
  test("decodes base-10 digits", () => {
    expect(decodeBaseN("0", 10)).toBe(0);
    expect(decodeBaseN("9", 10)).toBe(9);
    expect(decodeBaseN("42", 10)).toBe(42);
  });

  test("decodes base-36 lowercase alphanumeric", () => {
    expect(decodeBaseN("a", 36)).toBe(10);
    expect(decodeBaseN("z", 36)).toBe(35);
    expect(decodeBaseN("10", 36)).toBe(36);
  });

  test("decodes base-62 mixed-case alphanumeric", () => {
    expect(decodeBaseN("A", 62)).toBe(36);
    expect(decodeBaseN("Z", 62)).toBe(61);
    expect(decodeBaseN("10", 62)).toBe(62);
    expect(decodeBaseN("1a", 62)).toBe(1 * 62 + 10);
  });

  test("rejects invalid radix or out-of-range characters", () => {
    expect(decodeBaseN("z", 10)).toBe(-1);
    expect(decodeBaseN("A", 36)).toBe(-1);
    expect(decodeBaseN("?", 62)).toBe(-1);
    expect(decodeBaseN("", 10)).toBe(-1);
  });
});

describe("unpackDeanEdwards", () => {
  test("unpacks simple Dean Edwards payload", () => {
    const packed = `eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c]);return p}('0 1 2.',3,3,'hello|world|test'.split('|'),0,{}))`;
    const unpacked = unpackDeanEdwards(packed);
    expect(unpacked).toBe("hello world test.");
  });

  test("unpacks base-62 packed script with m3u8 source", () => {
    const packed = `eval(function(p,a,c,k,e,d){return p}('3 2="1://0.4/5/6.7";',8,8,'cdn|https|source|const|example|hls|master|m3u8'.split('|')))`;
    const unpacked = unpackDeanEdwards(packed);
    expect(unpacked).toBe('const source="https://cdn.example/hls/master.m3u8";');
  });

  test("returns null for non-packed strings", () => {
    expect(unpackDeanEdwards("console.log('not packed');")).toBeNull();
  });
});

describe("extractKwikStreamFromEmbed", () => {
  test("extracts m3u8 stream from packed kwik script", () => {
    const packedHtml = `<script>eval(function(p,a,c,k,e,d){return p}('3 2="1://0.4/5/6.7";',8,8,'kwik|https|source|const|cx|stream|playlist|m3u8'.split('|')))</script>`;
    const stream = extractKwikStreamFromEmbed(packedHtml, "kwik.cx");
    expect(stream).toBeDefined();
    expect(stream?.url).toBe("https://kwik.cx/stream/playlist.m3u8");
    expect(stream?.protocol).toBe("hls");
    expect(stream?.headers.Referer).toBe("https://kwik.cx/");
  });

  test("extracts direct progressive mp4 from unpacked script", () => {
    const html = `<script>const player = new Player({ file: "https://vault.owocdn.com/video/ep1.mp4" });</script>`;
    const stream = extractKwikStreamFromEmbed(html, "kwik.cx");
    expect(stream).toBeDefined();
    expect(stream?.url).toBe("https://vault.owocdn.com/video/ep1.mp4");
    expect(stream?.protocol).toBe("progressive");
    expect(stream?.headers.Referer).toBe("https://kwik.cx/");
  });

  test("returns null when no stream url is present", () => {
    expect(extractKwikStreamFromEmbed("<html><body>No stream here</body></html>")).toBeNull();
  });
});

describe("parseKwikFormToken", () => {
  test("extracts action url and hidden _token from POST gate", () => {
    const html = `
      <html>
        <body>
          <form action="https://kwik.cx/f/AbCdEf123" method="POST">
            <input type="hidden" name="_token" value="xYz987SecretToken654" />
            <button type="submit">Download</button>
          </form>
        </body>
      </html>
    `;
    const parsed = parseKwikFormToken(html);
    expect(parsed).toEqual({
      actionUrl: "https://kwik.cx/f/AbCdEf123",
      token: "xYz987SecretToken654",
    });
  });

  test("returns null if token or form is missing", () => {
    expect(parseKwikFormToken("<div>No form here</div>")).toBeNull();
    expect(
      parseKwikFormToken('<form action="/foo"><input name="other" value="bar"/></form>'),
    ).toBeNull();
  });
});
