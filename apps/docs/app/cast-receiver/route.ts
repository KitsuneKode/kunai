const RECEIVER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kunai Cast Receiver</title>
    <script src="https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js"></script>
    <style>
      html, body { width: 100%; height: 100%; margin: 0; background: #09090b; color: #fafafa; }
      cast-media-player { --background-color: #09090b; --splash-image: none; }
      #mode { position: fixed; left: 4vw; bottom: 4vh; font: 500 2.2vw system-ui, sans-serif; opacity: .72; }
    </style>
  </head>
  <body>
    <cast-media-player></cast-media-player>
    <div id="mode">Kunai · Experimental audio-only receiver</div>
    <script>
      (() => {
        const namespace = "urn:x-cast:dev.kunai.receiver.v1";
        const context = cast.framework.CastReceiverContext.getInstance();
        const player = context.getPlayerManager();
        const senders = new Set();

        const sendClock = (event) => {
          const currentTime = Number(event && event.currentMediaTime);
          const duration = Number(event && event.duration);
          const payload = {
            type: "clock",
            state: player.getPlayerState(),
            currentTime: Number.isFinite(currentTime) ? currentTime : player.getCurrentTimeSec(),
            duration: Number.isFinite(duration) ? duration : player.getDurationSec(),
            observedAt: Date.now(),
          };
          for (const senderId of senders) context.sendCustomMessage(namespace, senderId, payload);
        };

        context.addCustomMessageListener(namespace, (event) => {
          senders.add(event.senderId);
          if (event.data && event.data.type === "clock-request") sendClock();
        });
        for (const name of ["PLAYING", "PAUSE", "SEEKED", "TIME_UPDATE", "MEDIA_FINISHED", "ERROR"]) {
          const type = cast.framework.events.EventType[name];
          if (type) player.addEventListener(type, sendClock);
        }

        context.start({ disableIdleTimeout: true });
      })();
    </script>
  </body>
</html>`;

export function GET(): Response {
  return new Response(RECEIVER_HTML, {
    headers: {
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline' https://www.gstatic.com; style-src 'unsafe-inline'; media-src http: https:; connect-src http: https: ws: wss:",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
