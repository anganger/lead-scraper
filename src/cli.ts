// npm run site -- <url>                              website -> output/<host>.json and .txt
// npm run linkedin -- --company <url> --person <url>  LinkedIn through Bright Data / Apify
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderSite } from './render-fetch';
import { scrapeSite, toPlainText } from './scraper';
import type { LinkedInResult } from './linkedin';
import { linkedInApiReady, scrapeLinkedInApi } from './linkedin-api';

const [mode, ...args] = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] ?? null : null; };
const slug = (s: string) => s.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80);
const save = (name: string, data: string) => { mkdirSync('output', { recursive: true }); writeFileSync(`output/${name}`, data); console.log(`saved output/${name}`); };

async function site(url: string) {
  let r = await scrapeSite(url).catch((e) => { console.log(`plain fetch failed: ${(e as Error).message}`); return null; });
  // JavaScript-only or bot-walled sites give almost no text without a real browser.
  if (!r || args.includes('--render') || toPlainText(r).length < 500) r = await renderSite(url);
  for (const e of r.errors) console.log(`skipped ${e.url}: ${e.error}`);
  save(`${slug(url)}.json`, JSON.stringify(r, null, 2));
  save(`${slug(url)}.txt`, toPlainText(r));
}

async function linkedin() {
  const company = flag('company'), person = flag('person');
  if (!company && !person) throw new Error('give --company <linkedin url> and/or --person <linkedin url>');
  const out: LinkedInResult[] = [];
  const keep = async (r: LinkedInResult) => { const { logo, ...rest } = r; out.push(rest); };
  const say = (s: string) => console.log(s);
  if (!linkedInApiReady()) throw new Error('set BRIGHTDATA_TOKEN or APIFY_TOKEN in .env (see README)');
  const notes = await scrapeLinkedInApi(company, person, say, keep);
  for (const n of notes) console.log(n);
  if (!out.length) throw new Error('nothing was read');
  save(`linkedin-${slug(company ?? person!)}.json`, JSON.stringify(out, null, 2));
}

const run = mode === 'site' && args[0] ? site(args[0]) : mode === 'linkedin' ? linkedin() : Promise.reject(new Error('usage: npm run site -- <url> | npm run linkedin -- --company <url> --person <url>'));
run.catch((e) => { console.error((e as Error).message); process.exitCode = 1; });
