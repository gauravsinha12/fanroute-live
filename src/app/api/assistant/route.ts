import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { runClaude, type AssistantEvent } from "@/assistant/claude";
import { connectMcp, resultText } from "@/assistant/mcp";
import { plan } from "@/assistant/rules";
import { rateLimited } from "@/lib/rate-limit";

// The simulated Alexa+ turn. Connects to this app's own MCP endpoint over
// Streamable HTTP (as any MCP host would), then answers with Claude when a key
// is configured, or with the deterministic intent router otherwise. Streams
// the turn as server-sent events so the screen can show each tool call live.

export const maxDuration = 60;

const Body = z.object({
  utterance: z.string().trim().min(1).max(400),
  device: z.object({
    city: z.string().trim().min(2).max(80).default("Chicago"),
    likes: z.array(z.string().trim().min(1).max(80)).max(3).default([]),
  }),
  history: z.array(z.unknown()).max(60).optional(),
});

export async function POST(request: Request) {
  if (rateLimited(request, { limit: 30, windowMs: 10 * 60_000 })) {
    return Response.json({ error: "Too many questions in a short time. Try again in a few minutes." }, { status: 429 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { utterance, device } = parsed.data;
  // History round-trips through the browser; drop it if it has grown (or been
  // padded) past what a voice session needs, rather than paying for it.
  const history = parsed.data.history && JSON.stringify(parsed.data.history).length <= 120_000 ? parsed.data.history : [];
  const mcpUrl = new URL("/api/mcp", process.env.PUBLIC_BASE_URL ?? request.url);
  const useClaude = Boolean(process.env.ANTHROPIC_API_KEY) && process.env.ASSISTANT_BRAIN !== "rules";

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AssistantEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      let session: Awaited<ReturnType<typeof connectMcp>> | undefined;
      try {
        session = await connectMcp(mcpUrl);
        if (useClaude) {
          await runClaude({
            session,
            instructions: INSTRUCTIONS,
            history: (history as Anthropic.Beta.BetaMessageParam[] | undefined) ?? [],
            utterance,
            device,
            emit,
            signal: request.signal,
          });
        } else {
          emit({ type: "mode", brain: "rules" });
          const p = plan(utterance, device);
          if (p.kind === "say") {
            emit({ type: "say", text: p.text });
          } else {
            const id = `call_${Date.now().toString(36)}`;
            emit({ type: "tool_call", id, name: p.name, arguments: p.args });
            const result = await session.call(p.name, p.args);
            const ui = session.tools.find((t) => t.name === p.name)?.uiResourceUri;
            emit({ type: "tool_result", id, name: p.name, result, uiResourceUri: ui });
            emit({ type: "say", text: [p.preface, resultText(result)].filter(Boolean).join(" ") });
          }
        }
      } catch (err) {
        console.error("assistant turn failed", err);
        emit({ type: "error", message: err instanceof Error ? err.message : "Something went wrong" });
        emit({ type: "say", text: "Sorry, something went wrong on my end. Please try again." });
      } finally {
        emit({ type: "done" });
        await session?.close().catch(() => undefined);
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" } });
}

// Mirrors the server's own instructions so the model sees them even if a
// client drops the initialize result's `instructions` field.
const INSTRUCTIONS = `Use find_concerts for "any shows I'd like" questions (ask for one or two artists the user likes if you don't know any), similar_artists for "who sounds like X", bring_artist_to_city when the user wants an artist to play their city, and pledge_progress for how an artist's pledges are going. A pledge is a PayPal hold, not a charge.`;
