// A deterministic "brain" for the simulator when no model key is configured.
// It maps a handful of phrasings onto one MCP tool call. The Claude brain
// (claude.ts) replaces it when ANTHROPIC_API_KEY is set.

export interface Device {
  city: string;
  likes: string[];
  /** The listener's local date (YYYY-MM-DD), so "tonight" means their tonight. */
  today?: string;
}

export type Plan =
  | { kind: "tool"; name: string; args: Record<string, unknown>; preface?: string }
  | { kind: "say"; text: string };

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const clean = (s: string) =>
  s
    .replace(/^\s*(hey\s+|ok(ay)?\s+)?alexa[,!.\s]*/i, "")
    .replace(/\s+/g, " ")
    .trim();

const trimName = (s: string) =>
  s
    .replace(/^(the band|the artist|artist|band)\s+/i, "")
    .replace(/[?.!,]+$/, "")
    .trim();

function dateWindow(u: string, localToday?: string): { from?: string; to?: string; label?: string } {
  const now = new Date();
  const today = localToday ? new Date(`${localToday}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (/\btonight\b|\btoday\b/i.test(u)) return { from: iso(today), to: iso(today) };
  if (/\bthis weekend\b/i.test(u)) {
    const dow = today.getUTCDay(); // 0 Sun .. 6 Sat
    const sat = new Date(today.getTime() + ((6 - dow + 7) % 7) * DAY);
    const start = dow === 0 ? today : dow === 6 ? today : sat;
    const sun = new Date(start.getTime() + (start.getUTCDay() === 6 ? 1 : 0) * DAY);
    return { from: iso(start), to: iso(sun) };
  }
  if (/\bnext week\b/i.test(u)) return { from: iso(new Date(today.getTime() + 7 * DAY)), to: iso(new Date(today.getTime() + 14 * DAY)) };
  if (/\bnext month\b/i.test(u)) return { from: iso(new Date(today.getTime() + 30 * DAY)), to: iso(new Date(today.getTime() + 60 * DAY)) };
  return {};
}

function cityIn(u: string): string | undefined {
  const m = u.match(/\b(?:in|near|around)\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})/);
  return m?.[1];
}

function likesIn(u: string): string[] {
  // "shows like Arctic Monkeys", "music similar to Mitski"
  const like = u.match(/\b(?:shows?|concerts?|gigs?|music|bands?|artists?)\s+(?:like|similar to)\s+(.+?)(?:[.?!]|$|\s+(?:in|near|this|next|tonight|on)\b)/i);
  if (like) return like[1].split(/\s*(?:,|\band\b|&)\s*/i).map(trimName).filter((x) => x.length > 1).slice(0, 3);
  const m = u.match(/\b(?:i (?:love|like|really like|listen to|'m into|am into)|i'm a fan of|fan of|into)\s+(.+?)(?:[.?!]|$|,\s*(?:any|what|who|find)|\s+(?:any|what|who)\b)/i);
  if (!m) return [];
  return m[1]
    .split(/\s*(?:,|\band\b|&)\s*/i)
    .map(trimName)
    .filter((x) => x.length > 1)
    .slice(0, 3);
}

const CONCERT_WORDS = /\b(shows?|concerts?|gigs?|playing|live music|tickets?|tonight|weekend|this month|next month|next week)\b/i;

export function plan(utterance: string, device: Device): Plan {
  const u = clean(utterance);
  if (!u) return { kind: "say", text: "I'm listening." };

  // "How are the Juniper Static pledges going?" / "pledge progress for X"
  let m =
    u.match(/how (?:are|is) (?:the )?(.+?)(?:'s)? pledges?\b/i) ??
    u.match(/pledge (?:progress|status) (?:for|of) (.+)/i) ??
    u.match(/(?:how close is|where is) (.+?) (?:to (?:a|the) (?:goal|show))/i);
  if (m) return { kind: "tool", name: "pledge_progress", args: { artist: trimName(m[1]) } };

  // "Bring X to Chicago" / "I want X to play Chicago" / "pledge for X in Chicago"
  m =
    u.match(/\bbring\s+(.+?)\s+to\s+(.+)/i) ??
    u.match(/\bwant\s+(.+?)\s+to\s+(?:come\s+to|play(?:\s+(?:in|a show in))?|tour)\s+(.+)/i) ??
    u.match(/\bpledge\s+(?:\$?\d+\s+)?(?:for|to bring|to)\s+(.+?)\s+(?:in|to)\s+(.+)/i) ??
    u.match(/\bget\s+(.+?)\s+to\s+(?:come\s+to|play(?:\s+in)?)\s+(.+)/i);
  if (m) {
    const city = trimName(m[2].replace(/\b(here|my city|town)\b/i, device.city));
    return { kind: "tool", name: "bring_artist_to_city", args: { artist: trimName(m[1]), city: city || device.city } };
  }
  if (/\b(bring|pledge)\b.*\b(here|my city|town)\b/i.test(u)) {
    const a = u.match(/\b(?:bring|pledge (?:for)?)\s+(.+?)\s+(?:here|to my city|to town)/i);
    if (a) return { kind: "tool", name: "bring_artist_to_city", args: { artist: trimName(a[1]), city: device.city } };
  }

  // "Who sounds like Prateek Kuhad?" / "artists similar to X"
  m =
    u.match(/\b(?:who|what)\s+(?:else\s+)?(?:sounds|is|plays)\s+(?:like|similar to)\s+(.+)/i) ??
    u.match(/\b(?:artists|bands|music|singers)\s+(?:similar to|like)\s+(.+)/i) ??
    u.match(/\bsimilar to\s+(.+)/i);
  // "Music like X this weekend" is a concert question, not a similarity one.
  if (m && !CONCERT_WORDS.test(u)) return { kind: "tool", name: "similar_artists", args: { artist: trimName(m[1]), limit: 8 } };

  // "Any shows I'd like this month? I love Clairo"
  if (CONCERT_WORDS.test(u) || /\bgo out\b/i.test(u)) {
    const likes = likesIn(u);
    const w = dateWindow(u, device.today);
    return {
      kind: "tool",
      name: "find_concerts",
      args: { city: cityIn(u) ?? device.city, likes: likes.length ? likes : device.likes, ...(w.from ? { from: w.from, to: w.to } : {}) },
      preface: likes.length ? undefined : `Going by your favorites, ${device.likes.join(" and ")}.`,
    };
  }

  return {
    kind: "say",
    text: "I can find shows you'd like, tell you who sounds like an artist, or help you pull an artist to your city with a pledge. Try: any shows I'd like this month?",
  };
}
