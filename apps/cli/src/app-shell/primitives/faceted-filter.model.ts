/**
 * Faceted filter model and helpers following the shadcn DataTableFacetedFilter pattern.
 *
 * Implements:
 * - Multi-category facet navigation with live count badges
 * - Single-select or multi-select facet toggling
 * - Search query filtering across category and option labels
 * - Category-level and global facet clearing
 * - Compact badge summary formatting ("1080p", "1080p, 720p", "3 selected")
 * - Stream candidate categorization helper for live playback & browse selection
 */

export interface FacetedFilterOption<T = string> {
  readonly value: T;
  readonly label: string;
  readonly count?: number;
  readonly detail?: string;
  readonly icon?: string;
}

export interface FacetedFilterCategory<T = string> {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly options: readonly FacetedFilterOption<T>[];
  readonly singleSelect?: boolean;
}

export interface FacetedFilterState<T = string> {
  readonly selected: ReadonlyMap<string, ReadonlySet<T>>;
  readonly searchQuery: string;
  readonly focusedCategoryIndex: number;
  readonly focusedOptionIndex: number;
}

export function createInitialFacetedFilterState<T = string>(
  initialSelected?: Record<string, Iterable<T>> | ReadonlyMap<string, ReadonlySet<T>>,
): FacetedFilterState<T> {
  const map = new Map<string, ReadonlySet<T>>();
  if (initialSelected) {
    if (initialSelected instanceof Map) {
      for (const [key, set] of initialSelected.entries()) {
        if (set.size > 0) map.set(key, new Set(set));
      }
    } else {
      for (const [key, values] of Object.entries(initialSelected)) {
        const set = new Set<T>(values);
        if (set.size > 0) map.set(key, set);
      }
    }
  }

  return {
    selected: map,
    searchQuery: "",
    focusedCategoryIndex: 0,
    focusedOptionIndex: 0,
  };
}

export function isFacetOptionSelected<T>(
  state: FacetedFilterState<T>,
  categoryId: string,
  value: T,
): boolean {
  return state.selected.get(categoryId)?.has(value) ?? false;
}

export function toggleFacetOption<T>(
  state: FacetedFilterState<T>,
  categoryId: string,
  value: T,
  singleSelect = false,
): FacetedFilterState<T> {
  const newMap = new Map<string, ReadonlySet<T>>(state.selected);
  const currentSet = new Set<T>(newMap.get(categoryId) ?? []);

  if (singleSelect) {
    if (currentSet.has(value)) {
      currentSet.clear();
      newMap.delete(categoryId);
    } else {
      currentSet.clear();
      currentSet.add(value);
      newMap.set(categoryId, currentSet);
    }
  } else {
    if (currentSet.has(value)) {
      currentSet.delete(value);
      if (currentSet.size === 0) {
        newMap.delete(categoryId);
      } else {
        newMap.set(categoryId, currentSet);
      }
    } else {
      currentSet.add(value);
      newMap.set(categoryId, currentSet);
    }
  }

  return {
    ...state,
    selected: newMap,
  };
}

export function clearCategoryFacets<T>(
  state: FacetedFilterState<T>,
  categoryId: string,
): FacetedFilterState<T> {
  if (!state.selected.has(categoryId)) return state;
  const newMap = new Map(state.selected);
  newMap.delete(categoryId);
  return {
    ...state,
    selected: newMap,
  };
}

export function clearAllFacets<T>(state: FacetedFilterState<T>): FacetedFilterState<T> {
  if (state.selected.size === 0) return state;
  return {
    ...state,
    selected: new Map(),
  };
}

export function getActiveFacetCounts<T>(state: FacetedFilterState<T>): {
  readonly total: number;
  readonly byCategory: ReadonlyMap<string, number>;
} {
  const byCategory = new Map<string, number>();
  let total = 0;

  for (const [categoryId, set] of state.selected.entries()) {
    const size = set.size;
    byCategory.set(categoryId, size);
    total += size;
  }

  return { total, byCategory };
}

/**
 * Format active category selections into a compact badge summary matching shadcn:
 * - 0 selected: ""
 * - 1 selected: "1080p"
 * - 2 selected: "1080p, 720p"
 * - >2 selected: "3 selected"
 */
export function formatFacetCategoryBadge<T = string>(
  category: FacetedFilterCategory<T>,
  selectedValues: ReadonlySet<T> | undefined,
): string {
  if (!selectedValues || selectedValues.size === 0) return "";

  const selectedOptions = category.options.filter((opt) => selectedValues.has(opt.value));
  if (selectedOptions.length === 0) return `${selectedValues.size} selected`;
  if (selectedOptions.length === 1) return selectedOptions[0]?.label ?? "";
  if (selectedOptions.length === 2) {
    return `${selectedOptions[0]?.label}, ${selectedOptions[1]?.label}`;
  }
  return `${selectedValues.size} selected`;
}

/**
 * Filter categories and their options by search query.
 * Categories with no matching options are omitted unless their title matches.
 */
export function filterCategoriesByQuery<T>(
  categories: readonly FacetedFilterCategory<T>[],
  query: string,
): readonly FacetedFilterCategory<T>[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return categories;

  return categories
    .map((category) => {
      const categoryMatches = category.title.toLowerCase().includes(trimmed);
      const matchingOptions = category.options.filter(
        (opt) =>
          categoryMatches ||
          opt.label.toLowerCase().includes(trimmed) ||
          opt.detail?.toLowerCase().includes(trimmed) ||
          String(opt.value).toLowerCase().includes(trimmed),
      );

      if (matchingOptions.length === 0 && !categoryMatches) {
        return null;
      }

      return {
        ...category,
        options: categoryMatches ? category.options : matchingOptions,
      };
    })
    .filter((c): c is FacetedFilterCategory<T> => c !== null);
}

export interface StreamCandidateLike {
  readonly qualityLabel?: string;
  readonly qualityRank?: number;
  readonly audioLanguages?: readonly string[];
  readonly providerId?: string;
  readonly protocol?: string;
  readonly container?: string;
}

/**
 * Extract faceted filter categories from an array of stream candidates with live counts.
 */
export function buildStreamFacetedCategories(
  streams: readonly StreamCandidateLike[],
): FacetedFilterCategory<string>[] {
  const qualityCounts = new Map<string, number>();
  const audioCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();
  const protocolCounts = new Map<string, number>();

  for (const s of streams) {
    const q = s.qualityLabel ?? (s.qualityRank ? `${s.qualityRank}p` : "auto");
    qualityCounts.set(q, (qualityCounts.get(q) ?? 0) + 1);

    if (s.audioLanguages && s.audioLanguages.length > 0) {
      for (const lang of s.audioLanguages) {
        audioCounts.set(lang, (audioCounts.get(lang) ?? 0) + 1);
      }
    }

    if (s.providerId) {
      providerCounts.set(s.providerId, (providerCounts.get(s.providerId) ?? 0) + 1);
    }

    const proto = s.protocol ?? s.container ?? "http";
    protocolCounts.set(proto, (protocolCounts.get(proto) ?? 0) + 1);
  }

  const qualityOrder = ["4k", "2160p", "1440p", "1080p", "720p", "480p", "360p", "auto"];
  const sortedQualities = [...qualityCounts.keys()].sort((a, b) => {
    const ai = qualityOrder.indexOf(a.toLowerCase());
    const bi = qualityOrder.indexOf(b.toLowerCase());
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });

  const categories: FacetedFilterCategory<string>[] = [];

  if (sortedQualities.length > 0) {
    categories.push({
      id: "quality",
      title: "Quality",
      icon: "◆",
      options: sortedQualities.map((q) => ({
        value: q,
        label: q.toUpperCase(),
        count: qualityCounts.get(q) ?? 0,
      })),
    });
  }

  if (audioCounts.size > 0) {
    const sortedAudio = [...audioCounts.keys()].sort();
    categories.push({
      id: "audio",
      title: "Audio",
      icon: "♫",
      options: sortedAudio.map((a) => ({
        value: a,
        label: formatLanguageLabel(a),
        count: audioCounts.get(a) ?? 0,
      })),
    });
  }

  if (providerCounts.size > 0) {
    const sortedProviders = [...providerCounts.keys()].sort();
    categories.push({
      id: "provider",
      title: "Provider",
      icon: "⚑",
      options: sortedProviders.map((p) => ({
        value: p,
        label: p,
        count: providerCounts.get(p) ?? 0,
      })),
    });
  }

  if (protocolCounts.size > 0) {
    const sortedProtocols = [...protocolCounts.keys()].sort();
    categories.push({
      id: "protocol",
      title: "Protocol",
      icon: "⚡",
      options: sortedProtocols.map((p) => ({
        value: p,
        label: p.toUpperCase(),
        count: protocolCounts.get(p) ?? 0,
      })),
    });
  }

  return categories;
}

function formatLanguageLabel(code: string): string {
  const map: Record<string, string> = {
    en: "English",
    ja: "Japanese",
    es: "Spanish",
    fr: "French",
    de: "German",
    hi: "Hindi",
    ko: "Korean",
    it: "Italian",
    pt: "Portuguese",
    zh: "Chinese",
  };
  const lower = code.toLowerCase();
  return map[lower] ?? code.toUpperCase();
}
