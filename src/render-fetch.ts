// Fallback for JavaScript-only sites (SPAs) and bot-walled sites: render pages in headless Chrome.
import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import type { ScrapeResult, ScrapedPage } from './scraper';

const PRIVATE = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['224.0.0.0', 3]] as const)
  PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) PRIVATE.addSubnet(net, bits, 'ipv6');

export async function isPublicHost(host: string, resolve = async (h: string) => (await lookup(h, { all: true })).map((a) => a.address)) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || /\.(local|internal|localhost)$/.test(h)) return false;
  const ips = isIP(h) ? [h] : await resolve(h).catch(() => [] as string[]);
  return ips.length > 0 && !ips.some((ip) => {
    const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    return v4 ? PRIVATE.check(v4, 'ipv4') : PRIVATE.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
  });
}

const KEY_LINK = /about|career|jobs|team|company|product|services|pricing|contact/i;

/** Renders the home page plus up to `maxPages - 1` key same-site pages and returns them like scrapeSite does. */
export async function renderSite(input: string, maxPages = 6): Promise<ScrapeResult> {
  const start = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pages: ScrapedPage[] = [];
  const errors: { url: string; error: string }[] = [];
  try {
    const ctx = await browser.newContext();
    const ok = new Map<string, boolean>();
    // Every request (redirects and subresources too) must go to a public host: this runs on your own network.
    await ctx.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (!/^https?:$/.test(u.protocol)) return u.protocol === 'data:' || u.protocol === 'blob:' ? route.continue() : route.abort();
      if (!ok.has(u.hostname)) ok.set(u.hostname, await isPublicHost(u.hostname));
      return ok.get(u.hostname) ? route.continue() : route.abort('blockedbyclient');
    });
    const page = await ctx.newPage();
    const read = async (url: string) => {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }).catch(async (e) => {
        if (!(await page.locator('body').count())) throw e; // networkidle timeouts are fine if something rendered
      });
      return { url: page.url(), title: await page.title(), text: (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000) };
    };
    const home = await read(start.href);
    pages.push({ ...home, kind: 'home' });
    const host = new URL(home.url).hostname.replace(/^www\./, '');
    const links = (await page.locator('a[href]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) as string[];
    const next = [...new Set(links.map((l) => l.split('#')[0]))]
      .filter((l) => { try { const u = new URL(l); return u.hostname.replace(/^www\./, '') === host && KEY_LINK.test(u.pathname); } catch { return false; } })
      .slice(0, maxPages - 1);
    for (const url of next) {
      try {
        pages.push({ ...(await read(url)), kind: 'other' });
      } catch (e) {
        errors.push({ url, error: (e as Error).message });
      }
    }
    return { rootUrl: home.url, pages, errors };
  } finally {
    await browser.close().catch(() => {});
  }
}
