// Read-only LinkedIn reader for the local worker: drives the owner's installed Chrome with a persistent,
// logged-in profile. It only loads pages and reads text: never messages, connects, likes or follows.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import type { ResearchSource } from './types';

export const HOME_DIR = process.env.SCRAPER_HOME || join(homedir(), '.lead-scraper');
export const PROFILE_DIR = join(HOME_DIR, 'chrome-profile');
const BUDGET_FILE = join(HOME_DIR, 'linkedin-budget.json');
const STATE_FILE = join(HOME_DIR, 'linkedin-state.json');
export const MAX_LOADS_PER_HOUR = 30;
export const RELOGIN_MSG = 'LinkedIn needs you to sign in again: run npm run linkedin:login.';

export class LinkedInNeedsLogin extends Error {
  constructor() { super(RELOGIN_MSG); }
}
export class LinkedInBudgetExceeded extends Error {
  constructor() { super(`Paused LinkedIn reading to protect your account (max ${MAX_LOADS_PER_HOUR} pages per hour). It will continue later.`); }
}

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

/** True when LinkedIn bounced us to a login wall or security checkpoint instead of the page we asked for. */
// A wrong or removed LinkedIn link: LinkedIn shows this instead of the profile or company page.
export const isMissingPage = (url: string, text: string) =>
  /linkedin\.com\/404/i.test(url) || /This page doesn.t exist|Page not found|this page (is|isn.t) (no longer )?available/i.test(text.slice(0, 1500));
export class LinkedInPageMissing extends Error {}

export function isAuthwall(url: string, text: string): boolean {
  if (/linkedin\.com\/(authwall|checkpoint|login|uas\/login|signup)/i.test(url)) return true;
  const t = text.slice(0, 3000);
  // LinkedIn's "high volume of profile data" warning: stop reading until the owner has dealt with it.
  if (/Important notice from LinkedIn|accessed a high volume of LinkedIn/i.test(t)) return true;
  return /Sign in to (see|view)|Join LinkedIn|Agree & Join|Let's do a quick security check|Welcome back[\s\S]{0,200}Sign in/i.test(t)
    && !/\bMessaging\b[\s\S]*\bNotifications\b/i.test(t);
}

/** Sliding one-hour window of page loads, kept on disk so restarts cannot reset it. */
export function takeBudget(file = BUDGET_FILE, now = Date.now(), max = MAX_LOADS_PER_HOUR): boolean {
  let loads: number[] = [];
  try {
    loads = (JSON.parse(readFileSync(file, 'utf8')).loads ?? []).filter((t: unknown) => typeof t === 'number');
  } catch {
    // missing or corrupt file: start fresh
  }
  loads = loads.filter((t) => now - t < 3_600_000);
  if (loads.length >= max) return false;
  loads.push(now);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify({ loads }));
  return true;
}

export function linkedInReady(file = STATE_FILE): boolean {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).ready === true;
  } catch {
    return false;
  }
}
export function setLinkedInReady(ready: boolean, file = STATE_FILE) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify({ ready, at: new Date().toISOString() }));
}

export async function openProfile(headless: boolean): Promise<BrowserContext> {
  const { chromium } = await import('playwright-core');
  mkdirSync(PROFILE_DIR, { recursive: true });
  return chromium.launchPersistentContext(PROFILE_DIR, { channel: 'chrome', headless, viewport: { width: 1280, height: 900 } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const humanDelay = () => sleep(5000 + Math.random() * 7000);

async function readPage(page: Page, url: string): Promise<string> {
  if (!takeBudget()) throw new LinkedInBudgetExceeded();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await sleep(2500);
  const check = async () => {
    const body = await page.locator('body').innerText().catch(() => '');
    if (isAuthwall(page.url(), body)) {
      setLinkedInReady(false);
      throw new LinkedInNeedsLogin();
    }
    if (isMissingPage(page.url(), body)) throw new LinkedInPageMissing(`This LinkedIn link does not open (page not found): ${url}`);
  };
  await check();
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 1200);
    await sleep(1200 + Math.random() * 1000);
  }
  // Expand truncated posts/about text. Only "see more" toggles: they stay on the page and send nothing.
  for (const b of await page.locator('button:visible', { hasText: /see more|…more|\.\.\.more/i }).all()) {
    await b.click({ timeout: 2000 }).catch(() => {});
  }
  await check();
  const main = page.locator('main');
  const text = (await main.count()) ? await main.first().innerText() : await page.locator('body').innerText();
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export type LinkedInTarget = { source: ResearchSource; urls: string[] };
export type LinkedInLogo = { bytes: Buffer; type: string };
export type LinkedInResult = { source: ResearchSource; rootUrl: string; pages: { url: string; chars: number }[]; text: string; logo?: LinkedInLogo };

// The company's profile picture on the page already open: LinkedIn serves it from media.licdn.com as "company-logo_…".
// Fetching the image is a CDN request, not a page load, so it does not use the hourly budget.
async function companyLogo(page: Page): Promise<LinkedInLogo | undefined> {
  const src = await page.locator('main img[src*="company-logo"]').first().getAttribute('src', { timeout: 3000 }).catch(() => null);
  if (!src || !/^https:\/\/media\.licdn\.com\//.test(src)) return undefined;
  const res = await page.request.get(src).catch(() => null);
  if (!res?.ok()) return undefined;
  const type = res.headers()['content-type']?.split(';')[0] ?? '';
  const bytes = await res.body();
  return /^image\/(png|jpeg|webp|gif)$/.test(type) && bytes.length < 512_000 ? { bytes, type } : undefined;
}

/** Reads only a company's About page and returns its logo; for leads researched before logos were saved. */
export async function scrapeCompanyLogo(companyRaw: string): Promise<LinkedInLogo | undefined> {
  const co = normalizeLinkedInUrl(companyRaw);
  if (!co) return undefined;
  const ctx = await openProfile(true);
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await readPage(page, `${co}/about/`);
    return await companyLogo(page);
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Plans which pages to read for a lead's company and contact LinkedIn values. */
export function linkedInTargets(companyRaw: string | null, personRaw: string | null): LinkedInTarget[] {
  const out: LinkedInTarget[] = [];
  const co = normalizeLinkedInUrl(companyRaw);
  if (co) out.push({ source: 'linkedin_company', urls: [`${co}/about/`] }, { source: 'linkedin_posts', urls: [`${co}/posts/?feedView=all`] });
  const p = normalizeLinkedInUrl(personRaw);
  if (p) out.push({ source: 'linkedin_person', urls: [`${p}/`, `${p}/recent-activity/all/`] });
  return out;
}

/** Reads each target in turn; onResult fires per source so work done before an authwall is kept.
 *  Returns notes for targets whose link was dead; a login wall or the hourly budget still stops everything. */
export async function scrapeLinkedIn(
  targets: LinkedInTarget[],
  onProgress: (s: string) => void,
  onResult: (r: LinkedInResult) => Promise<void>,
): Promise<string[]> {
  const notes: string[] = [];
  if (!targets.length) return notes;
  const ctx = await openProfile(true);
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    let first = true;
    for (const t of targets) {
      onProgress(`Reading LinkedIn ${t.source === 'linkedin_person' ? 'profile' : t.source === 'linkedin_posts' ? 'company posts' : 'company page'}…`);
      const pages: { url: string; chars: number }[] = [];
      const texts: string[] = [];
      try {
        for (const url of t.urls) {
          if (!first) await humanDelay();
          first = false;
          const text = await readPage(page, url);
          pages.push({ url, chars: text.length });
          texts.push(`=== ${url} ===\n${text}`);
        }
      } catch (e) {
        if (!(e instanceof LinkedInPageMissing)) throw e;
        notes.push(e.message);
        continue;
      }
      const logo = t.source === 'linkedin_company' ? await companyLogo(page) : undefined;
      await onResult({ source: t.source, rootUrl: t.urls[0], pages, text: texts.join('\n\n'), logo });
    }
    setLinkedInReady(true);
    return notes;
  } finally {
    await ctx.close().catch(() => {});
  }
}

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
