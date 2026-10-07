import {
  createRelayDevServerOptions,
  resolveRelayDevelopmentPolicy,
} from "../src/relay-runtime-policy";

function main(): void {
  const policy = resolveRelayDevelopmentPolicy({
    PORT: process.env.PORT,
    RELAY_HOST: process.env.RELAY_HOST,
    RELAY_TOKEN: process.env.RELAY_TOKEN,
    RELAY_CORS_ORIGINS: process.env.RELAY_CORS_ORIGINS,
  });
  const options = createRelayDevServerOptions(policy);

  Bun.serve(options);

  const displayHostname = policy.hostname.includes(":") ? `[${policy.hostname}]` : policy.hostname;
  console.log(`kunai relay dev server listening on http://${displayHostname}:${policy.port}`);
}

main();
