import { describe, it, expect } from 'vitest';
import { scrapeSite, toPlainText, ScrapeError, type ScrapeResult, type ScrapedPage } from '../src/scraper';

type Spec = string | { status?: number; type?: string; headers?: Record<string, string>; body?: string };
const page = (title: string, links: string[] = [], extra = '') =>
  `<html><head><title>${title}</title></head><body><script>x()</script><h1>${title}</h1>${links
    .map((l) => `<a href="${l}">${l.replace(/\W+/g, ' ')}</a>`)
    .join('')}<ul><li>one</li><li>two</li></ul>${extra}</body></html>`;

function site(map: Record<string, Spec>, ips: string[] = ['93.184.216.34']) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const s = map[url];
    if (s === undefined) return new Response('nf', { status: 404, headers: { 'content-type': 'text/html' } });
    if (typeof s === 'string') return new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response(s.body ?? null, {
      status: s.status ?? 200,
      headers: { 'content-type': s.type ?? 'text/html', ...s.headers },
    });
  }) as unknown as typeof fetch;
  return { calls, opts: { fetchImpl, lookup: async (_h: string) => ips } };
}

describe('normalisation', () => {
  it.each(['acme.com', 'www.acme.com', 'https://acme.com/x'])('accepts %s', async (i) => {
    const s = site({});
    s.opts.fetchImpl = (async (u: string) => {
      s.calls.push(u);
      return new Response(page('Home'), { headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    const r = await scrapeSite(i, { ...s.opts, maxPages: 1 });
    expect(r.pages[0].kind).toBe('home');
    expect(s.calls[0]).toMatch(/^https:\/\/(www\.)?acme\.com\//);
  });
  it.each(['', 'ftp://acme.com', 'http://', 'javascript:alert(1)'])('rejects %j', async (i) => {
    await expect(scrapeSite(i, site({}).opts)).rejects.toBeInstanceOf(ScrapeError);
  });
});

describe('SSRF', () => {
  const bad = ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:7f00:1'];
  it.each(bad)('refuses DNS resolving to %s', async (ip) => {
    const s = site({ 'https://acme.com/': page('Home') }, [ip]);
    await expect(scrapeSite('acme.com', s.opts)).rejects.toBeInstanceOf(ScrapeError);
    expect(s.calls).toEqual([]);
  });
  it('refuses if ANY address is private', async () => {
    const s = site({}, ['93.184.216.34', '10.0.0.1']);
    await expect(scrapeSite('acme.com', s.opts)).rejects.toBeInstanceOf(ScrapeError);
  });
  it.each(['localhost', 'http://foo.internal', 'box.local', 'http://192.168.0.1', 'http://2130706433', 'http://[::1]/'])(
    'refuses host %s',
    async (h) => {
      const s = site({});
      await expect(scrapeSite(h, s.opts)).rejects.toBeInstanceOf(ScrapeError);
      expect(s.calls).toEqual([]);
    },
  );
  it('refuses home redirect to 127.0.0.1', async () => {
    const s = site({ 'https://acme.com/': { status: 302, headers: { location: 'http://127.0.0.1/admin' } } });
    await expect(scrapeSite('acme.com', s.opts)).rejects.toBeInstanceOf(ScrapeError);
    expect(s.calls).toEqual(['https://acme.com/']);
  });
  it('records subpage redirect to metadata IP as error, keeps going', async () => {
    const s = site({
      'https://acme.com/': page('Home', ['/careers']),
      'https://acme.com/careers': { status: 301, headers: { location: 'http://169.254.169.254/latest' } },
    });
    const r = await scrapeSite('acme.com', s.opts);
    expect(r.pages.map((p) => p.kind)).toEqual(['home']);
    expect(r.errors.some((e) => e.url.endsWith('/careers'))).toBe(true);
    expect(s.calls).not.toContain('http://169.254.169.254/latest');
  });
  it('stops after 5 redirects', async () => {
    const map: Record<string, Spec> = {};
    for (let i = 0; i < 8; i++) map[`https://acme.com/${i || ''}`] = { status: 302, headers: { location: `/${i + 1}` } };
    await expect(scrapeSite('acme.com', site(map).opts)).rejects.toBeInstanceOf(ScrapeError);
  });
});

describe('crawl', () => {
  it('discovers careers links and orders by priority', async () => {
    const s = site({
      'https://acme.com/': page('Home', ['/blog/post', '/careers', '/about', '/pricing', '/random', 'https://other.com/careers', '/logo.png', 'mailto:a@b.c', '/contact']),
      'https://acme.com/careers': page('Careers'),
      'https://acme.com/about': page('About us'),
      'https://acme.com/pricing': page('Plans'),
      'https://acme.com/blog/post': page('A post'),
      'https://acme.com/random': page('Random'),
      'https://acme.com/contact': page('Contact'),
    });
    const r = await scrapeSite('acme.com', s.opts);
    expect(r.pages.map((p) => p.kind)).toEqual(['home', 'careers', 'about', 'pricing', 'contact', 'blog', 'other']);
    expect(s.calls.some((c) => c.includes('other.com') || c.endsWith('.png'))).toBe(false);
    expect(r.pages[0].text).toContain('one\ntwo');
    expect(r.pages[0].text).not.toContain('x()');
  });
  it('probes common paths and allows careers. subdomain', async () => {
    const s = site({
      'https://acme.com/': page('Home', ['https://careers.acme.com/']),
      'https://careers.acme.com/': page('Jobs'),
      'https://acme.com/team': page('Our team'),
    });
    const r = await scrapeSite('acme.com', s.opts);
    expect(r.pages.map((p) => p.kind).sort()).toEqual(['careers', 'home', 'team']);
    expect(r.errors).toEqual([]); // probe 404s are silent
  });
  it('follows ATS links as careers', async () => {
    const s = site({
      'https://acme.com/': page('Home', ['https://boards.greenhouse.io/acme'], '<iframe src="https://jobs.lever.co/acme"></iframe>'),
      'https://boards.greenhouse.io/acme': page('Acme jobs'),
      'https://jobs.lever.co/acme': page('Lever'),
    });
    const r = await scrapeSite('acme.com', s.opts);
    const c = r.pages.filter((p) => p.kind === 'careers').map((p) => p.url);
    expect(c).toEqual(expect.arrayContaining(['https://boards.greenhouse.io/acme', 'https://jobs.lever.co/acme']));
  });
  it('ATS hosts are SSRF-checked', async () => {
    const s = site({ 'https://acme.com/': page('Home', ['https://boards.greenhouse.io/acme']) });
    s.opts.lookup = async (h) => (h.includes('greenhouse') ? ['10.0.0.9'] : ['93.184.216.34']);
    const r = await scrapeSite('acme.com', s.opts);
    expect(s.calls).not.toContain('https://boards.greenhouse.io/acme');
    expect(r.errors.length).toBe(1);
  });
  it('skips non-html with error entry', async () => {
    const s = site({
      'https://acme.com/': page('Home', ['/about']),
      'https://acme.com/about': { type: 'application/pdf', body: '%PDF' },
    });
    const r = await scrapeSite('acme.com', s.opts);
    expect(r.pages.length).toBe(1);
    expect(r.errors[0].url).toBe('https://acme.com/about');
  });
  it('respects maxPages', async () => {
    const links = ['/a', '/b', '/c', '/d', '/e', '/f'];
    const map: Record<string, Spec> = { 'https://acme.com/': page('Home', links) };
    links.forEach((l) => (map['https://acme.com' + l] = page(l)));
    const r = await scrapeSite('acme.com', { ...site(map).opts, maxPages: 3 });
    expect(r.pages.length).toBe(3);
  });
  it('dedupes normalised urls', async () => {
    const s = site({
      'https://acme.com/': page('Home', ['/about', '/about/', '/about#team', '/about?utm_source=x', 'https://www.acme.com/about']),
      'https://acme.com/about': page('About'),
    });
    const r = await scrapeSite('acme.com', s.opts);
    expect(s.calls.filter((c) => c.endsWith('/about')).length).toBe(1);
    expect(r.pages.filter((p) => p.kind === 'about').length).toBe(1);
  });
  it('throws ScrapeError when home fails', async () => {
    await expect(scrapeSite('acme.com', site({ 'https://acme.com/': { status: 500 } }).opts)).rejects.toBeInstanceOf(ScrapeError);
    const opts = { fetchImpl: (async () => { throw new Error('boom'); }) as unknown as typeof fetch, lookup: async () => ['93.184.216.34'] };
    await expect(scrapeSite('acme.com', opts)).rejects.toBeInstanceOf(ScrapeError);
  });
  it('caps body at 2MB', async () => {
    const big = page('Home', [], 'x'.repeat(3_000_000));
    const r = await scrapeSite('acme.com', { ...site({ 'https://acme.com/': big }).opts, maxPages: 1 });
    expect(r.pages[0].text.length).toBeLessThanOrEqual(20000);
  });
});

describe('toPlainText', () => {
  const mk = (kind: ScrapedPage['kind'], n: string): ScrapedPage => ({ url: `https://x/${n}`, title: n, kind, text: n });
  const r: ScrapeResult = { rootUrl: 'https://x/', errors: [], pages: [mk('home', 'h'), mk('blog', 'b'), mk('team', 't'), mk('careers', 'c'), mk('about', 'a')] };
  it('orders careers/about/team first', () => {
    const t = toPlainText(r);
    expect(t.startsWith('=== CAREERS: https://x/c ===\nc\n\n')).toBe(true);
    expect(t.indexOf('=== ABOUT')).toBeLessThan(t.indexOf('=== TEAM'));
    expect(t.indexOf('=== TEAM')).toBeLessThan(t.indexOf('=== HOME'));
  });
  it('truncates', () => {
    expect(toPlainText(r, 30).length).toBe(30);
  });
});
