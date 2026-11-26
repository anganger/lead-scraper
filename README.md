# lead-scraper

Two scrapers for researching a company:

- **Website:** reads the home page and key pages (about, careers, team, product, pricing, blog, contact) and saves the text.
- **LinkedIn:** reads a company page, its recent posts and a person's profile.

## Set up on a new machine (macOS, Windows or Linux)

1. Install **Node.js 22 or newer**: https://nodejs.org
2. Install **Google Chrome** (used for JavaScript-only sites and the browser LinkedIn mode). Nothing extra is downloaded.
3. In this folder:

```bash
npm install
```

4. Check it works:

```bash
npm test
```

```bash
npm run site -- https://example.com
```

## Website scraper

```bash
npm run site -- https://company.com
```

Output: `output/company-com.json` (pages with their type and text) and `.txt` (all text together).
Add `--render` to force Chrome. It switches to Chrome by itself when a plain request returns almost no text.
Private and local network addresses are blocked on purpose.

## LinkedIn scraper

### Option A (recommended): API services, no LinkedIn account needed

1. Get your **own** key from one or both:
   - Bright Data: https://brightdata.com (Web Scraper API; account settings, API token)
   - Apify: https://apify.com (Settings, API & Integrations; uses the HarvestAPI LinkedIn actors)
2. Create the settings file and paste the key(s) into it:

```bash
cp .env.example .env
```

(Windows: `copy .env.example .env`)

3. Run:

```bash
npm run linkedin -- --company https://www.linkedin.com/company/openai --person https://www.linkedin.com/in/some-person
```

Bright Data is tried first, Apify is the backup. Output: `output/linkedin-....json`.
Check current free limits and prices on both sites; calls can cost money. LinkedIn hides job titles and work history
from logged-out readers, so profiles mostly give name, company, about text and activity.

### Option B: your own LinkedIn login in Chrome

```bash
npm run linkedin:login
```

Sign in yourself in the window that opens, then:

```bash
npm run linkedin -- --company https://www.linkedin.com/company/openai --browser
```

**Warning:** automated reading breaks LinkedIn's User Agreement and **can get the account restricted**
(this has happened with this code: LinkedIn showed a "high volume of profile data" warning). It is capped at
30 page loads an hour. Prefer option A, and do not use an account you cannot afford to lose.

The login session is stored in `~/.lead-scraper` (change with `SCRAPER_HOME`). Never share that folder or `.env`.

## Using it from your own code

- `scrapeSite(url)` and `toPlainText(result)` in `src/scraper.ts`
- `renderSite(url)` in `src/render-fetch.ts`
- `scrapeLinkedInApi(companyUrl, personUrl, onProgress, onResult)` in `src/linkedin-api.ts`
- `scrapeLinkedIn(...)` (browser mode) in `src/linkedin.ts`

## Common problems

| Message | Fix |
|---|---|
| Chromium distribution 'chrome' is not found | Install Google Chrome |
| set BRIGHTDATA_TOKEN or APIFY_TOKEN | Create `.env` and add a key |
| LinkedIn needs you to sign in again | `npm run linkedin:login` |

You are responsible for using it within each site's terms and the privacy laws that apply to the people you look up.

## License

MIT, see `LICENSE`.
