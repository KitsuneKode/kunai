let pendingShareBootstrapStartSeconds: number | undefined;

export function setShareBootstrapStartSeconds(seconds: number | undefined): void {
  pendingShareBootstrapStartSeconds = seconds;
}

export function consumeShareBootstrapStartSeconds(): number | undefined {
  const value = pendingShareBootstrapStartSeconds;
  pendingShareBootstrapStartSeconds = undefined;
  return value;
}

export function primeShareBootstrapStartSeconds(seconds: number | undefined): void {
  if (seconds !== undefined) {
    setShareBootstrapStartSeconds(seconds);
  }
}
