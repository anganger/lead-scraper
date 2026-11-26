# Security policy

## Reporting a problem

Please **do not** open a public issue for a security problem. Report it privately here:
https://github.com/anganger/lead-scraper/security/advisories/new

You should get a reply within 7 days. Please include the steps to reproduce it.

## Supported versions

Only the latest commit on `main` gets fixes.

## Already handled on purpose

- The website scraper refuses private, local and cloud-metadata addresses (SSRF protection in `isPublicHost`).
- API keys are read only from your local `.env`, which is git-ignored.
- Browser mode stores your LinkedIn session in a local folder (`~/.lead-scraper`). Treat it like a password.
