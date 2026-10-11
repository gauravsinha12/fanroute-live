import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

// The simulated assistant reaches Fanroute Live exactly like a real host
// would: as an MCP client over Streamable HTTP to the public /api/mcp URL.

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  uiResourceUri?: string;
}

export interface McpCallResult {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

export async function connectMcp(url: URL) {
  const client = new Client({ name: "fanroute-live-echo-show", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(url));
  const listed = await client.listTools();
  const tools: McpToolInfo[] = listed.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
    uiResourceUri: (t._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri,
  }));
  return {
    tools,
    async call(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
      return (await client.callTool({ name, arguments: args })) as McpCallResult;
    },
    async readUi(uri: string): Promise<string | null> {
      const res = await client.readResource({ uri });
      const first = res.contents[0] as { text?: string } | undefined;
      return first?.text ?? null;
    },
    close: () => client.close(),
  };
}

export type McpSession = Awaited<ReturnType<typeof connectMcp>>;

export const resultText = (r: McpCallResult) =>
  r.content
    .map((c) => (c.type === "text" ? c.text ?? "" : ""))
    .join(" ")
    .trim();
