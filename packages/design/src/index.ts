import { detectTerminalColorLevel, resolveDesignTokens } from "./color-resolution";

export { detectTerminalColorLevel, resolveDesignTokens } from "./color-resolution";
export type {
  ResolvedDesignTokens,
  ResolvedHeatRamp,
  ResolvedTokenValue,
  TerminalColorEnv,
  TerminalColorLevel,
} from "./color-resolution";
export { tokens as rawTokens } from "./tokens";
export type { TokenName, TokenValue } from "./tokens";

export const tokens = resolveDesignTokens(detectTerminalColorLevel());
