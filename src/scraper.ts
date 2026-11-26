import { load } from 'cheerio';
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

export type Kind = 'home' | 'careers' | 'about' | 'team' | 'product' | 'pricing' | 'blog' | 'contact' | 'other';
export type ScrapedPage = { url: string; title: string; kind: Kind; text: string };
export type ScrapeResult = { rootUrl: string; pages: ScrapedPage[]; errors: { url: string; error: string }[] };
export type ScrapeOptions = {
  maxPages?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  lookup?: (host: string) => Promise<string[]>;
};
export class ScrapeError extends Error {}

const UA = process.env.SCRAPER_USER_AGENT || 'LeadScraper/1.0';
const MAX_BYTES = 2_000_000;
const PRIORITY = ['careers', 'about', 'team', 'product', 'pricing', 'contact', 'blog', 'other'];
const KINDS: [Kind, RegExp][] = [
  ['careers', /career|\bjobs?\b|join|hiring|work-with-us|open-roles|openings/],
  ['about', /about|company|who-we-are|our-story|mission/],
  ['team', /team|people|leadership|founders/],
  ['pricing', /pricing|plans/],
  ['product', /product|platform|solution|feature|services/],
  ['contact', /contact/],
  ['blog', /blog|news|press|insights|resources/],
];
const classify = (s: string): Kind => KINDS.find(([, re]) => re.test(s.toLowerCase()))?.[0] ?? 'other';
const ASSET = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|mp[34]|mov|avi|css|js|docx?|xlsx?|pptx?|woff2?|ttf|xml|json)$/i;
const ATS = /^(boards\.greenhouse\.io|job-boards\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com|apply\.workable\.com|[\w-]+\.breezy\.hr|[\w-]+\.recruitee\.com)$/;
const isAts = (u: URL) =>
  ATS.test(u.hostname) ||
  (u.hostname.endsWith('.bamboohr.com') && u.pathname.startsWith('/careers')) ||
  (u.hostname === 'wellfound.com' && u.pathname.startsWith('/company'));

const v4Private = ([a, b]: number[]) =>
  a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;

function isPrivateIp(raw: string): boolean {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const f = isIP(ip);
  if (f === 4) return v4Private(ip.split('.').map(Number));
  if (f !== 6) return true; // unparsable: refuse
  const m4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m4) return v4Private(m4[1].split('.').map(Number));
  const mh = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mh) {
    const x = parseInt(mh[1], 16), y = parseInt(mh[2], 16);
    return v4Private([x >> 8, x & 255, y >> 8, y & 255]);
  }
  return /^(0{1,4}:){6}0{0,3}[01]$/.test(ip) || ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip);
}

// shortcut: DNS is resolved here and again by fetch (rebinding window); upgrade by pinning the checked IP in a custom agent.
async function assertPublic(hostname: string, lookup: (h: string) => Promise<string[]>) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || /\.(local|internal|localhost)$/.test(host)) throw new Error(`blocked host ${host}`);
  const bare = host.replace(/^\[|\]$/g, '');
  const ips = isIP(bare) ? [bare] : await lookup(host);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error(`blocked address for ${host}`);
}

type Ctx = { fetchImpl: typeof fetch; lookup: (h: string) => Promise<string[]>; timeoutMs: number };

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const r = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  while (n < MAX_BYTES) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
  }
  await r.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, MAX_BYTES).toString('utf8');
}

async function fetchHtml(url: string, c: Ctx): Promise<{ url: string; html: string }> {
  let cur = url;
  for (let hop = 0; ; hop++) {
    const u = new URL(cur);
    if (!/^https?:$/.test(u.protocol)) throw new Error('unsupported protocol');
    await assertPublic(u.hostname, c.lookup);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), c.timeoutMs);
    try {
      const res = await c.fetchImpl(u.href, { redirect: 'manual', signal: ac.signal, headers: { 'user-agent': UA, accept: 'text/html' } });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        if (hop >= 5) throw new Error('too many redirects');
        cur = new URL(loc, u).href;
        await res.body?.cancel().catch(() => {});
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') || '')) throw new Error('not html');
      return { url: u.href, html: await readCapped(res) };
    } finally {
      clearTimeout(t);
    }
  }
}

function extract(html: string, pageUrl: string) {
  const $ = load(html);
  const title = $('title').first().text().trim() || $('h1').first().text().trim();
  const links: { u: URL; hint: string }[] = [];
  $('a[href],iframe[src]').each((_, el) => {
    try {
      const u = new URL($(el).attr('href') ?? $(el).attr('src') ?? '', pageUrl);
      if (/^https?:$/.test(u.protocol)) links.push({ u, hint: $(el).text() });
    } catch {}
  });
  $('script,style,noscript,svg,iframe').remove();
  $('br').replaceWith('\n');
  $('h1,h2,h3,h4,h5,h6,li,p,tr,div,section').before('\n').after('\n');
  const text = $('body').text().split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, 20000);
  return { title, links, text };
}

const key = (u: URL) => {
  const x = new URL(u.href);
  x.hash = '';
  [...x.searchParams.keys()].filter((k) => k.startsWith('utm_')).forEach((k) => x.searchParams.delete(k));
  if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, '');
  return x.href.replace('//www.', '//');
};

function parseInput(input: string): URL {
  const s = (input ?? '').trim();
  if (!s) throw new ScrapeError('empty url');
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname) throw 0;
    return u;
  } catch {
    throw new ScrapeError(`invalid url: ${input}`);
  }
}

export async function scrapeSite(input: string, opts: ScrapeOptions = {}): Promise<ScrapeResult> {
  const start = parseInput(input);
  const max = opts.maxPages ?? 12;
  const c: Ctx = {
    fetchImpl: opts.fetchImpl ?? fetch,
    lookup: opts.lookup ?? (async (h) => (await dnsLookup(h, { all: true })).map((a) => a.address)),
    timeoutMs: opts.timeoutMs ?? 10000,
  };
  const pages: ScrapedPage[] = [];
  const errors: { url: string; error: string }[] = [];
  let home: { url: string; html: string };
  try {
    home = await fetchHtml(start.href, c);
  } catch (e) {
    throw new ScrapeError(`cannot fetch ${start.href}: ${(e as Error).message}`);
  }
  const homeUrl = new URL(home.url);
  const strip = (h: string) => h.replace(/^www\./, '');
  const rootHost = strip(homeUrl.hostname);
  const sameSite = (h: string) => strip(h) === rootHost || (/^(careers|jobs)\./.test(h) && h.endsWith('.' + rootHost));

  type Cand = { url: string; kind: Kind; rank: number; probe: boolean };
  const seen = new Set([key(homeUrl)]);
  const queue: Cand[] = [];
  const add = (u: URL, hint: string, probe = false) => {
    const ats = isAts(u);
    if (!ats && (!sameSite(u.hostname) || ASSET.test(u.pathname))) return;
    const k = key(u);
    if (seen.has(k)) return;
    seen.add(k);
    const kind = ats ? 'careers' : classify(u.pathname + ' ' + hint);
    const clean = new URL(u.href);
    clean.hash = '';
    queue.push({ url: clean.href, kind, rank: ats ? -1 : PRIORITY.indexOf(kind) + (probe ? 0.5 : 0), probe });
  };
  const harvest = (html: string, pageUrl: string) => {
    const e = extract(html, pageUrl);
    e.links.forEach(({ u, hint }) => add(u, hint));
    return e;
  };

  const h = harvest(home.html, home.url);
  pages.push({ url: home.url, title: h.title, kind: 'home', text: h.text });
  for (const p of ['/careers', '/jobs', '/about', '/about-us', '/team', '/company', '/pricing']) add(new URL(p, homeUrl), '', true);

  while (pages.length < max && queue.length) {
    queue.sort((a, b) => a.rank - b.rank);
    const batch = queue.splice(0, Math.min(3, max - pages.length));
    const rs = await Promise.all(batch.map((cd) => fetchHtml(cd.url, c).then((r) => ({ cd, r }), (e: Error) => ({ cd, e }))));
    for (const x of rs) {
      if ('e' in x) {
        if (!x.cd.probe) errors.push({ url: x.cd.url, error: x.e.message });
        continue;
      }
      const g = harvest(x.r.html, x.r.url);
      pages.push({ url: x.r.url, title: g.title, kind: x.cd.kind !== 'other' ? x.cd.kind : classify(g.title), text: g.text });
    }
  }
  return { rootUrl: home.url, pages, errors };
}

export function toPlainText(r: ScrapeResult, maxChars = 60000): string {
  const first = ['careers', 'about', 'team'];
  const rank = (k: string) => (first.includes(k) ? first.indexOf(k) : first.length);
  return [...r.pages]
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .map((p) => `=== ${p.kind.toUpperCase()}: ${p.url} ===\n${p.text}\n\n`)
    .join('')
    .slice(0, maxChars);
}
