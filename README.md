# lead-scraper

[![CI](https://github.com/anganger/lead-scraper/actions/workflows/ci.yml/badge.svg)](https://github.com/anganger/lead-scraper/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

**Research a company in one command.** Point it at a website or a LinkedIn page and get clean text you can read, search, or feed to an LLM.

- **Website scraper:** finds and reads the pages that matter (home, about, careers, team, product, pricing, blog, contact).
- **LinkedIn scraper:** reads a company page, its recent posts, and a person's public profile, through an API service so no LinkedIn account is needed.

Built for sales research, lead qualification, recruiting, and market research.

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Website scraper](#website-scraper)
- [LinkedIn scraper](#linkedin-scraper)
- [Configuration](#configuration)
- [Output format](#output-format)
- [Use it from your own code](#use-it-from-your-own-code)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Responsible use](#responsible-use)

## Features

- Picks the useful pages of a site by itself, including careers pages on Greenhouse and Lever.
- Falls back to headless Chrome when a site only renders with JavaScript.
- Blocks private and local network addresses (SSRF protection), so it is safe to run on URLs from other people.
- LinkedIn through **Bright Data** first and **Apify** as backup; you only need one key.
- Optional browser mode that uses your own LinkedIn login, with a built-in rate limit.
- Saves JSON for programs and plain text for people and LLMs.
- No database, no server: one folder, two commands.
- Tested on Linux, macOS and Windows.

## Quick start

You need **[Node.js 22+](https://nodejs.org)** and **[Google Chrome](https://www.google.com/chrome/)** (Chrome is only used for JavaScript-heavy sites and LinkedIn browser mode; nothing extra is downloaded).

```bash
git clone https://github.com/anganger/lead-scraper.git
cd lead-scraper
npm install
npm test
```

Try it:

```bash
npm run site -- https://example.com
```

Your results are in the `output/` folder.

## Website scraper

```bash
npm run site -- https://company.com
```

| Option | What it does |
|---|---|
| `--render` | Always use Chrome (for sites that load their content with JavaScript). It switches to Chrome by itself when a plain request returns almost no text. |

Saves `output/company-com.json` and `output/company-com.txt`.

## LinkedIn scraper

### Option A (recommended): an API service, no LinkedIn account

1. Get your **own** key from one or both services:
   - **Bright Data:** [brightdata.com](https://brightdata.com) → Web Scraper API → account settings → API token
   - **Apify:** [apify.com](https://apify.com) → Settings → API & Integrations (uses the HarvestAPI LinkedIn actors)
2. Create your settings file and paste the key in:

   ```bash
   cp .env.example .env
   ```

   On Windows: `copy .env.example .env`

3. Run it with a company page, a person, or both:

   ```bash
   npm run linkedin -- --company https://www.linkedin.com/company/openai --person https://www.linkedin.com/in/some-person
   ```

Bright Data is tried first and Apify is the backup. Both have free tiers, but calls can cost money, so check their current pricing.

> LinkedIn hides job titles and work history from logged-out readers, so profiles mostly give the name, current company, about text and recent activity.

### Option B: your own LinkedIn login

```bash
npm run linkedin:login
```

Sign in yourself in the Chrome window that opens (the script never sees your password). Then:

```bash
npm run linkedin -- --company https://www.linkedin.com/company/openai --browser
```

> **Warning:** automated reading is against LinkedIn's User Agreement and **can get the account restricted**. Browser mode is capped at 30 page loads an hour. Prefer option A, and never use an account you cannot afford to lose.

## Configuration

All settings live in `.env` (copied from [`.env.example`](.env.example)). `.env` is git-ignored, so your keys stay on your machine.

| Variable | Needed for | Description |
|---|---|---|
| `BRIGHTDATA_TOKEN` | LinkedIn option A | Bright Data API token |
| `APIFY_TOKEN` | LinkedIn option A | Apify API token (backup, or use alone) |
| `SCRAPER_HOME` | optional | Where browser mode keeps its login session. Default `~/.lead-scraper` |
| `SCRAPER_USER_AGENT` | optional | Custom User-Agent for website requests |

## Output format

Website (`output/<site>.json`):

```json
{
  "rootUrl": "https://company.com/",
  "pages": [
    { "url": "https://company.com/", "title": "Company", "kind": "home", "text": "..." },
    { "url": "https://company.com/careers", "title": "Careers", "kind": "careers", "text": "..." }
  ],
  "errors": []
}
```

`kind` is one of `home`, `careers`, `about`, `team`, `product`, `pricing`, `blog`, `contact`, `other`.

LinkedIn (`output/linkedin-<name>.json`): a list with one entry per source (`linkedin_company`, `linkedin_posts`, `linkedin_person`):

```json
[
  { "source": "linkedin_company", "rootUrl": "https://www.linkedin.com/company/acme", "pages": [{ "url": "...", "chars": 1840 }], "text": "..." }
]
```

## Use it from your own code

```ts
import { scrapeSite, toPlainText } from './src/scraper';
import { scrapeLinkedInApi } from './src/linkedin-api';

const site = await scrapeSite('https://company.com');
console.log(toPlainText(site));
```

| Function | File |
|---|---|
| `scrapeSite(url, options?)`, `toPlainText(result)` | `src/scraper.ts` |
| `renderSite(url)` (Chrome) | `src/render-fetch.ts` |
| `scrapeLinkedInApi(companyUrl, personUrl, onProgress, onResult)` | `src/linkedin-api.ts` |
| `scrapeLinkedIn(targets, onProgress, onResult)` (browser mode) | `src/linkedin.ts` |

## Project structure

```
src/
  cli.ts           command line entry (npm run site / linkedin)
  scraper.ts       website scraper: page discovery and text extraction
  render-fetch.ts  Chrome fallback and private-network blocking
  linkedin-api.ts  LinkedIn through Bright Data / Apify
  linkedin.ts      LinkedIn browser mode, URL cleanup, rate limit
  login.ts         one-time LinkedIn sign-in for browser mode
test/              Vitest tests (no network needed)
```

## Troubleshooting

| Message | Fix |
|---|---|
| `Chromium distribution 'chrome' is not found` | Install Google Chrome |
| `set BRIGHTDATA_TOKEN or APIFY_TOKEN` | Create `.env` and add a key (see [Configuration](#configuration)) |
| `LinkedIn needs you to sign in again` | Run `npm run linkedin:login` |
| `blocked host ...` or `blocked address for ...` | The URL points inside a private network; only public sites are allowed |
| Very little text from a site | Add `--render` |

Still stuck? [Open an issue](https://github.com/anganger/lead-scraper/issues/new/choose).

## Contributing

Contributions are welcome, from typo fixes to new features. Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started. If this project helped you, a ⭐ helps others find it.

## Responsible use

You are responsible for using this tool within each website's terms of service and the privacy laws that apply to the people you look up (for example GDPR). Respect `robots.txt`, keep request volumes low, and do not collect data you do not need.

## License

[MIT](LICENSE)
