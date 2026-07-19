/** Redis key layout for Kunai telemetry ingest. Never store raw install UUIDs or IPs. */

export const REDIS_KEYS = {
  ipRateLimit: (ipHash: string) => `kunai:tlm:rl:ip:${ipHash}`,
  installDayGate: (day: string, installHash: string) => `kunai:tlm:rl:id:${day}:${installHash}`,
  daySet: (day: string) => `kunai:tlm:day:${day}`,
  dayCount: (day: string) => `kunai:tlm:daycount:${day}`,
  lifetime: () => `kunai:tlm:life`,
  publicSnapshot: () => `kunai:tlm:public:daily`,
} as const;

export const DAY_SET_TTL_SECONDS = 48 * 60 * 60;
export const DAY_COUNT_TTL_SECONDS = 400 * 24 * 60 * 60;
export const IP_RATE_WINDOW_SECONDS = 60;
export const IP_RATE_MAX = 30;
