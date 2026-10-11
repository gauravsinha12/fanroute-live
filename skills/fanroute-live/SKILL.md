---
name: fanroute-live
description: Find concerts a listener will like and help them pull an artist to their city with a refundable PayPal pledge, using the Fanroute Live MCP server. Use for questions like "any shows I'd like this month?", "who sounds like <artist>?", "I want <artist> to play <city>", or "how are <artist>'s pledges going?". Written for voice assistants with an optional screen.
---

# Fanroute Live

Fanroute Live is an MCP server (Streamable HTTP) for live music:

- **What's on:** concerts in a city that match what the listener already likes.
- **Fan pledges:** fans can pull an artist to their city with a PayPal *hold* that is only charged if the show is confirmed.

Endpoint: `https://<your-deployment>/api/mcp`. No auth.

## Tools

| Tool | Use it when | Key arguments |
|---|---|---|
| `find_concerts` | "Any shows I'd like?", "what's on this weekend?" | `city`, `likes` (1–3 artists), optional `from` / `to` (YYYY-MM-DD) |
| `similar_artists` | "Who sounds like X?", or to expand a vague taste before `find_concerts` | `artist`, optional `limit` |
| `bring_artist_to_city` | "I want X to play here", "bring X to Chicago" | `artist`, `city` |
| `pledge_progress` | "How are X's pledges going?" | `artist` |

`find_concerts` and `bring_artist_to_city` declare MCP Apps views (`ui://fanroute-live/concerts.html`, `ui://fanroute-live/pledge.html`). On a device with a screen, render them. The pledge view shows a QR code the listener can scan to pledge on their phone.

## How to answer

1. **Know the taste first.** If you don't know any artists the listener likes, ask for one or two before calling `find_concerts`. Don't guess.
2. **Speak the result's text, shortened.** Read at most three shows aloud; the screen holds the rest.
3. **Never read URLs aloud.** Pledge links go on the screen as a QR code, or to the listener's phone.
4. **Always say what a pledge is.** It's a PayPal hold, not a charge, and the listener only pays if their city's show is confirmed.
5. **Be honest about missing data:**
   - If an artist has no open campaign (`status: "no_campaign"`), say so plainly and don't invent one.
   - If results come back with `sources.events: "demo"`, the listings are demo data. Say so if asked.

## Example

> **Listener:** "Any shows I'd like this month? I love Clairo."
> → `find_concerts {"city": "Chicago", "likes": ["Clairo"]}`
> **Assistant:** "girl in red plays Northside Ballroom on Tuesday, October 13, and Wallows is at The Foundry on the 25th. I've put four more on the screen."
