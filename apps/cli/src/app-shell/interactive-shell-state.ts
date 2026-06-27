let interactiveShellMounted = false;

export function markInteractiveShellMounted(): void {
  interactiveShellMounted = true;
}

export function clearInteractiveShellMounted(): void {
  interactiveShellMounted = false;
}

export function isInteractiveShellMounted(): boolean {
  return interactiveShellMounted;
}
