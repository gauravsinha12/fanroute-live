"use client";

import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { useEffect, useRef } from "react";

// Host side of MCP Apps: renders a tool's ui:// view in a sandboxed iframe and
// talks to it with the official AppBridge (JSON-RPC over postMessage). After
// the view says it's initialized, the host sends the tool input and result.

const viewCache = new Map<string, Promise<string>>();
const loadView = (uri: string) => {
  let p = viewCache.get(uri);
  if (!p) {
    p = fetch(`/api/ui?uri=${encodeURIComponent(uri)}`).then((r) => {
      if (!r.ok) throw new Error(`view ${r.status}`);
      return r.text();
    });
    p.catch(() => viewCache.delete(uri));
    viewCache.set(uri, p);
  }
  return p;
};

/** Warm the cache so the first card appears as soon as its result arrives. */
export const prefetchViews = (uris: string[]) => uris.forEach((u) => void loadView(u).catch(() => undefined));

export interface ToolResult {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

export function McpAppFrame({ uri, toolInput, toolResult }: { uri: string; toolInput: Record<string, unknown>; toolResult: ToolResult }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let bridge: AppBridge | undefined;
    let iframe: HTMLIFrameElement | undefined;

    (async () => {
      const html = await loadView(uri);
      if (disposed || !host.current) return;
      iframe = document.createElement("iframe");
      // No allow-same-origin: the view runs in an opaque origin and can only
      // reach the host through the bridge.
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.title = "Fanroute Live card";
      iframe.className = "h-full w-full border-0 bg-transparent";
      host.current.replaceChildren(iframe);

      bridge = new AppBridge(
        null,
        { name: "Fanroute Live Echo Show (simulated Alexa+)", version: "0.1.0" },
        { openLinks: {} },
        { hostContext: { theme: "dark", displayMode: "inline" } },
      );
      bridge.onopenlink = async ({ url }) => {
        window.open(url, "_blank", "noopener,noreferrer");
        return {};
      };
      bridge.oninitialized = () => {
        void bridge?.sendToolInput({ arguments: toolInput });
        void bridge?.sendToolResult(toolResult as Parameters<AppBridge["sendToolResult"]>[0]);
      };
      // Listen before the view loads, so its ui/initialize isn't missed.
      const win = iframe.contentWindow!;
      await bridge.connect(new PostMessageTransport(win, win));
      if (!disposed) iframe.srcdoc = html;
    })().catch((err) => {
      if (host.current && !disposed) host.current.textContent = `Couldn't load the card (${err instanceof Error ? err.message : "error"}).`;
    });

    return () => {
      disposed = true;
      void bridge?.close();
      iframe?.remove();
    };
  }, [uri, toolInput, toolResult]);

  return <div ref={host} className="h-full w-full" />;
}
