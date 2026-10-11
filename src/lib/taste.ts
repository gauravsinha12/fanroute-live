import { getJson } from "./http";

// Taste: "who else would this person like?" Uses MusicBrainz to resolve an
// artist name and ListenBrainz's listening-session similarity to expand it.
// Both are open data and need no key. If neither answers, a small built-in
// demo graph keeps the experience working offline.

const UA = "FanrouteLive/0.1 (https://github.com/gauravsinha12/fanroute-live)";

export interface SimilarArtist {
  name: string;
  /** 0..1, relative to the strongest match for this seed. */
  score: number;
}

export type TasteSource = "listenbrainz" | "demo";

interface MbArtist {
  id: string;
  name: string;
  score: number;
  country?: string;
  disambiguation?: string;
}

// MusicBrainz asks for at most one request per second per client.
let lastMb = 0;
async function mbThrottle() {
  const wait = lastMb + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMb = Date.now();
}

export async function resolveArtist(name: string): Promise<{ mbid: string; name: string } | null> {
  await mbThrottle();
  const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${name}"`)}&fmt=json&limit=3`;
  const data = await getJson<{ artists?: MbArtist[] }>(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const best = data.artists?.find((a) => a.score >= 80) ?? null;
  return best ? { mbid: best.id, name: best.name } : null;
}

const LB_ALGORITHM = "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30";

export async function similarArtists(seed: string, limit = 25): Promise<{ seed: string; artists: SimilarArtist[]; source: TasteSource }> {
  try {
    const resolved = await resolveArtist(seed);
    if (resolved) {
      const url = `https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=${resolved.mbid}&algorithm=${LB_ALGORITHM}`;
      const rows = await getJson<{ name: string; score: number }[]>(url, { headers: { "User-Agent": UA } });
      const top = rows.filter((r) => r.name && r.name.toLowerCase() !== resolved.name.toLowerCase()).slice(0, limit);
      const max = top[0]?.score || 1;
      if (top.length) return { seed: resolved.name, artists: top.map((r) => ({ name: r.name, score: round(r.score / max) })), source: "listenbrainz" };
    }
  } catch (err) {
    console.warn("taste lookup failed, using demo graph", err instanceof Error ? err.message : err);
  }
  return { seed, artists: demoSimilar(seed).slice(0, limit), source: "demo" };
}

/** Taste profile for one or more seeds: every artist with its best score; seeds score 1. */
export async function tasteProfile(seeds: string[]): Promise<{ seeds: string[]; artists: SimilarArtist[]; source: TasteSource }> {
  const results = await Promise.all(seeds.slice(0, 3).map((s) => similarArtists(s, 30)));
  const best = new Map<string, SimilarArtist>();
  for (const r of results) {
    best.set(r.seed.toLowerCase(), { name: r.seed, score: 1 });
    for (const a of r.artists) {
      const k = a.name.toLowerCase();
      if ((best.get(k)?.score ?? -1) < a.score) best.set(k, a);
    }
  }
  return {
    seeds: results.map((r) => r.seed),
    artists: [...best.values()].sort((a, b) => b.score - a.score),
    source: results.every((r) => r.source === "listenbrainz") ? "listenbrainz" : "demo",
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

// A tiny hand-built graph for offline demos. Real answers come from ListenBrainz.
const DEMO_GRAPH: Record<string, string[]> = {
  "indie pop": ["Clairo", "girl in red", "beabadoobee", "Faye Webster", "Men I Trust", "Japanese Breakfast", "Snail Mail", "Soccer Mommy", "Phoebe Bridgers", "boygenius"],
  "bollywood": ["Arijit Singh", "Shreya Ghoshal", "Pritam", "A. R. Rahman", "Sonu Nigam", "Neha Kakkar", "Atif Aslam", "Jubin Nautiyal"],
  "indie hindi": ["Prateek Kuhad", "When Chai Met Toast", "The Local Train", "Anuv Jain", "Ritviz", "Lifafa", "Easy Wanderlings"],
  "alt rock": ["Arctic Monkeys", "The Strokes", "Interpol", "The National", "Phoenix", "Vampire Weekend", "Bloc Party"],
};

function demoSimilar(seed: string): SimilarArtist[] {
  const s = seed.toLowerCase();
  const group = Object.values(DEMO_GRAPH).find((g) => g.some((a) => a.toLowerCase() === s)) ?? DEMO_GRAPH["indie pop"];
  return group.filter((a) => a.toLowerCase() !== s).map((name, i) => ({ name, score: round(1 - i * 0.08) }));
}
