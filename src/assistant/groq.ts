import { systemPrompt, type AssistantEvent } from "./claude";
import { resultText, type McpSession } from "./mcp";
import type { Device } from "./rules";

// The Groq "brain" for the simulator: the same short tool-use loop as the
// Claude one, on Groq's OpenAI-compatible API. Tools are the MCP server's own
// tools, discovered over MCP. History and tool data are trimmed so a voice
// turn stays well inside Groq's free-tier tokens-per-minute limit.

const BASE_URL = process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";
export const GROQ_MODEL = process.env.ASSISTANT_GROQ_MODEL ?? "openai/gpt-oss-120b";
const MAX_TURNS = 4;
const MAX_HISTORY = 8;
const MAX_TOOL_CHARS = 2500;

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type GroqMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

async function complete(body: Record<string, unknown>, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) return (await res.json()) as { choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[] };
    if (res.status === 429 && attempt < 2) {
      const seconds = Math.min(Number(res.headers.get("retry-after")) || 4, 10);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      continue;
    }
    throw new Error(`Groq ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
}

// Only spoken turns carry over between questions: earlier tool data is on
// screen already and would eat the token budget.
function trimHistory(history: unknown[]): GroqMessage[] {
  return (history as GroqMessage[])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content && !("tool_calls" in m && m.tool_calls))
    .slice(-MAX_HISTORY);
}

export async function runGroq(opts: {
  session: McpSession;
  instructions: string;
  history: unknown[];
  utterance: string;
  device: Device;
  emit: (e: AssistantEvent) => void;
  signal?: AbortSignal;
}) {
  const byName = new Map(opts.session.tools.map((t) => [t.name, t]));
  const tools = opts.session.tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema },
  }));
  const spoken = trimHistory(opts.history);
  const messages: GroqMessage[] = [...spoken, { role: "user", content: opts.utterance }];
  opts.emit({ type: "mode", brain: "groq", model: GROQ_MODEL });

  let answer = "";
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await complete(
      {
        model: GROQ_MODEL,
        messages: [{ role: "system", content: systemPrompt(opts.device, opts.instructions) }, ...messages],
        tools,
        tool_choice: "auto",
        temperature: 0.3,
        max_completion_tokens: 1024,
        ...(GROQ_MODEL.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
      },
      opts.signal,
    );
    const message = res.choices[0]?.message;
    const calls = message?.tool_calls ?? [];
    messages.push({ role: "assistant", content: message?.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (calls.length === 0) {
      // Spoken aloud: plain spaces only (models like narrow no-break spaces).
      answer = (message?.content ?? "").replace(/[\u00a0\u202f\u2009]/g, " ").trim() || "Okay.";
      break;
    }
    const results = await Promise.all(
      calls.map(async (call): Promise<GroqMessage> => {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          return { role: "tool", tool_call_id: call.id, content: "Arguments were not valid JSON; call the tool again." };
        }
        opts.emit({ type: "tool_call", id: call.id, name: call.function.name, arguments: args });
        try {
          const r = await opts.session.call(call.function.name, args);
          opts.emit({ type: "tool_result", id: call.id, name: call.function.name, result: r, uiResourceUri: byName.get(call.function.name)?.uiResourceUri });
          const data = r.structuredContent ? `\n\nData: ${JSON.stringify(r.structuredContent)}` : "";
          return { role: "tool", tool_call_id: call.id, content: (resultText(r) + data).slice(0, MAX_TOOL_CHARS) };
        } catch (err) {
          return { role: "tool", tool_call_id: call.id, content: `Tool error: ${err instanceof Error ? err.message : "tool failed"}` };
        }
      }),
    );
    messages.push(...results);
  }
  opts.emit({ type: "say", text: answer || "Here's what I found." });
  opts.emit({ type: "history", messages: [...spoken, { role: "user", content: opts.utterance }, { role: "assistant", content: answer || "Here's what I found." }] });
}
