# Phone playback fixtures

These are public, maintainer-controlled diagnostic fixtures, not provider
streams or proof of physical-device qualification. The video contains generated
color motion and a test tone only; no third-party footage or user data.

`kunai-owned-playback-fixture.mp4` is eight seconds of 320×180 H.264/yuv420p
video and AAC audio. Its MP4 metadata is at the front for direct playback.
`probe.json` is a small bounded HTTPS response for the host proof.

After this branch is pushed, transfer the prepared device-kit ZIP with USB,
Files, or [LocalSend](https://localsend.org/). Keep Android execution in private
Termux storage, and all five iPhone helpers together in an a-Shell mini-owned
folder. The complete procedure is in
[the device lab](../../../../.docs/mobile-device-lab.md).

Use immutable URLs from the reviewed commit:

```text
https://raw.githubusercontent.com/KitsuneKode/kunai/<commit>/.reference/reviews/2026-10-03/phone-fixtures/probe.json
https://raw.githubusercontent.com/KitsuneKode/kunai/<commit>/.reference/reviews/2026-10-03/phone-fixtures/kunai-owned-playback-fixture.mp4
```

Pass the first as `--probe-url` and the second as `--media-url`. They require no
credentials or custom headers. Open the media in VLC manually first, then run
the same URL through Kunai. Record visible playback separately from an accepted
OS handoff; keep evidence bound to the device-kit artifact-set metadata.

For offline diagnostics, transfer the MP4 into VLC/Files, enable airplane mode,
and open it there. This tests the player's phone-local file path, not Kunai
download, resume, or library integration. VLC documents its iPhone transfer
routes in [Media Synchronization](https://docs.videolan.me/vlc-user/ios/3.X/en/gettingstarted/media_synchronization.html).

Real-provider checks are a separate gate: a desktop stream resolved with headers
can fail as a bare phone URL. Do not copy provider cookies into a public fixture,
evidence JSON, issue, QR code, or log. Re-resolve expiring streams privately for
each actual provider/device test.

Regenerate this diagnostic fixture on a trusted host with FFmpeg:

```sh
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=12 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 -t 8 \
  -c:v libx264 -preset fast -crf 35 -pix_fmt yuv420p \
  -c:a aac -b:a 24k -movflags +faststart \
  kunai-owned-playback-fixture.mp4
```

FFmpeg versions may emit different bytes; review the new digest before transfer.
`SHA256SUMS` binds this checked-in fixture, not the terminal-host programs.
