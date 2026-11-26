# Contributing

Thanks for helping! Small, focused pull requests are the easiest to review and merge.

## Good first contributions

- Fix a typo or an unclear step in the README
- Add a page type the website scraper should recognise (see `KINDS` in `src/scraper.ts`)
- Add a test for an edge case you hit on a real site
- Improve an error message so the fix is obvious

Look for issues labelled `good first issue`.

## Set up

```bash
git clone https://github.com/<your-username>/lead-scraper.git
cd lead-scraper
npm install
npm test
```

Needs Node.js 22+ (`nvm use` reads `.nvmrc`). Google Chrome is only needed for the `--render` mode, not for the tests.

## Before you open a pull request

```bash
npm run check   # TypeScript
npm test        # Vitest
```

- Keep the code style of the file you are editing (2 spaces, single quotes, small functions).
- New logic needs a test in `test/`. Tests must not hit the network: pass a fake `fetch` the way `test/scraper.test.ts` does.
- Never commit `.env`, API keys, cookies, or real people's scraped data. Use `example.com` / `acme.com` style test data.
- Do not weaken the private-network block in `isPublicHost`.

## Commit messages

Plain and short, in the present tense: `Add pricing page detection`, `Fix Apify timeout message`.

## Code of conduct

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
