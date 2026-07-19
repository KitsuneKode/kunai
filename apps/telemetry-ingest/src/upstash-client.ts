/**
 * Minimal Upstash Redis REST client (pipeline-friendly).
 * Avoids a hard dependency so unit tests stay offline by default.
 */

export type UpstashRedis = {
  command<T = unknown>(...args: readonly (string | number)[]): Promise<T>;
};

export function createUpstashRedis(options: {
  readonly url: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
}): UpstashRedis {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.url.replace(/\/$/, "");
  const token = options.token;

  return {
    async command<T = unknown>(...args: readonly (string | number)[]): Promise<T> {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Upstash command failed (${response.status}): ${text.slice(0, 200)}`);
      }
      const payload = (await response.json()) as { result?: T; error?: string };
      if (payload.error) {
        throw new Error(`Upstash error: ${payload.error}`);
      }
      return payload.result as T;
    },
  };
}
