export type BrowseMutationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

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
  operation: () => Promise<void> | void,
): Promise<BrowseMutationResult> {
  try {
    await operation();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Action failed",
    };
  }
}
