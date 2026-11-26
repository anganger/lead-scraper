// LinkedIn without a login: Bright Data's Scraper API first (5,000 free records a month, 2 per lead), Apify (HarvestAPI) as backup.
// Same result shape as the Chrome scraper in linkedin.ts, so callers save it the same way. Tokens: BRIGHTDATA_TOKEN, APIFY_TOKEN.
// LinkedIn hides job titles and work history from logged-out readers since Nov 2025, so profiles carry name, company, about and activity.
import { normalizeLinkedInUrl, type LinkedInLogo, type LinkedInResult } from './linkedin';

export const linkedInApiReady = () => !!(process.env.BRIGHTDATA_TOKEN || process.env.APIFY_TOKEN);

const squash = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Cuts by code point: a plain slice can split an emoji and databases then reject the text as invalid JSON.
const cut = (s: unknown, n: number) => Array.from(squash(s)).slice(0, n).join('');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lines = (pairs: [string, unknown][]) => pairs.filter(([, v]) => squash(v)).map(([k, v]) => `${k}\n${squash(v)}`).join('\n');

// Only the fields we read from each service's JSON.
type BdCompany = { name?: string; slogan?: string; about?: string; website?: string; industries?: string; company_size?: string; employees_in_linkedin?: number;
  headquarters?: string; founded?: number; specialties?: string; funding?: unknown; investors?: unknown; followers?: number; logo?: string; company_id?: string;
  employees?: { title?: string; subtitle?: string; link?: string }[];
  updates?: { date?: string; time?: string; text?: string; likes_count?: number }[] };
type BdPerson = { name?: string; position?: string; current_company?: { name?: string; title?: string }; current_company_name?: string; city?: string; location?: string;
  about?: string; educations_details?: string; bio_links?: { link?: string }[]; activity?: { interaction?: string; title?: string }[] };
type ApCompany = { name?: string; tagline?: string; description?: string; website?: string; industries?: ({ name?: string } | string)[];
  employeeCountRange?: { start?: number; end?: number }; employeeCount?: number; locations?: { parsed?: { text?: string }; city?: string }[];
  foundedOn?: { year?: number }; followerCount?: number; logo?: string };
type ApPost = { postedAt?: { date?: string }; content?: string; engagement?: { likes?: number } };
type ApPerson = { firstName?: string; lastName?: string; headline?: string; location?: { linkedinText?: string }; about?: string;
  experience?: { position?: string; companyName?: string; startDate?: { text?: string }; endDate?: { text?: string } }[] };
type Failed = { error?: string; warning?: string };

async function bright<T>(dataset: string, url: string): Promise<T> {
  const h = { Authorization: `Bearer ${process.env.BRIGHTDATA_TOKEN}`, 'Content-Type': 'application/json' };
  const res = await fetch(`https://api.brightdata.com/datasets/v3/scrape?dataset_id=${dataset}&format=json`, { method: 'POST', headers: h, body: JSON.stringify([{ url }]) });
  let data: (T & Failed) | (T & Failed)[] | undefined;
  if (res.status === 202) {
    // Over a minute: Bright Data keeps going in the background; poll its snapshot for up to 5 minutes.
    const { snapshot_id } = await res.json();
    for (let i = 0; i < 30 && !data; i++) {
      await sleep(10_000);
      const s = await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${snapshot_id}?format=json`, { headers: h });
      if (s.status === 200) data = await s.json();
      else if (s.status !== 202) throw new Error(`Bright Data ${s.status}: ${(await s.text()).slice(0, 200)}`);
    }
    if (!data) throw new Error('Bright Data took over 5 minutes');
  } else if (!res.ok) throw new Error(`Bright Data ${res.status}: ${(await res.text()).slice(0, 200)}`);
  else data = await res.json();
  const it = Array.isArray(data) ? data[0] : data;
  if (!it || it.error || it.warning) throw new Error(`Bright Data: ${it?.error ?? it?.warning ?? 'nothing returned'}`);
  return it;
}

async function apify<T>(actor: string, input: object): Promise<T[]> {
  const res = await fetch(`https://api.apify.com/v2/acts/harvestapi~${actor}/run-sync-get-dataset-items?timeout=290`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const items: (T & Failed)[] = await res.json();
  if (!items.length || items[0]?.error) throw new Error(`Apify: ${items[0]?.error ?? 'nothing returned'}`);
  return items;
}

async function fetchLogo(url?: string): Promise<LinkedInLogo | undefined> {
  if (!url || !/^https:\/\/media\.licdn\.com\//.test(url)) return undefined;
  const res = await fetch(url).catch(() => null);
  const type = res?.headers.get('content-type')?.split(';')[0] ?? '';
  if (!res?.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) return undefined;
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.length < 512_000 ? { bytes, type } : undefined;
}

type Company = { about: string; posts: string; logo?: string };
// Names shown on the company page; the dossier uses them as "who else is there" when the contact is the wrong person.
const people = (list?: { title?: string; subtitle?: string; link?: string }[]) => {
  const rows = (list ?? []).filter((p) => p.title).slice(0, 12).map((p) => `- ${squash(p.title)}${p.subtitle ? ` (${squash(p.subtitle)})` : ''} | ${(p.link ?? '').split('?')[0]}`);
  return rows.length ? `\nPeople\n${rows.join('\n')}` : '';
};
type Person = string;

// Field labels match LinkedIn's About page, so companyFacts() in linkedin.ts reads website, industry and size from either scraper.
async function companyBright(co: string): Promise<Company> {
  const c = await bright<BdCompany>('gd_l1vikfnt1wgvvqz95w', co);
  const about = lines([['Name', c.name], ['Tagline', c.slogan], ['Overview', c.about], ['Website', c.website], ['Industry', c.industries],
    ['Company size', c.company_size], ['Employees on LinkedIn', c.employees_in_linkedin], ['Headquarters', c.headquarters], ['Founded', c.founded],
    ['Specialties', c.specialties], ['Funding', c.funding && JSON.stringify(c.funding)], ['Investors', c.investors], ['Followers', c.followers], ['LinkedIn ID', c.company_id]])
    + people(c.employees);
  const posts = (c.updates ?? []).slice(0, 5).map((p) => `[${(p.date ?? p.time ?? '?').slice(0, 10)}] ${cut(p.text, 700)} (${p.likes_count ?? 0} likes)`).join('\n\n');
  return { about, posts, logo: c.logo };
}
async function companyApify(co: string): Promise<Company> {
  const [[c], posts] = await Promise.all([apify<ApCompany>('linkedin-company', { companies: [co] }), apify<ApPost>('linkedin-company-posts', { targetUrls: [co], maxPosts: 3 }).catch((): ApPost[] => [])]);
  const about = lines([['Name', c.name], ['Tagline', c.tagline], ['Overview', c.description], ['Website', c.website], ['Industry', c.industries?.map((i) => typeof i === 'string' ? i : i.name).join(', ')],
    ['Company size', c.employeeCountRange && `${c.employeeCountRange.start}-${c.employeeCountRange.end ?? ''} employees`], ['Employees on LinkedIn', c.employeeCount],
    ['Headquarters', c.locations?.[0]?.parsed?.text ?? c.locations?.[0]?.city], ['Founded', c.foundedOn?.year], ['Followers', c.followerCount]]);
  const text = posts.map((p) => `[${String(p.postedAt?.date ?? '?').slice(0, 10)}] ${cut(p.content, 700)} (${p.engagement?.likes ?? 0} likes)`).join('\n\n');
  return { about, posts: text, logo: c.logo };
}
async function personBright(pe: string): Promise<Person> {
  const p = await bright<BdPerson>('gd_l1viktl72bvl7bjuj0', pe);
  const act = (p.activity ?? []).slice(0, 8).map((a) => `- ${squash(a.interaction)}: ${cut(a.title, 300)}`).join('\n');
  return lines([['Name', p.name], ['Headline', p.position], ['Current company', p.current_company?.name ?? p.current_company_name], ['Title', p.current_company?.title],
    ['Location', p.city ?? p.location], ['About', p.about], ['Education', p.educations_details], ['Links', (p.bio_links ?? []).map((b) => b.link).join(' ')]])
    + (act ? `\nRecent activity\n${act}` : '');
}
async function personApify(pe: string): Promise<Person> {
  const [p] = await apify<ApPerson>('linkedin-profile-scraper', { urls: [pe] });
  const exp = (p.experience ?? []).slice(0, 6).map((x) => `- ${x.position} @ ${x.companyName} (${x.startDate?.text ?? '?'} to ${x.endDate?.text ?? 'Present'})`).join('\n');
  return lines([['Name', `${p.firstName ?? ''} ${p.lastName ?? ''}`], ['Headline', p.headline], ['Location', p.location?.linkedinText], ['About', p.about]])
    + (exp ? `\nExperience\n${exp}` : '');
}

// Tries Bright Data, then Apify; returns the result and which service gave it, or throws both errors.
async function either<T>(hasBright: boolean, b: () => Promise<T>, a: () => Promise<T>): Promise<[T, string]> {
  let first = '';
  if (hasBright) try { return [await b(), 'Bright Data']; } catch (e) { first = (e as Error).message; }
  if (!process.env.APIFY_TOKEN) throw new Error(first || 'no LinkedIn service set up');
  try { return [await a(), 'Apify']; } catch (e) { throw new Error([first, (e as Error).message].filter(Boolean).join('; then ')); }
}

/** Reads the company page (+ its latest posts) and the contact's profile through the APIs; onResult fires per source.
 *  Returns notes for parts that failed, so the rest of the research still runs. */
export async function scrapeLinkedInApi(
  companyRaw: string | null, personRaw: string | null,
  onProgress: (s: string) => void, onResult: (r: LinkedInResult) => Promise<void>,
): Promise<string[]> {
  const notes: string[] = [];
  const hasBright = !!process.env.BRIGHTDATA_TOKEN;
  const co = normalizeLinkedInUrl(companyRaw), pe = normalizeLinkedInUrl(personRaw);
  onProgress('Reading LinkedIn company page and profile…');
  await Promise.all([
    co && either(hasBright, () => companyBright(co), () => companyApify(co)).then(async ([c, via]) => {
      await onResult({ source: 'linkedin_company', rootUrl: co, pages: [{ url: co, chars: c.about.length }], text: `Source: ${via}\n${c.about}`, logo: await fetchLogo(c.logo) });
      if (c.posts) await onResult({ source: 'linkedin_posts', rootUrl: `${co}/posts/`, pages: [{ url: `${co}/posts/`, chars: c.posts.length }], text: c.posts })
        .catch((e) => notes.push(`LinkedIn posts were not saved (${e.message}).`));
    }).catch((e) => notes.push(`LinkedIn company page was not read (${e.message}).`)),
    pe && either(hasBright, () => personBright(pe), () => personApify(pe)).then(([text, via]) =>
      onResult({ source: 'linkedin_person', rootUrl: pe, pages: [{ url: pe, chars: text.length }], text: `Source: ${via}\n${text}` }),
    ).catch((e) => notes.push(`LinkedIn profile was not read (${e.message}).`)),
  ]);
  return notes;
}
