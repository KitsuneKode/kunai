/**
 * Strip trailing `/` characters in linear time.
 *
 * `value.replace(/\/+$/, "")` backtracks quadratically on a long run of `/`
 * not at the end (CodeQL js/polynomial-redos), and these values can come from a
 * hotfix manifest or a provider response.
 */
export function trimTrailingSlashes(value: string): string {
  return trimTrailingCharCode(value, 47);
}

/** Strip trailing `.` characters (a DNS root dot) in linear time. */
export function trimTrailingDots(value: string): string {
  return trimTrailingCharCode(value, 46);
}

function trimTrailingCharCode(value: string, charCode: number): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === charCode) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}
