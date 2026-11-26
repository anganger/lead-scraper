# Changelog

All notable changes are listed here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-11-26

### Added
- Website scraper: home page plus about, careers, team, product, pricing, blog and contact pages, as JSON and plain text.
- Automatic fallback to headless Chrome for JavaScript-only sites (`--render` to force it).
- LinkedIn scraper through Bright Data or Apify, with no LinkedIn account needed.
- LinkedIn browser mode with your own login, capped at 30 page loads an hour.
- Private-network (SSRF) blocking, tests, CI on Linux, macOS and Windows.
