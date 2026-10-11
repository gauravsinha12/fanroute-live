import { getJson } from "./http";

// Concert listings. Ticketmaster's Discovery API when TICKETMASTER_API_KEY is
// set; otherwise demo listings, clearly marked as such everywhere they show.

export interface Show {
  id: string;
  artist: string;
  /** Other acts on the bill. */
  with: string[];
  venue: string;
  city: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Local time, HH:MM, when announced. */
  time?: string;
  url?: string;
  genre?: string;
  priceFrom?: number;
  currency?: string;
  /** True for generated demo listings (no Ticketmaster key). */
  demo?: boolean;
}

export type EventsSource = "ticketmaster" | "demo";

export const eventsMode = (): EventsSource => (process.env.TICKETMASTER_API_KEY ? "ticketmaster" : "demo");

interface TmEvent {
  id: string;
  name: string;
  url?: string;
  dates?: { start?: { localDate?: string; localTime?: string } };
  classifications?: { genre?: { name?: string }; subGenre?: { name?: string } }[];
  priceRanges?: { min?: number; currency?: string }[];
  _embedded?: { venues?: { name?: string; city?: { name?: string } }[]; attractions?: { name?: string }[] };
}

/** Upcoming music events in a city between two dates (inclusive). */
export async function showsInCity(city: string, from: string, to: string): Promise<{ shows: Show[]; source: EventsSource }> {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return { shows: demoShows(city, from, to), source: "demo" };
  const params = new URLSearchParams({
    apikey: key,
    city,
    classificationName: "music",
    startDateTime: `${from}T00:00:00Z`,
    endDateTime: `${to}T23:59:59Z`,
    size: "200",
    sort: "date,asc",
  });
  const data = await getJson<{ _embedded?: { events?: TmEvent[] } }>(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
  const seen = new Set<string>();
  const shows: Show[] = [];
  for (const e of data._embedded?.events ?? []) {
    const acts = (e._embedded?.attractions ?? []).map((a) => a.name).filter((n): n is string => Boolean(n));
    const artist = acts[0] ?? e.name;
    const date = e.dates?.start?.localDate;
    if (!date) continue;
    const dedupe = `${artist}|${date}`.toLowerCase(); // one row per artist per night
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const venue = e._embedded?.venues?.[0];
    shows.push({
      id: e.id,
      artist,
      with: acts.slice(1, 4),
      venue: venue?.name ?? "Venue to be announced",
      city: venue?.city?.name ?? city,
      date,
      time: e.dates?.start?.localTime?.slice(0, 5),
      url: e.url,
      genre: e.classifications?.[0]?.subGenre?.name ?? e.classifications?.[0]?.genre?.name,
      priceFrom: e.priceRanges?.[0]?.min,
      currency: e.priceRanges?.[0]?.currency,
    });
  }
  return { shows, source: "ticketmaster" };
}

// Demo listings: fictional venues and dates for well-known acts, so the voice
// flow can be shown without a key. Never presented as real.
const DEMO_ACTS = [
  "girl in red", "beabadoobee", "Faye Webster", "Men I Trust", "Japanese Breakfast", "Phoebe Bridgers", "Soccer Mommy",
  "Prateek Kuhad", "The Local Train", "Ritviz", "Arijit Singh", "The National", "Phoenix", "Vampire Weekend", "Mitski", "Wallows",
];
const DEMO_VENUES = ["The Lantern Room", "Riverside Hall", "Northside Ballroom", "Ironworks Basement", "Marigold Listening Room", "The Foundry", "Union Stage"];

function demoShows(city: string, from: string, to: string): Show[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const days = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  const seed = [...city.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return DEMO_ACTS.map((artist, i) => {
    const offset = (seed + i * 7) % days;
    const date = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
    return {
      id: `demo-${i}`,
      artist,
      with: [],
      venue: DEMO_VENUES[(seed + i * 3) % DEMO_VENUES.length],
      city,
      date,
      time: ["19:00", "19:30", "20:00"][i % 3],
      demo: true,
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}
