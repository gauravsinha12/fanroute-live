# Fanroute Live

**An MCP server that lets Alexa+ find the concerts you'd love, and pull the artists you want to your city.**

> "Alexa, any shows I'd like this month? I love Clairo."
> "Alexa, I want Juniper Static to play Chicago."

Fanroute Live answers both. The first matches upcoming concerts against your taste. The second shows how close your city is to bringing that artist, with a QR code to pledge $5 on your phone. A pledge is a PayPal **hold**, not a charge: you only pay if your city's show is confirmed.

Built for the Amazon Developer Hackathon, **Alexa+ track**, on two open standards:

- **MCP over Streamable HTTP (spec 2025-11-25 and the newer per-request revision).** The server is at `/api/mcp`.
- **MCP Apps views** for the Echo Show screen, plus an **Agent Skill** (`skills/fanroute-live/SKILL.md`) that teaches any agent how to use the server well by voice.

The repo also includes a **simulated Alexa+ experience**: a web Echo Show you can talk to. It connects to the MCP server exactly like a host would, renders the MCP Apps views in sandboxed iframes through the official AppBridge, and shows every MCP call and result live.

---

## Try it

| What | Where |
|---|---|
| Simulated Echo Show | `/` (Chrome or Edge for voice input; typing works everywhere) |
| MCP endpoint | `/api/mcp` (Streamable HTTP, no auth) |
| Agent Skill | [`skills/fanroute-live/SKILL.md`](skills/fanroute-live/SKILL.md) |

To connect any MCP client, e.g. the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```

Then choose transport **Streamable HTTP** and enter URL `https://<deployment>/api/mcp`.

## Tools

| Tool | What it does | View |
|---|---|---|
| `find_concerts` | Expands the artists you like into similar artists, then matches them against upcoming music events (headliners and support acts) in your city. | `ui://fanroute-live/concerts.html` |
| `similar_artists` | "Who sounds like X?", from listening-session data. | none |
| `bring_artist_to_city` | Finds the artist's open Fanroute pledge campaign and reports your city's progress, with a pledge link and QR code. | `ui://fanroute-live/pledge.html` |
| `pledge_progress` | Pledge totals across every city in the campaign, leading city first. | none |

**Every tool result has three parts:**
- a short **spoken answer** (`content`)
- **structured data** (`structuredContent`)
- for the two visual tools, an **MCP Apps view**

The view uses large type for a kitchen-distance screen, follows the host's theme, and opens links through the host. The QR code travels in `_meta`, so it reaches the screen without filling the model's context. Failures come back as a short spoken apology with `isError`, never a stack trace.

## How it works

```
 "Alexa, any shows I'd like?"
          │
 Alexa+ / simulated Echo Show ── MCP client ──▶ /api/mcp  (Streamable HTTP, stateless)
          ▲                                        │
          │ MCP Apps view (iframe + AppBridge)     ├─ MusicBrainz + ListenBrainz → your taste, expanded
          │                                        ├─ Ticketmaster Discovery    → upcoming shows
          └──────────── spoken answer ◀────────────└─ Fanroute pledge API        → city progress + pledge link
```

- **Taste.** MusicBrainz resolves the artist and ListenBrainz's session-based similarity expands it. For example, Prateek Kuhad → The Local Train, Arijit Singh, Anuv Jain, Ritviz. Both are open data with no key.
- **Shows.** Ticketmaster's Discovery API returns all music events in the city and date window. Each event is scored by whether its headliner, or anyone on the bill, is in your expanded taste.
- **Pledges.** Run by [Fanroute](https://github.com/gauravsinha12/fanroute):
  1. An artist opens a campaign for candidate cities.
  2. Fans pledge with PayPal Orders v2 using `intent: AUTHORIZE`.
  3. The artist captures the holds for confirmed cities and voids the rest.

  Fanroute Live reads campaigns through `GET /api/campaigns?artist=` and deep-links the fan to their city's pledge.
- **Stateless serving.** `createMcpHandler` from the MCP TypeScript SDK v2 builds a fresh server per request, which suits serverless hosting.

### The simulator's "brain"

`/api/assistant` connects to `/api/mcp` as an MCP client.
- **With `ANTHROPIC_API_KEY` set:** Claude (`claude-opus-5-5`, low effort for voice latency) answers using the MCP tools it discovers, through a short tool-use loop.
- **With `GROQ_API_KEY` (and no Anthropic key):** the same short tool loop runs on Groq (`openai/gpt-oss-120b` by default, `src/assistant/groq.ts`). History and tool data are trimmed to fit the free tier.
- **Without a key:** a deterministic intent router maps common phrasings onto the same tools, so the demo always works.

## Run it

```bash
npm install
cp .env.example .env.local   # all keys optional
npm run dev                  # http://localhost:3000
npm run mcp:check            # end-to-end MCP check (v2 client + a spec 2025-11-25 client)
```

Interop: the live endpoint is also checked with the official MCP Inspector CLI (`npx @modelcontextprotocol/inspector --cli <url>/api/mcp --transport http --method tools/list`).

`npm run dev` and `npm run build` first run `scripts/vendor-app-sdk.mjs`. It inlines the MCP Apps SDK into each view, so the views run under a host's default sandbox CSP without extra domains.

| Variable | Purpose |
|---|---|
| `TICKETMASTER_API_KEY` | Real concert listings. Without it, listings are demo data, flagged in the data and on the card. |
| `FANROUTE_URL` | The Fanroute deployment that hosts pledge campaigns |
| `ANTHROPIC_API_KEY` | Optional Claude brain for the simulator (the public `/api/assistant` is rate-limited per IP) |
| `GROQ_API_KEY` | Optional Groq brain, used when there is no Anthropic key |

## Honest notes

- **Demo campaign.** The pledge campaign used in the demo ("Juniper Static") belongs to a fictional artist, with seeded demo pledges on Fanroute's demo PayPal mode.
- **Demo listings.** Without a Ticketmaster key, venues and dates are demo data, clearly labelled. Taste data is always real.

## License

MIT
