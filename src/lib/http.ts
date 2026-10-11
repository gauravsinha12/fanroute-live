// Small fetch helper: timeout, a couple of retries on 429/5xx, and an in-memory
// cache so repeated voice turns don't re-hit the same upstream.

const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 400;

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function getJson<T>(url: string, init: { headers?: Record<string, string>; cache?: boolean; timeoutMs?: number } = {}): Promise<T> {
  const useCache = init.cache !== false;
  const hit = useCache ? cache.get(url) : undefined;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: init.headers, signal: AbortSignal.timeout(init.timeoutMs ?? 12_000), cache: "no-store" });
      if (res.status === 429 || res.status >= 500) throw new UpstreamError(`${new URL(url).host} ${res.status}`, res.status);
      if (!res.ok) throw new UpstreamError(`${new URL(url).host} ${res.status}`, res.status);
      const value = (await res.json()) as T;
      if (useCache) {
        if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(url, { at: Date.now(), value });
      }
      return value;
    } catch (err) {
      lastErr = err;
      const retryable = !(err instanceof UpstreamError) || err.status === 429 || (err.status ?? 0) >= 500;
      if (!retryable) break;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
