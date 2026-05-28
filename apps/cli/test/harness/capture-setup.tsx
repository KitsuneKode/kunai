import { SetupHarnessWelcomeSlide } from "@/app-shell/setup-shell";
import React from "react";

import { captureSurface } from "./render-capture";

await captureSurface("setup-welcome", <SetupHarnessWelcomeSlide width={100} rows={40} />);
console.log("captured setup welcome slide");
process.exit(0);
