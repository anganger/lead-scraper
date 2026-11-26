import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeLinkedInUrl, isAuthwall, takeBudget, linkedInTargets, companyFacts, isMissingPage } from '../src/linkedin';

describe('normalizeLinkedInUrl', () => {
  it.each([
    ['https://www.linkedin.com/company/examplereno/', 'https://www.linkedin.com/company/examplereno'],
    ['linkedin.com/company/examplereno', 'https://www.linkedin.com/company/examplereno'],
    ['https://pk.linkedin.com/company/acme/home/?trk=x', 'https://www.linkedin.com/company/acme'],
    ['http://linkedin.com/in/jane-doe-123?utm_source=x#top', 'https://www.linkedin.com/in/jane-doe-123'],
    ['www.linkedin.com/in/jane/recent-activity/all/', 'https://www.linkedin.com/in/jane'],
  ])('%s', (input, out) => expect(normalizeLinkedInUrl(input)).toBe(out));

  it.each(['not exist yet', '', null, 'https://evil.com/company/x', 'https://linkedin.com.evil.com/company/x', 'https://www.linkedin.com/feed/', 'N/A'])(
    'rejects %s', (input) => expect(normalizeLinkedInUrl(input)).toBeNull(),
  );
});

describe('linkedInTargets', () => {
  it('plans company about, company posts and person pages', () => {
    expect(linkedInTargets('linkedin.com/company/acme', 'https://linkedin.com/in/jane')).toEqual([
      { source: 'linkedin_company', urls: ['https://www.linkedin.com/company/acme/about/'] },
      { source: 'linkedin_posts', urls: ['https://www.linkedin.com/company/acme/posts/?feedView=all'] },
      { source: 'linkedin_person', urls: ['https://www.linkedin.com/in/jane/', 'https://www.linkedin.com/in/jane/recent-activity/all/'] },
    ]);
    expect(linkedInTargets('not exist yet', null)).toEqual([]);
  });
});

describe('isAuthwall', () => {
  it('detects login redirects and walls', () => {
    expect(isAuthwall('https://www.linkedin.com/authwall?trk=bf', '')).toBe(true);
    expect(isAuthwall('https://www.linkedin.com/checkpoint/challenge/abc', '')).toBe(true);
    expect(isAuthwall('https://www.linkedin.com/login?session_redirect=x', '')).toBe(true);
    expect(isAuthwall('https://www.linkedin.com/company/acme/about/', 'Acme\nSign in to see who you already know at Acme\nJoin now')).toBe(true);
    expect(isAuthwall('https://www.linkedin.com/company/acme/about/', "Let's do a quick security check")).toBe(true);
    expect(isAuthwall('https://www.linkedin.com/in/x/', 'Messaging\nNotifications\nImportant notice from LinkedIn\nOver time, our systems have shown your account has accessed a high volume of LinkedIn profile data.')).toBe(true);
  });
  it('accepts a normal signed-in page', () => {
    const page = 'Home\nMy Network\nJobs\nMessaging\nNotifications\nAcme\nSoftware Development · Austin\nAbout us\nWe build things.';
    expect(isAuthwall('https://www.linkedin.com/company/acme/about/', page)).toBe(false);
  });
});

describe('takeBudget', () => {
  it('allows 30 loads per rolling hour and persists across calls', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'li-')), 'budget.json');
    const t0 = 1_000_000_000;
    for (let i = 0; i < 30; i++) expect(takeBudget(f, t0 + i)).toBe(true);
    expect(takeBudget(f, t0 + 100)).toBe(false);
    expect(takeBudget(f, t0 + 3_600_000 + 5)).toBe(true); // first loads aged out
  });
});

describe('companyFacts', () => {
  it('reads website, industry and size from the About section', () => {
    const t = 'Overview\n\nWebsite\n\nhttps://www.examplehealth.com/\n\nIndustry\n\nHospitals and Health Care\n\nCompany size\n\n2-10 employees\n\n11 associated members';
    expect(companyFacts(t)).toEqual({ website: 'https://www.examplehealth.com/', industry: 'Hospitals and Health Care', size_band: '1-10' });
    expect(companyFacts('Company size\n\n1,001-5,000 employees').size_band).toBe('1000+');
    expect(companyFacts('nothing here')).toEqual({ website: undefined, industry: undefined, size_band: undefined });
  });
});

describe('isMissingPage', () => {
  it('spots a dead LinkedIn link', () => {
    expect(isMissingPage('https://www.linkedin.com/404/', '')).toBe(true);
    expect(isMissingPage('https://www.linkedin.com/in/x/', 'This page doesn’t exist\nPlease check your URL')).toBe(true);
    expect(isMissingPage('https://www.linkedin.com/company/example-inc/about/', 'Example\nSoftware Development\nOverview')).toBe(false);
  });
});
