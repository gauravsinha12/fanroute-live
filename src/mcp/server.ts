import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { bringArtist, findConcerts, findSimilar, pledgeProgress } from "./service";
import { CONCERTS_URI, PLEDGE_URI, concertsHtml, pledgeHtml } from "./ui/cards";

// The Fanroute Live MCP server. Built for a voice assistant with a screen
// (Alexa+ on an Echo Show): every tool returns a short spoken answer as text,
// structured data, and, where it helps, an MCP Apps view for the screen.

const INSTRUCTIONS = `Fanroute Live helps music fans find concerts they'll like and pull the artists they want to their city.
Voice-first rules:
- Speak the "speech" text of a result, or a shorter version of it. Read at most three shows aloud; the screen shows the rest.
- Never read URLs aloud. Pledge links are shown on screen as a QR code and sent to the user's phone.
- A pledge is a PayPal hold, not a charge: the fan only pays if that city's show is confirmed. Say this whenever you offer a pledge.
- If the user hasn't said which artists they like, ask for one or two before calling find_concerts.`;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown>; isError?: boolean };

// A failing upstream (music data, listings, Fanroute) becomes a short spoken
// apology the assistant can read out, flagged as an error for the model.
function voiceSafe<A>(what: string, fn: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      return await fn(args);
    } catch (err) {
      console.error(`${what} failed`, err);
      return { isError: true, content: [{ type: "text", text: `Sorry, I couldn't ${what} right now. Please try again in a moment.` }] };
    }
  };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "fanroute-live", title: "Fanroute Live", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  registerAppTool(
    server,
    "find_concerts",
    {
      title: "Find concerts you'd like",
      description:
        "Find upcoming concerts in a city that match the listener's taste. Expands the artists they like into similar artists (listening-session data) and matches them against upcoming music events, headliners and support acts. Defaults to the next 30 days.",
      inputSchema: z.object({
        city: z.string().min(2).max(80).describe("City to search, e.g. 'Chicago' or 'Mumbai'"),
        likes: z.array(z.string().min(1).max(80)).min(1).max(3).describe("One to three artists the listener likes"),
        from: date.optional().describe("First date, YYYY-MM-DD; defaults to today"),
        to: date.optional().describe("Last date, YYYY-MM-DD; defaults to 30 days after `from`"),
        limit: z.number().int().min(1).max(10).optional().describe("How many shows to return (default 6)"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: CONCERTS_URI } },
    },
    voiceSafe("look up concerts", async (args: { city: string; likes: string[]; from?: string; to?: string; limit?: number }) => {
      const r = await findConcerts(args);
      const { speech, ...data } = r;
      return { content: [{ type: "text", text: speech }], structuredContent: { ...data, speech } };
    }),
  );

  server.registerTool(
    "similar_artists",
    {
      title: "Similar artists",
      description: "Artists that people who listen to the given artist also listen to, strongest first.",
      inputSchema: z.object({
        artist: z.string().min(1).max(80),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    voiceSafe("find similar artists", async ({ artist, limit }: { artist: string; limit?: number }) => {
      const r = await findSimilar(artist, limit ?? 8);
      return { content: [{ type: "text", text: r.speech }], structuredContent: { ...r } };
    }),
  );

  registerAppTool(
    server,
    "bring_artist_to_city",
    {
      title: "Pledge to bring an artist to your city",
      description:
        "Use when the listener wants an artist to play their city. Finds the artist's open Fanroute pledge campaign, reports how close that city is to its goal, and returns a pledge link (shown as a QR code) for the listener to approve on their phone. The pledge is a PayPal authorization hold, captured only if the artist confirms the show in that city.",
      inputSchema: z.object({
        artist: z.string().min(1).max(120),
        city: z.string().min(2).max(80),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: PLEDGE_URI } },
    },
    voiceSafe("check fan pledges", async ({ artist, city }: { artist: string; city: string }) => {
      const r = await bringArtist(artist, city);
      const { qrSvg, ...data } = r;
      // The QR code is for the screen only, so it travels in _meta, not in what the model reads.
      return { content: [{ type: "text", text: r.speech }], structuredContent: { ...data }, _meta: qrSvg ? { "fanroute/qr": qrSvg } : undefined };
    }),
  );

  server.registerTool(
    "pledge_progress",
    {
      title: "Pledge progress",
      description: "How fan pledges for an artist stand across every city in their campaign, leading city first.",
      inputSchema: z.object({ artist: z.string().min(1).max(120) }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    voiceSafe("check pledge progress", async ({ artist }: { artist: string }) => {
      const r = await pledgeProgress(artist);
      return { content: [{ type: "text", text: r.speech }], structuredContent: { ...r } };
    }),
  );

  registerAppResource(server, "Concerts card", CONCERTS_URI, { description: "Upcoming shows matched to the listener's taste" }, async () => ({
    contents: [{ uri: CONCERTS_URI, mimeType: RESOURCE_MIME_TYPE, text: concertsHtml() }],
  }));
  registerAppResource(server, "Pledge card", PLEDGE_URI, { description: "A city's pledge progress with a QR code to pledge" }, async () => ({
    contents: [{ uri: PLEDGE_URI, mimeType: RESOURCE_MIME_TYPE, text: pledgeHtml() }],
  }));

  return server;
}
