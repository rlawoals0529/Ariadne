# Security

Ariadne is designed for public-account verification and self-auditing public username footprints, not private-account discovery.

## Product boundaries

- Public profile pages and public profile APIs only.
- No breach-data ingestion or private account data.
- No authentication or CAPTCHA bypasses.
- No search history is stored by the application.
- NSFW/adult sources are disabled by default and require explicit opt-in.
- Broad-catalog successes are `POSSIBLE`, not automatically `FOUND`.
- Rate limits, anti-bot responses, timeouts, and ambiguous pages resolve to `BLOCKED` or `UNKNOWN`, never confirmed matches.
- Large scans are split into bounded batches and use at most five concurrent outbound connections per Worker request.

## Reporting

Please report security issues privately to the repository owner rather than opening a public issue with exploit details or personal data.
