import Anthropic from "@anthropic-ai/sdk";
import { resultText, type McpCallResult, type McpSession } from "./mcp";
import type { Device } from "./rules";

// The Claude "brain" for the simulator: a short manual tool-use loop whose
// tools are exactly the MCP server's tools, discovered over MCP. Low effort
// keeps a voice turn quick; the server's own instructions do the rest.

const MODEL = process.env.ASSISTANT_MODEL ?? "claude-opus-5-5";
const MAX_TURNS = 5;

export type AssistantEvent =
  | { type: "mode"; brain: "claude" | "rules"; model?: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: McpCallResult; uiResourceUri?: string }
  | { type: "say"; text: string }
  | { type: "history"; messages: Anthropic.Beta.BetaMessageParam[] }
  | { type: "error"; message: string }
  | { type: "done" };

const system = (device: Device, instructions: string) => `You are the voice assistant on a screen device in someone's home, in a simulated Alexa+ experience built for a hackathon demo. You help with live music through the Fanroute Live tools.

${instructions}

How to talk:
- Replies are spoken aloud. Use one to three short sentences, plain words, no lists, no markdown, no URLs.
- The screen already shows the details from tool results, so summarize instead of repeating everything.
- If a tool says the data is demo data, don't hide it if the user asks.

Context: the user is in ${device.city}. Artists they've said they like: ${device.likes.join(", ") || "none yet"}. Today is ${device.today ?? new Date().toISOString().slice(0, 10)} (the user's local date).`;

export async function runClaude(opts: {
  session: McpSession;
  instructions: string;
  history: Anthropic.Beta.BetaMessageParam[];
  utterance: string;
  device: Device;
  emit: (e: AssistantEvent) => void;
  signal?: AbortSignal;
}) {
  const client = new Anthropic();
  const byName = new Map(opts.session.tools.map((t) => [t.name, t]));
  const tools: Anthropic.Beta.BetaTool[] = opts.session.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [...opts.history, { role: "user", content: opts.utterance }];
  opts.emit({ type: "mode", brain: "claude", model: MODEL });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 4096,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: system(opts.device, opts.instructions),
        tools,
        messages,
      },
      { signal: opts.signal },
    );
    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason === "refusal") {
      opts.emit({ type: "say", text: "Sorry, I can't help with that one." });
      break;
    }
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || uses.length === 0) {
      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      opts.emit({ type: "say", text: text || "Okay." });
      break;
    }

    // Run every tool call from this turn, then return all results in one message.
    const results = await Promise.all(
      uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const args = (u.input ?? {}) as Record<string, unknown>;
        opts.emit({ type: "tool_call", id: u.id, name: u.name, arguments: args });
        try {
          const r = await opts.session.call(u.name, args);
          opts.emit({ type: "tool_result", id: u.id, name: u.name, result: r, uiResourceUri: byName.get(u.name)?.uiResourceUri });
          const data = r.structuredContent ? `\n\nData: ${JSON.stringify(r.structuredContent)}` : "";
          return { type: "tool_result", tool_use_id: u.id, content: resultText(r) + data, is_error: r.isError };
        } catch (err) {
          const message = err instanceof Error ? err.message : "tool failed";
          return { type: "tool_result", tool_use_id: u.id, content: `Tool error: ${message}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  opts.emit({ type: "history", messages });
}
