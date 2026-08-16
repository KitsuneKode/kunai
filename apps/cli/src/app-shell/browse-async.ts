export type BrowseMutationResult =
  /**
   * `note` is the operation's own account of what happened, which overrides the
   * caller's fixed success message. A toggle cannot be described by a constant:
   * "Updated favourites" was shown for both adding and removing, and said
   * nothing about whether the change could reach a tracker.
   */
  { readonly ok: true; readonly note?: string } | { readonly ok: false; readonly message: string };

export function createLatestRequestGate() {
  let current = 0;

  return {
    begin(): number {
      current += 1;
      return current;
    },
    isCurrent(requestId: number): boolean {
      return current === requestId;
    },
    invalidate(): void {
      current += 1;
    },
  };
}

export async function runBrowseMutation(
  operation: () => Promise<string | void> | string | void,
): Promise<BrowseMutationResult> {
  try {
    const note = await operation();
    return typeof note === "string" && note.length > 0 ? { ok: true, note } : { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Action failed",
    };
  }
}
