import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrapeLinkedInApi } from '../src/linkedin-api';
import { companyFacts, type LinkedInResult } from '../src/linkedin';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('scrapeLinkedInApi', () => {
  it('uses Bright Data, saves company, posts and profile, and keeps About facts readable', async () => {
    vi.stubEnv('BRIGHTDATA_TOKEN', 'b'); vi.stubEnv('APIFY_TOKEN', '');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('gd_l1vikfnt1wgvvqz95w')
      ? json([{ name: 'Acme', website: 'https://acme.com', industries: 'Software Development', company_size: '11-50 employees', updates: [{ date: '2026-11-03T16:00:00Z', text: 'We launched', likes_count: 5 }, { date: '2026-11-02', text: 'x'.repeat(699) + '🚀🚀', likes_count: 1 }] }])
      : json([{ name: 'Jane Doe', current_company: { name: 'Acme' }, about: 'Co-founder', activity: [{ interaction: 'Jane shared this', title: 'Series A' }] }])));
    const got: LinkedInResult[] = [];
    const notes = await scrapeLinkedInApi('linkedin.com/company/acme', 'linkedin.com/in/jane-doe', () => {}, async (r) => void got.push(r));
    expect(notes).toEqual([]);
    expect(got.map((r) => r.source).sort()).toEqual(['linkedin_company', 'linkedin_person', 'linkedin_posts']);
    const co = got.find((r) => r.source === 'linkedin_company')!;
    expect(companyFacts(co.text)).toEqual({ website: 'https://acme.com', industry: 'Software Development', size_band: '11-50' });
    expect(got.find((r) => r.source === 'linkedin_posts')!.text).toContain('[2026-11-03] We launched (5 likes)');
    expect(got.find((r) => r.source === 'linkedin_posts')!.text).toContain('x'.repeat(699) + '🚀 (1 likes)');
    expect(got.find((r) => r.source === 'linkedin_person')!.text).toContain('Source: Bright Data');
  });

  it('falls back to Apify when Bright Data fails, and notes a part both fail on', async () => {
    vi.stubEnv('BRIGHTDATA_TOKEN', 'b'); vi.stubEnv('APIFY_TOKEN', 'a');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('brightdata')) return json({ error: 'down' }, 500);
      if (url.includes('linkedin-profile-scraper')) return json([{ error: 'Free users are limited to 100 profiles' }]);
      if (url.includes('linkedin-company-posts')) return json([]);
      return json([{ name: 'Acme', website: 'https://acme.com' }]);
    }));
    const got: LinkedInResult[] = [];
    const notes = await scrapeLinkedInApi('linkedin.com/company/acme', 'linkedin.com/in/jane-doe', () => {}, async (r) => void got.push(r));
    expect(got.map((r) => r.source)).toEqual(['linkedin_company']);
    expect(got[0].text).toContain('Source: Apify');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/profile was not read.*Bright Data 500.*then Apify: Free users/);
  });
});
