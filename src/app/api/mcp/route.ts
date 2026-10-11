import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "@/mcp/server";

// The MCP endpoint, over Streamable HTTP. Each request gets a fresh server
// (stateless), which suits serverless hosting: modern clients use the
// per-request protocol, and 2025-era clients (spec 2025-11-25 and earlier)
// are served by the SDK's stateless Streamable HTTP fallback.

export const maxDuration = 60;

const handler = createMcpHandler(() => createServer(), {
  onerror: (err) => console.error("mcp error", err),
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

async function handle(request: Request): Promise<Response> {
  const res = await handler.fetch(request);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = () => new Response(null, { status: 204, headers: cors });
