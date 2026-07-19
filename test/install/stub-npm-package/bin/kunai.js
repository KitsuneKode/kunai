#!/usr/bin/env node
// Stub stand-in for an older npm-installed Kunai. Reports its version so
// scenarios can tell which build owns PATH after a native install.
const arg = process.argv[2];
console.log(arg === "--version" || arg === "-v" ? "0.1.0" : "kunai npm stub 0.1.0");
