"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { McpAppFrame, prefetchViews, type ToolResult } from "./McpAppFrame";

type LogEntry =
  | { kind: "you"; text: string; at: number }
  | { kind: "call"; id: string; name: string; args: Record<string, unknown>; at: number }
  | { kind: "result"; id: string; name: string; result: ToolResult; uri?: string; at: number }
  | { kind: "say"; text: string; at: number }
  | { kind: "error"; text: string; at: number };

interface View {
  id: number;
  uri: string;
  args: Record<string, unknown>;
  result: ToolResult;
}

const EXAMPLES = [
  "Alexa, any shows I'd like this month? I love Clairo.",
  "Alexa, I want Juniper Static to play Chicago.",
  "Alexa, how are the Juniper Static pledges going?",
  "Alexa, who sounds like Prateek Kuhad?",
];

// Minimal typing for the Web Speech API, which TypeScript's DOM lib lacks.
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

const noop = () => () => {};
const subscribeClock = (onChange: () => void) => {
  const t = setInterval(onChange, 10_000);
  return () => clearInterval(t);
};

function speak(text: string, enabled: boolean) {
  if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  u.voice =
    voices.find((v) => /Aria|Jenny|Samantha|Google US English/i.test(v.name)) ?? voices.find((v) => v.lang?.startsWith("en-US")) ?? null;
  u.rate = 1.03;
  window.speechSynthesis.speak(u);
}

export function EchoShow() {
  const [city, setCity] = useState("Chicago");
  const [likesText, setLikesText] = useState("Clairo");
  const likes = useMemo(
    () =>
      likesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3),
    [likesText],
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [brain, setBrain] = useState<string>("");
  const [voiceOn, setVoiceOn] = useState(true);

  const history = useRef<unknown[]>([]);
  const lastArgs = useRef<Record<string, unknown>>({});
  const recognition = useRef<Recognition | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "");
  const endpoint = `${origin}/api/mcp`;
  const minute = useSyncExternalStore(subscribeClock, () => Math.floor(Date.now() / 60_000), () => 0);
  const now = minute ? new Date(minute * 60_000) : null;

  useEffect(() => {
    prefetchViews(["ui://fanroute-live/concerts.html", "ui://fanroute-live/pledge.html"]);
  }, []);

  useEffect(() => {
    // Recent Chrome returns a Promise from scrollIntoView; an effect must not return it.
    void logEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [log]);

  const ask = useCallback(
    async (utterance: string) => {
      const text = utterance.trim();
      if (!text || busy) return;
      setBusy(true);
      setHeard(text);
      setReply(null);
      setLog((l) => [...l, { kind: "you", text, at: Date.now() }]);
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ utterance: text, device: { city, likes }, history: history.current }),
        });
        if (res.status === 429) {
          setReply("That's a lot of questions at once. Give me a minute and ask again.");
          return;
        }
        if (!res.ok || !res.body) throw new Error(`assistant ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const line = buf.slice(0, i).replace(/^data: /, "");
            buf = buf.slice(i + 2);
            if (!line) continue;
            const e = JSON.parse(line);
            if (e.type === "mode") setBrain(e.brain === "claude" ? `Claude (${e.model}) · low effort` : "Intent router · no model key");
            else if (e.type === "tool_call") {
              lastArgs.current = e.arguments;
              setLog((l) => [...l, { kind: "call", id: e.id, name: e.name, args: e.arguments, at: Date.now() }]);
            }
            else if (e.type === "tool_result") {
              setLog((l) => [...l, { kind: "result", id: e.id, name: e.name, result: e.result, uri: e.uiResourceUri, at: Date.now() }]);
              if (e.uiResourceUri && !e.result.isError) setView({ id: Date.now(), uri: e.uiResourceUri, args: lastArgs.current, result: e.result });
            } else if (e.type === "say") {
              setReply(e.text);
              setLog((l) => [...l, { kind: "say", text: e.text, at: Date.now() }]);
              speak(e.text, voiceOn);
            } else if (e.type === "history") history.current = e.messages;
            else if (e.type === "error") setLog((l) => [...l, { kind: "error", text: e.message, at: Date.now() }]);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "failed";
        setLog((l) => [...l, { kind: "error", text: msg, at: Date.now() }]);
        setReply("Sorry, I couldn't reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [busy, city, likes, voiceOn],
  );

  const toggleMic = useCallback(() => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setReply("Voice input needs Chrome or Edge. You can type instead.");
      return;
    }
    window.speechSynthesis?.cancel();
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setHeard(finalText || interim);
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setReply(`Microphone error: ${e.error}`);
    };
    r.onend = () => {
      setListening(false);
      if (finalText.trim()) void ask(finalText);
    };
    recognition.current = r;
    setListening(true);
    setReply(null);
    setHeard("");
    r.start();
  }, [listening, ask]);

  const time = now?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = now?.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-8">
      <section className="min-w-0">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-xs tracking-[0.18em] text-ink-3 uppercase">Amazon Developer Hackathon · Alexa+ track</p>
            <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Fanroute <span className="text-accent">Live</span>
            </h1>
            <p className="mt-1 max-w-xl text-sm text-ink-2">
              An MCP server that lets Alexa+ find the concerts you&apos;d love and pull the artists you want to your city, shown here on a simulated Echo Show.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <label className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5">
              <span className="text-ink-3">City</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} className="w-24 bg-transparent text-ink outline-none" aria-label="Your city" />
            </label>
            <label className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5">
              <span className="text-ink-3">You like</span>
              <input value={likesText} onChange={(e) => setLikesText(e.target.value)} className="w-40 bg-transparent text-ink outline-none" aria-label="Artists you like, comma separated" />
            </label>
          </div>
        </header>

        {/* The device */}
        <div className="rounded-[34px] bg-gradient-to-b from-[#1c1c22] to-[#0c0c0f] p-3 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/5 sm:p-4">
          <div className="relative aspect-[16/10] overflow-hidden rounded-[22px] bg-screen">
            {view ? (
              <div className="absolute inset-0 overflow-auto pb-16">
                <McpAppFrame key={view.id} uri={view.uri} toolInput={view.args} toolResult={view.result} />
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col justify-between p-6 sm:p-10">
                <div>
                  <p className="font-display text-5xl font-bold tabular-nums sm:text-7xl">{time ?? " "}</p>
                  <p className="mt-1 text-lg text-ink-2 sm:text-xl">{date}</p>
                </div>
                <div className="max-w-lg">
                  <p className="text-sm tracking-wide text-ink-3 uppercase">Try saying</p>
                  <p className="mt-1 font-display text-xl text-ink sm:text-2xl">&ldquo;Alexa, any shows I&apos;d like this month?&rdquo;</p>
                </div>
              </div>
            )}

            {(heard || reply) && (
              // With a card on screen the caption stays a slim two-line strip; the full reply is in the MCP log.
              <div
                className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t px-5 sm:px-8 ${view ? "from-black/95 via-black/80 to-transparent pt-6 pb-3" : "from-black/90 via-black/70 to-transparent pt-10 pb-5"}`}
              >
                {heard && <p className={`truncate text-ink-3 ${view ? "text-xs" : "text-sm"}`}>&ldquo;{heard}&rdquo;</p>}
                {reply && <p className={`mt-0.5 text-white ${view ? "line-clamp-2 text-sm leading-snug" : "text-base leading-snug sm:text-lg"}`}>{reply}</p>}
              </div>
            )}
            <div
              className={`absolute inset-x-0 bottom-0 h-1.5 transition-opacity duration-300 ${listening || busy ? "opacity-100" : "opacity-0"} ${listening ? "listen-bar" : "think-bar"}`}
              aria-hidden
            />
          </div>
        </div>

        {/* Controls */}
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={toggleMic}
            disabled={busy && !listening}
            className={`grid size-14 shrink-0 place-items-center rounded-full text-[#06121a] transition ${listening ? "bg-listen ring-4 ring-listen/30" : "bg-listen hover:brightness-110"} disabled:opacity-50`}
            aria-label={listening ? "Stop listening" : "Talk"}
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden>
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
            </svg>
          </button>
          <form
            className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-panel py-1.5 pr-1.5 pl-5"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
              setInput("");
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Or type what you'd say…"
              className="min-w-0 flex-1 bg-transparent py-2 text-ink outline-none placeholder:text-ink-3"
              aria-label="What you'd say"
            />
            <button type="submit" disabled={busy || !input.trim()} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-[#1a1006] disabled:opacity-40">
              Ask
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              setVoiceOn((v) => !v);
              window.speechSynthesis?.cancel();
            }}
            className="rounded-full border border-line px-3 py-2 text-xs text-ink-2"
            aria-pressed={voiceOn}
          >
            {voiceOn ? "Voice on" : "Voice off"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              type="button"
              key={ex}
              disabled={busy}
              onClick={() => void ask(ex)}
              className="rounded-full border border-line px-3 py-1.5 text-left text-xs text-ink-2 transition hover:border-accent hover:text-ink disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
          {view && (
            <button type="button" onClick={() => { setView(null); setReply(null); setHeard(null); }} className="rounded-full px-3 py-1.5 text-xs text-ink-3 underline-offset-2 hover:underline">
              Home screen
            </button>
          )}
        </div>
      </section>

      {/* MCP traffic */}
      <aside className="flex min-h-[420px] min-w-0 flex-col rounded-2xl border border-line bg-panel lg:max-h-[calc(100vh-3rem)] lg:sticky lg:top-6">
        <div className="border-b border-line p-4">
          <p className="font-mono text-[11px] tracking-[0.16em] text-ink-3 uppercase">MCP traffic · Streamable HTTP</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-screen px-2 py-1 font-mono text-xs text-ink-2">{endpoint}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(endpoint)} className="rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:text-ink">
              Copy
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-3">Brain: {brain || "waits for your first question"}</p>
        </div>
        <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-auto p-3 font-mono text-[12px] leading-relaxed">
          {log.length === 0 && <p className="p-2 text-ink-3">Ask something. Every MCP tool call and result shows up here.</p>}
          {log.map((e, i) => (
            <LogRow key={i} e={e} />
          ))}
          <div ref={logEnd} />
        </div>
      </aside>
    </div>
  );
}

function LogRow({ e }: { e: LogEntry }) {
  if (e.kind === "you") return <p className="rounded-lg bg-screen px-3 py-2 text-ink">you: {e.text}</p>;
  if (e.kind === "say") return <p className="rounded-lg px-3 py-2 text-listen">assistant: {e.text}</p>;
  if (e.kind === "error") return <p className="rounded-lg px-3 py-2 text-coral">error: {e.text}</p>;
  if (e.kind === "call")
    return (
      <div className="rounded-lg border border-line px-3 py-2">
        <p className="text-accent">→ tools/call {e.name}</p>
        <pre className="mt-1 whitespace-pre-wrap break-words text-ink-2">{JSON.stringify(e.args, null, 1)}</pre>
      </div>
    );
  const sc = e.result.structuredContent;
  const meta = e.result._meta ? Object.keys(e.result._meta) : [];
  return (
    <details className="rounded-lg border border-line px-3 py-2">
      <summary className="cursor-pointer text-ink">
        ← result {e.name}
        {e.result.isError ? " (error)" : ""}
        {e.uri ? <span className="text-ink-3"> · view {e.uri.replace("ui://fanroute-live/", "")}</span> : null}
      </summary>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-ink-2">
        {JSON.stringify({ content: e.result.content, structuredContent: sc, _meta: meta.length ? meta : undefined }, null, 1)}
      </pre>
    </details>
  );
}
