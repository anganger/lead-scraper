// LinkedIn URL cleanup, shared result types and About-section parsing used by the API scraper.
import type { ResearchSource } from './types';

/** Returns a canonical https://www.linkedin.com/{company|in|school|showcase}/<slug> URL, or null if it is not one. */
export function normalizeLinkedInUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(company|in|school|showcase)\/([^/?#]+)/i);
  if (!m) return null;
  return `https://www.linkedin.com/${m[1].toLowerCase()}/${decodeURIComponent(m[2]).toLowerCase()}`;
}

export type LinkedInLogo = { bytes: Buffer; type: string };
export type LinkedInResult = { source: ResearchSource; rootUrl: string; pages: { url: string; chars: number }[]; text: string; logo?: LinkedInLogo };


const SIZE_MAP: [RegExp, string][] = [[/^(0|1|2)-10\b/, '1-10'], [/^11-50\b/, '11-50'], [/^51-200\b/, '51-200'], [/^201-500\b/, '201-500'], [/^501-1,?000\b/, '501-1000'], [/^\d/, '1000+']];

// Pulls the "About" facts from a scraped LinkedIn company page so a lead pasted as only a LinkedIn link gets its website.
export function companyFacts(text: string): { website?: string; industry?: string; size_band?: string } {
  const field = (name: string) => text.match(new RegExp(`(?:^|\\n)${name}\\s*\\n+\\s*([^\\n]+)`))?.[1].trim();
  const website = field('Website');
  const size = field('Company size');
  return {
    website: website && /^https?:\/\//i.test(website) && !/linkedin\.com/i.test(website) ? website : undefined,
    industry: field('Industry'),
    size_band: size ? SIZE_MAP.find(([re]) => re.test(size))?.[1] : undefined,
  };
}
