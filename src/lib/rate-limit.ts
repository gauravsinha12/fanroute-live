// Best-effort per-IP limiter for the public demo endpoints. It is per server
// instance, so it caps bursts rather than guaranteeing a global quota, which
// is enough to keep a public demo from running up model costs.

const hits = new Map<string, number[]>();

export function rateLimited(request: Request, { limit, windowMs }: { limit: number; windowMs: number }): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value!);
  return false;
}

// The simulator's own server reaches /api/mcp over HTTP from the host's shared
// egress address, so its calls carry this key and skip the per-IP limit.
export const INTERNAL_KEY = process.env.INTERNAL_MCP_KEY ?? process.env.VERCEL_DEPLOYMENT_ID ?? "local-dev";
export const INTERNAL_HEADER = "x-fanroute-internal";
export const isInternal = (request: Request) => request.headers.get(INTERNAL_HEADER) === INTERNAL_KEY;
