// End-to-end check of the MCP endpoint with two real clients:
//   1. the MCP TypeScript SDK v2 client (newest protocol), and
//   2. the v1 SDK client, which speaks spec 2025-11-25 Streamable HTTP.
// Usage: npx tsx scripts/mcp-check.mts [http://localhost:3218/api/mcp]
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as LegacyTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.argv[2] ?? "http://localhost:3218/api/mcp");
const text = (r: { content?: unknown }) => ((r.content as { type: string; text?: string }[] | undefined) ?? []).map((c) => c.text ?? `[${c.type}]`).join(" ");
let failed = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
};

// --- v2 client ---
{
  const client = new Client({ name: "fanroute-live-check", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(url));
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  check(names.join(",") === "bring_artist_to_city,find_concerts,pledge_progress,similar_artists", `v2 tools/list: ${names.join(", ")}`);
  const concertsTool = tools.tools.find((t) => t.name === "find_concerts");
  const uiUri = (concertsTool?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri;
  check(uiUri === "ui://fanroute-live/concerts.html", `find_concerts declares MCP Apps view ${uiUri}`);

  const res = await client.readResource({ uri: "ui://fanroute-live/concerts.html" });
  const first = res.contents[0] as { mimeType?: string; text?: string };
  check(first.mimeType === "text/html;profile=mcp-app" && (first.text?.length ?? 0) > 100_000, `resources/read concerts view: ${first.mimeType}, ${first.text?.length} chars`);

  const t0 = Date.now();
  const concerts = await client.callTool({ name: "find_concerts", arguments: { city: "Chicago", likes: ["Clairo"] } });
  const sc = concerts.structuredContent as { shows?: unknown[]; sources?: { taste: string; events: string } } | undefined;
  check(Array.isArray(sc?.shows), `find_concerts in ${Date.now() - t0} ms, ${sc?.shows?.length} shows, sources ${JSON.stringify(sc?.sources)}`);
  console.log("      says:", text(concerts).slice(0, 220));

  const similar = await client.callTool({ name: "similar_artists", arguments: { artist: "Prateek Kuhad", limit: 5 } });
  check(!similar.isError, "similar_artists");
  console.log("      says:", text(similar).slice(0, 200));

  const pledge = await client.callTool({ name: "bring_artist_to_city", arguments: { artist: process.env.CHECK_ARTIST ?? "Juniper Static", city: "Chicago" } });
  check(!pledge.isError, `bring_artist_to_city status=${(pledge.structuredContent as { status?: string })?.status} qr=${Boolean((pledge._meta as Record<string, unknown> | undefined)?.["fanroute/qr"])}`);
  console.log("      says:", text(pledge).slice(0, 260));
  await client.close();
}

// --- v1 client, spec 2025-11-25 ---
{
  const legacy = new LegacyClient({ name: "fanroute-live-check-2025", version: "0.1.0" });
  const transport = new LegacyTransport(url);
  await legacy.connect(transport);
  const tools = await legacy.listTools();
  check(tools.tools.length === 4, `2025-11-25 client tools/list (${transport.protocolVersion ?? "negotiated"}): ${tools.tools.length} tools`);
  const r = await legacy.callTool({ name: "similar_artists", arguments: { artist: "Clairo", limit: 3 } });
  check(!r.isError, `2025-11-25 client tools/call: ${text(r as { content?: unknown }).slice(0, 120)}`);
  await legacy.close();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
