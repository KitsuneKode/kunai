declare module "mobile:runtime" {
  import type { MobileEnvironment } from "../application/contracts";

  export function createMobileEnvironment(): MobileEnvironment;
  export function mobileArgv(): readonly string[];
  export function mobileVersion(): string;
  export function exitMobile(code: number): void;
}
