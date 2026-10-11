import { describe, expect, test } from "bun:test";

import { decryptOpensslSalted, sha256Hex } from "../src/shared/openssl-evp";

/**
 * Fixtures generated with real crypto-js (`AES.encrypt(plain, passphrase)`)
 * before the dependency was removed — passphrase mode means the string is
 * fed to OpenSSL EVP_BytesToKey, it is NOT the key.
 *
 * Both production lanes exercise it:
 *  - vidking: `AES.decrypt(wasmBase64, "")` — empty passphrase
 *  - videasy: `AES.decrypt(payload, sha256hex("g:"+token))` — hex passphrase
 */
const PLAIN_JSON = JSON.stringify({
  url: "https://cdn.example.com/master.m3u8",
  quality: "1080p",
  ok: true,
});

describe("decryptOpensslSalted — crypto-js parity vectors", () => {
  test("empty passphrase (vidking lane)", () => {
    const decrypted = decryptOpensslSalted(
      "U2FsdGVkX18uJ+suATJaN6wZ1Dw0yXMd1NcnBifHM3eBfUmQaz4n/6nE3q5Zx8g/LrWd99mpuxRlGwsV6EcFLtAIxTWLh/qHX5uiJEqABRn3tr9e/hI004FLGr5QaryA",
      "",
    );
    expect(decrypted).toBe(PLAIN_JSON);
  });

  test("sha256-hex passphrase (videasy lane)", () => {
    const passphrase = sha256Hex("g:test-session-token-0123456789abcdef");
    expect(passphrase).toBe("33deb456d9484214633b65c1ecd51d3de947e1ac4b721cc1c6369c110af06028");
    const decrypted = decryptOpensslSalted(
      "U2FsdGVkX1+gDDkZyeO0QgqEf14HKD+XM00fdI4RC6/yZs7xHxU6Z9RuXAH60htBJERMkcwZ9LIEX6p8jGNCisLO3BkelQxr4vPO6iOD2+0RIBrhWhno1M/jdLUKF/FT",
      passphrase,
    );
    expect(decrypted).toBe(PLAIN_JSON);
  });

  test("unicode plaintext round-trips through the salted envelope", () => {
    const passphrase = sha256Hex("g:sess_zzz");
    const decrypted = decryptOpensslSalted(
      "U2FsdGVkX18YknzZNAuw2X6V9XmmofvXnUssl8VeS40Jk22FzbCIqpkBPqwdkoXXybFsLO5h6GyC3WjUNFry9g==",
      passphrase,
    );
    expect(decrypted).toBe('ünïcode — 日本語 — {"k":[1,2,3]}');
  });

  test("a wrong passphrase throws on padding instead of returning garbage", () => {
    expect(() =>
      decryptOpensslSalted(
        "U2FsdGVkX18uJ+suATJaN6wZ1Dw0yXMd1NcnBifHM3eBfUmQaz4n/6nE3q5Zx8g/LrWd99mpuxRlGwsV6EcFLtAIxTWLh/qHX5uiJEqABRn3tr9e/hI004FLGr5QaryA",
        "not-the-passphrase",
      ),
    ).toThrow();
  });
});
