---
"@kitsunekode/kunai": patch
---

refactor(providers): drop crypto-js for an EVP_BytesToKey port

The videasy/vidking guarded lanes only needed CryptoJS passphrase-mode AES —
the OpenSSL `Salted__` + MD5 EVP_BytesToKey envelope — which is ~60 lines on
node:crypto. Byte-exact parity fixtures generated against real crypto-js pin
both lanes (empty passphrase, sha256-hex passphrase, unicode plaintext).
Removes `crypto-js` + `@types/crypto-js` from the dependency tree entirely.
