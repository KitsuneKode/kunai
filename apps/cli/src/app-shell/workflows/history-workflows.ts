import { formatRelativeAge } from "@/domain/relative-age";

export function relativeHistoryDate(isoDate: string): string {
  return formatRelativeAge(isoDate) ?? new Date(isoDate).toLocaleDateString();
}
