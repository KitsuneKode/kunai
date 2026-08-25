import {
  createRelayDevServerOptions,
  resolveRelayDevelopmentPolicy,
} from "../src/relay-runtime-policy";

const policy = resolveRelayDevelopmentPolicy({
  PORT: process.env.PORT,
  RELAY_HOST: process.env.RELAY_HOST,
  RELAY_TOKEN: process.env.RELAY_TOKEN,
});
const options = createRelayDevServerOptions(policy);

Bun.serve(options);

const displayHostname = policy.hostname.includes(":") ? `[${policy.hostname}]` : policy.hostname;
console.log(`kunai relay dev server listening on http://${displayHostname}:${policy.port}`);
