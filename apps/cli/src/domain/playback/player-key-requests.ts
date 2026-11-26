/**
 * Keys pressed in the mpv window, by keybinding id. The mpv bridge sends a
 * help key it has no verb for as `key:<id>`; the playback shell subscribes and
 * runs the effect that key has in the terminal, so `?` help is the one key map
 * for both windows. One player per process, so one channel.
 */
type PlayerKeyListener = (bindingId: string) => void;

const listeners = new Set<PlayerKeyListener>();

export function emitPlayerKeyRequest(bindingId: string): void {
  for (const listener of listeners) listener(bindingId);
}

export function subscribePlayerKeyRequests(listener: PlayerKeyListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
