import { connectMcp } from "@/assistant/mcp";

// Serves an MCP Apps view to the simulator's screen. The HTML is read from the
// MCP server with resources/read, the same way a host fetches a ui:// resource.

const cache = new Map<string, string>();

export async function GET(request: Request) {
  const uri = new URL(request.url).searchParams.get("uri") ?? "";
  if (!/^ui:\/\/fanroute-live\/[a-z-]+\.html$/.test(uri)) return Response.json({ error: "Unknown view" }, { status: 400 });
  let html = cache.get(uri);
  if (!html) {
    const session = await connectMcp(new URL("/api/mcp", process.env.PUBLIC_BASE_URL ?? request.url));
    try {
      html = (await session.readUi(uri)) ?? undefined;
    } finally {
      await session.close().catch(() => undefined);
    }
    if (!html) return Response.json({ error: "View not found" }, { status: 404 });
    cache.set(uri, html);
  }
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=600" } });
}
