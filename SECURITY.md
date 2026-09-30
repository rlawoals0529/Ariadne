# Security

Ariadne is designed for public-account verification, not private-account discovery.

## Product boundaries

- Public sources only.
- No breach-data ingestion.
- No password-reset or signup-form account enumeration.
- No authentication bypasses, CAPTCHA bypasses, credential use, or private APIs.
- No search history is stored by the application in v0.1.
- Rate limits, anti-bot responses, timeouts, and ambiguous pages resolve to `BLOCKED` or `UNKNOWN`, never `FOUND`.

## Reporting

Please report security issues privately to the repository owner rather than opening a public issue with exploit details or personal data.
