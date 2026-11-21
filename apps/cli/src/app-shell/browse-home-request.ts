// Fox click and ⌃G toggle. Away from home, they remember this place and
// leave. On the idle home, they put that place back. Playback stays a one-way
// exit: the return trip would start a video.

type HomeRestore = () => void;
type HomeLeaveHandler = () => HomeRestore | null;

const leaveHandlers = new Set<HomeLeaveHandler>();
let returnTrip: HomeRestore | null = null;
let browseAtHome = false;

export function setBrowseAtHome(atHome: boolean): void {
  browseAtHome = atHome;
}

export function isBrowseAtHome(): boolean {
  return browseAtHome;
}

export function subscribeBrowseHome(handler: HomeLeaveHandler): () => void {
  leaveHandlers.add(handler);
  return () => {
    leaveHandlers.delete(handler);
  };
}

/** Ask the mounted browse shell to snapshot what is showing and clear it. */
export function leaveForBrowseHome(): boolean {
  const restores: HomeRestore[] = [];
  for (const handler of leaveHandlers) {
    const restore = handler();
    if (restore) restores.push(restore);
  }
  if (restores.length === 0) return false;
  const previous = returnTrip;
  returnTrip = () => {
    previous?.();
    for (const restore of restores) restore();
  };
  return true;
}

export function clearBrowseHomeReturn(): void {
  returnTrip = null;
}

/** Run after the browse snapshot, so a restored overlay covers the restored view. */
export function pushBrowseHomeReturn(restore: HomeRestore): void {
  const previous = returnTrip;
  returnTrip = () => {
    previous?.();
    restore();
  };
}

export function returnFromBrowseHome(): boolean {
  if (!returnTrip) return false;
  const restore = returnTrip;
  returnTrip = null;
  restore();
  return true;
}
