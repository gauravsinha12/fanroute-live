import QRCode from "qrcode";
import { showsInCity, type Show } from "@/lib/events";
import { campaignsFor, findCity, pledgeLink, type CityProgress, type PledgeCampaign } from "@/lib/pledges";
import { similarArtists, tasteProfile } from "@/lib/taste";

// What the MCP tools do, written for a voice assistant: every result has a
// short spoken answer plus structured data for the screen.

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const spokenDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export interface ConcertPick extends Show {
  score: number;
  reason: string;
}

export interface ConcertsResult {
  city: string;
  from: string;
  to: string;
  windowLabel: string;
  seeds: string[];
  shows: ConcertPick[];
  sources: { taste: string; events: string };
  speech: string;
}

export async function findConcerts(input: { city: string; likes: string[]; from?: string; to?: string; limit?: number }): Promise<ConcertsResult> {
  const now = Date.now();
  const from = input.from ?? iso(now);
  const to = input.to ?? iso(Date.parse(`${from}T00:00:00Z`) + 30 * DAY);
  const [taste, events] = await Promise.all([tasteProfile(input.likes), showsInCity(input.city, from, to)]);

  const byName = new Map(taste.artists.map((a) => [a.name.toLowerCase(), a]));
  const seeds = new Set(taste.seeds.map((s) => s.toLowerCase()));
  const seedLabel = list(taste.seeds);

  const picks: ConcertPick[] = [];
  for (const show of events.shows) {
    let best: { name: string; score: number; headliner: boolean } | undefined;
    for (const [i, name] of [show.artist, ...show.with].entries()) {
      const hit = byName.get(name.toLowerCase());
      if (hit && (!best || hit.score > best.score)) best = { name, score: hit.score * (i === 0 ? 1 : 0.85), headliner: i === 0 };
    }
    if (!best) continue;
    const reason = seeds.has(best.name.toLowerCase())
      ? `You listen to ${best.name}`
      : best.headliner
        ? `Fans of ${seedLabel} also listen to ${best.name}`
        : `${best.name} is on the bill; fans of ${seedLabel} listen to them`;
    picks.push({ ...show, score: Math.round(best.score * 100) / 100, reason });
  }
  picks.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
  const shows = picks.slice(0, input.limit ?? 6);

  const windowLabel = `${shortDate(from)} – ${shortDate(to)}`;
  let speech: string;
  if (!shows.length) {
    speech = `I couldn't find shows in ${input.city} between ${spokenDate(from)} and ${spokenDate(to)} from artists close to ${seedLabel}. Want me to look further out?`;
  } else {
    const top = shows.slice(0, 3).map((s) => `${s.artist} at ${s.venue} on ${spokenDate(s.date)}`);
    const more = shows.length > 3 ? ` I've put ${shows.length - 3} more on the screen.` : "";
    speech = `Here ${shows.length === 1 ? "is a show" : `are ${shows.length} shows`} in ${input.city} you'd probably like: ${list(top)}.${more}`;
  }
  return { city: input.city, from, to, windowLabel, seeds: taste.seeds, shows, sources: { taste: taste.source, events: events.source }, speech };
}

export async function findSimilar(artist: string, limit = 8) {
  const r = await similarArtists(artist, limit);
  const names = r.artists.map((a) => a.name);
  return {
    artist: r.seed,
    similar: r.artists,
    source: r.source,
    speech: names.length ? `People who listen to ${r.seed} also play ${list(names.slice(0, 5))}.` : `I don't know enough about ${artist} yet.`,
  };
}

export type PledgeStatus = "open" | "city_not_listed" | "no_campaign";

export interface PledgeResult {
  status: PledgeStatus;
  artist: string;
  city: string;
  campaign?: { id: string; title: string; pledgeAmount: number; currency: string; link: string };
  progress?: CityProgress;
  cities?: CityProgress[];
  speech: string;
  qrSvg?: string;
}

const money = (n: number, currency: string) => (currency === "USD" ? `$${Math.round(n)}` : `${Math.round(n)} ${currency}`);

export async function bringArtist(artist: string, city: string): Promise<PledgeResult> {
  const campaigns = await campaignsFor(artist);
  if (!campaigns.length) {
    return {
      status: "no_campaign",
      artist,
      city,
      speech: `${artist} hasn't opened fan pledges on Fanroute yet, so there's nothing to pledge for right now.`,
    };
  }
  let chosen: { campaign: PledgeCampaign; city: CityProgress } | undefined;
  for (const c of campaigns) {
    const hit = findCity(c, city);
    if (hit) {
      chosen = { campaign: c, city: hit };
      break;
    }
  }
  if (!chosen) {
    const c = campaigns[0];
    const top = [...c.cities].sort((a, b) => b.pledged - a.pledged).slice(0, 4).map((x) => x.name);
    return {
      status: "city_not_listed",
      artist: c.artist,
      city,
      campaign: { id: c.id, title: c.title, pledgeAmount: c.pledgeAmount, currency: c.currency, link: pledgeLink(c) },
      cities: c.cities,
      speech: `${c.artist} is taking pledges, but ${city} isn't one of the cities on the list. The cities in play include ${list(top)}.`,
    };
  }
  const { campaign: c, city: cp } = chosen;
  const link = pledgeLink(c, cp);
  const left = Math.max(0, cp.goal - cp.pledged);
  const standing = cp.reached
    ? `${cp.name} has already reached its goal with ${cp.backers} fans`
    : `${cp.backers} ${cp.backers === 1 ? "fan has" : "fans have"} pledged ${money(cp.pledged, c.currency)} so far, ${money(left, c.currency)} short of the ${money(cp.goal, c.currency)} goal`;
  return {
    status: "open",
    artist: c.artist,
    city: cp.name,
    campaign: { id: c.id, title: c.title, pledgeAmount: c.pledgeAmount, currency: c.currency, link },
    progress: cp,
    speech: `${c.artist} is gauging demand for ${cp.name}: ${standing}. Scan the code on the screen or open the link in your Alexa app to pledge ${money(c.pledgeAmount, c.currency)} with PayPal. It's a hold, not a charge, and you only pay if the ${cp.name} show is confirmed.`,
    qrSvg: await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
  };
}

export async function pledgeProgress(artist: string) {
  const campaigns = await campaignsFor(artist);
  const c = campaigns[0];
  if (!c) return { artist, status: "no_campaign" as const, cities: [] as CityProgress[], speech: `${artist} hasn't opened fan pledges yet.` };
  const cities = [...c.cities].sort((a, b) => b.pledged - a.pledged);
  const lead = cities[0];
  const reached = cities.filter((x) => x.reached).map((x) => x.name);
  const speech =
    lead && lead.pledged > 0
      ? `${lead.name} is leading for ${c.artist} with ${money(lead.pledged, c.currency)} from ${lead.backers} ${lead.backers === 1 ? "fan" : "fans"}.${reached.length ? ` ${list(reached)} ${reached.length === 1 ? "has" : "have"} reached the goal.` : ""}`
      : `No one has pledged for ${c.artist} yet. The cities in play are ${list(cities.slice(0, 5).map((x) => x.name))}.`;
  return { artist: c.artist, status: "open" as const, campaign: { id: c.id, title: c.title, link: c.url }, cities, speech };
}
