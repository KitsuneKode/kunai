import { normalizeSearchIntent, type SearchIntent, type SearchIntentMode } from "./SearchIntent";
import {
  describeSearchIntentFilters,
  parseSearchIntentText,
  type SearchIntentParseError,
} from "./SearchIntentParser";

export type SearchIntentEngineResult = {
  readonly intent: SearchIntent;
  readonly chips: readonly string[];
  readonly warnings: readonly string[];
};

export type SearchIntentEngine = {
  fromText(
    text: string,
    context: { readonly currentMode: SearchIntentMode },
  ): SearchIntentEngineResult;
};

export function createSearchIntentEngine(): SearchIntentEngine {
  return {
    fromText(text, context) {
      const parsed = parseSearchIntentText(text);
      const intent = normalizeSearchIntent({
        query: parsed.query,
        mode: parsed.mode ?? context.currentMode,
        filters: parsed.filters,
        sort: parsed.sort,
      });

      return {
        intent,
        chips: describeSearchIntentFilters({
          filters: intent.filters,
          mode: parsed.mode,
          sort: intent.sort,
          errors: parsed.errors,
        }).filter((chip) => !chip.endsWith(" ignored")),
        warnings: parsed.errors.map(formatParseWarning),
      };
    },
  };
}

function formatParseWarning(error: SearchIntentParseError): string {
  return `Ignored unsupported filter ${error.key}:${error.value}`;
}
