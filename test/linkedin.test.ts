import { describe, it, expect } from 'vitest';
import { normalizeLinkedInUrl, companyFacts } from '../src/linkedin';

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

describe('companyFacts', () => {
  it('reads website, industry and size from the About section', () => {
    const t = 'Overview\n\nWebsite\n\nhttps://www.examplehealth.com/\n\nIndustry\n\nHospitals and Health Care\n\nCompany size\n\n2-10 employees\n\n11 associated members';
    expect(companyFacts(t)).toEqual({ website: 'https://www.examplehealth.com/', industry: 'Hospitals and Health Care', size_band: '1-10' });
    expect(companyFacts('Company size\n\n1,001-5,000 employees').size_band).toBe('1000+');
    expect(companyFacts('nothing here')).toEqual({ website: undefined, industry: undefined, size_band: undefined });
  });
});
