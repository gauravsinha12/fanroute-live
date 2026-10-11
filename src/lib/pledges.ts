import { getJson } from "./http";

// Fan pledges live in Fanroute (https://github.com/gauravsinha12/fanroute):
// an artist opens a campaign for the cities they might play, fans pledge with
// PayPal as a hold, and the artist captures the holds for cities they confirm.
// This module only reads campaigns and builds the fan's pledge link.

export const FANROUTE_URL = (process.env.FANROUTE_URL ?? "https://fanroute-zeta.vercel.app").replace(/\/$/, "");

export interface CityProgress {
  marketId: string;
  name: string;
  pledged: number;
  backers: number;
  goal: number;
  reached: boolean;
}

export interface PledgeCampaign {
  id: string;
  artist: string;
  title: string;
  pledgeAmount: number;
  currency: string;
  url: string;
  cities: CityProgress[];
}

interface ApiResponse {
  campaigns: {
    campaign: { id: string; artist: string; title: string; pledgeAmount: number; currency: string };
    totals: CityProgress[];
    url: string;
  }[];
}

export async function campaignsFor(artist: string): Promise<PledgeCampaign[]> {
  const data = await getJson<ApiResponse>(`${FANROUTE_URL}/api/campaigns?artist=${encodeURIComponent(artist)}`, { cache: false });
  return data.campaigns.map((c) => ({
    id: c.campaign.id,
    artist: c.campaign.artist,
    title: c.campaign.title,
    pledgeAmount: c.campaign.pledgeAmount,
    currency: c.campaign.currency,
    url: `${FANROUTE_URL}${c.url}`,
    cities: c.totals.map(({ marketId, name, pledged, backers, goal, reached }) => ({ marketId, name, pledged, backers, goal, reached })),
  }));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function findCity(campaign: PledgeCampaign, city: string): CityProgress | undefined {
  const n = norm(city);
  return campaign.cities.find((c) => norm(c.name) === n) ?? campaign.cities.find((c) => norm(c.name).startsWith(n) || n.startsWith(norm(c.name)));
}

export const pledgeLink = (campaign: PledgeCampaign, city?: CityProgress) => (city ? `${campaign.url}?city=${city.marketId}` : campaign.url);
