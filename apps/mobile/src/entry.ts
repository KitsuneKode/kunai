import { createMobileEnvironment, exitMobile, mobileArgv, mobileVersion } from "mobile:runtime";

import { runMobileApplication } from "./application/run-mobile-application";

void runMobileApplication({
  argv: mobileArgv(),
  environment: createMobileEnvironment(),
  version: mobileVersion(),
})
  .then((result) => exitMobile(result.code))
  .catch(() => exitMobile(1));
