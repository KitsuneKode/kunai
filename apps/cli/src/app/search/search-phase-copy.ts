export function appendSearchFilterChip(query: string, chip: string): string {
  const trimmed = query.trim();
  if (!trimmed) return chip;
  if (trimmed.split(/\s+/).includes(chip)) return trimmed;
  return `${trimmed} ${chip}`;
}
