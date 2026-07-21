/**
 * Tracks Kitty graphics placements by named slot so siblings can coexist.
 * Per-fetch cleanup must delete only the slot's imageId — never `d=A`.
 * Global wipe (`deleteAllTerminalImages`) is reserved for surface exit / resize.
 */

export type KittyPlacementSlot =
  | "browse-preview"
  | "postplay-hero"
  | "postplay-rail"
  | "postplay-discovery-0"
  | "postplay-discovery-1"
  | "postplay-discovery-2"
  | "playing-rail"
  | "overlay-picker"
  | "details-primary"
  | "details-secondary"
  | "details-sheet"
  | "generic";

type PlacementEntry = {
  readonly imageId: number;
};

const placements = new Map<KittyPlacementSlot, PlacementEntry>();
/** Reverse index so cache eviction can release the owning slot. */
const imageIdToSlot = new Map<number, KittyPlacementSlot>();

export type KittyPlacementDeleteFn = (imageId: number) => void;
/** Notified when an imageId is deleted so poster caches can drop stale entries. */
export type KittyPlacementEvictFn = (imageId: number) => void;

let deleteFn: KittyPlacementDeleteFn = () => {
  // Wired by poster-renderer after deleteKittyImage is defined.
};
let evictFn: KittyPlacementEvictFn = () => {
  // Wired by image-pane to drop posterCache entries for dead imageIds.
};

/** Inject the terminal delete writer (tests / poster-renderer bootstrap). */
export function setKittyPlacementDeleteFn(fn: KittyPlacementDeleteFn): void {
  deleteFn = fn;
}

/** Inject cache eviction when imageIds are deleted from the terminal. */
export function setKittyPlacementEvictFn(fn: KittyPlacementEvictFn): void {
  evictFn = fn;
}

function deleteAndEvict(imageId: number): void {
  deleteFn(imageId);
  evictFn(imageId);
}

export function registerKittyPlacement(slot: KittyPlacementSlot, imageId: number): void {
  const previous = placements.get(slot);
  if (previous && previous.imageId !== imageId) {
    imageIdToSlot.delete(previous.imageId);
    deleteAndEvict(previous.imageId);
  }
  placements.set(slot, { imageId });
  imageIdToSlot.set(imageId, slot);
}

/** Delete only this slot's Kitty image; leave siblings alone. */
export function releaseKittySlot(slot: KittyPlacementSlot): void {
  const entry = placements.get(slot);
  if (!entry) return;
  placements.delete(slot);
  imageIdToSlot.delete(entry.imageId);
  deleteAndEvict(entry.imageId);
}

/** Delete by image id and clear its slot registration (cache eviction). */
export function releaseKittyImageId(imageId: number): void {
  const slot = imageIdToSlot.get(imageId);
  if (slot) {
    placements.delete(slot);
    imageIdToSlot.delete(imageId);
  }
  deleteAndEvict(imageId);
}

/** Clear registry bookkeeping without emitting terminal sequences (after d=A). */
export function clearKittyPlacementRegistry(): void {
  placements.clear();
  imageIdToSlot.clear();
}

export function getKittyPlacement(slot: KittyPlacementSlot): number | undefined {
  return placements.get(slot)?.imageId;
}

export function listKittyPlacementSlots(): readonly KittyPlacementSlot[] {
  return [...placements.keys()];
}

export const __testing = {
  /** Clear placements only — leave delete/evict wiring intact for sibling modules. */
  reset(): void {
    clearKittyPlacementRegistry();
  },
  get placements() {
    return placements;
  },
  get imageIdToSlot() {
    return imageIdToSlot;
  },
};
