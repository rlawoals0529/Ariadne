# Ariadne

**Follow the thread. Keep the evidence.**

Ariadne is an evidence-first public account discovery tool. Give it a username and it checks public profile sources while preserving why each result was classified the way it was.

The core rule is simple: **HTTP 200 is not proof that an account exists.** Direct API identity matches can become `FOUND`; broader catalog rules are reported as `POSSIBLE` until a human opens the profile and confirms it. Rate limits, anti-bot responses, network failures, and ambiguous responses stay `BLOCKED` or `UNKNOWN`.

## v0.2

Ariadne now combines two source tiers:

- **Verified core adapters** for GitHub, GitLab, Hacker News, Codeberg, and Reddit. These use source-specific public API identity evidence.
- **Wide public-profile catalog** covering social, developer, gaming, creative, media, and community sites. The catalog is adapted from a pinned Sherlock Project source manifest and keeps heuristic hits separate from confirmed matches.

Adult/explicit sources are **off by default**. The UI has a deliberate **Include NSFW / adult sources** toggle, and results can be filtered to standard-only or NSFW-only after a scan. Ariadne only checks public profile pages and does not use signup forms, password-reset flows, breach data, or authenticated/private APIs.

Large scans are split into small server-side batches. Each Worker request checks at most 20 sources with no more than five concurrent outbound connections, staying below Cloudflare Workers' six-simultaneous-connection limit while allowing the browser to accumulate a much larger report.

Each result includes status, confidence, category, sensitivity flag, profile URL, HTTP state, verification signals, timestamp, and duration. The UI can open a profile, copy its URL, copy the evidence record, and export the complete report as JSON.

## Status model

| Status | Meaning |
| --- | --- |
| `FOUND` | Positive source-specific identity evidence matched the requested username. |
| `POSSIBLE` | A public profile rule suggests a match, but Ariadne does not have enough evidence to call it confirmed automatically. |
| `NOT_FOUND` | The source returned its configured missing-profile signal. |
| `UNKNOWN` | Ariadne could not make an evidence-backed claim. |
| `BLOCKED` | Rate limiting, authentication, CAPTCHA, or anti-bot controls prevented verification. |
| `SKIPPED` | The username is invalid for that source, so no request was sent. |

Unknown is intentionally not treated as absence, and possible is intentionally not treated as confirmed.

## Stack

React 19 · TypeScript · Vite · Cloudflare Workers

Workers serve both the static application and `/api/*`. Searches are processed server-side so browser CORS behavior does not determine which sources can be checked.

## Local development

```bash
npm install
npm run dev
```

Validation:

```bash
npm run check
```

`check` runs the evidence/catalog tests, TypeScript/build validation, and a Wrangler deployment dry run. Pull requests run the same build path in GitHub Actions before merge.

## Deployment

```bash
npm run deploy
```

The Worker includes a Cloudflare Rate Limiting binding named `SEARCH_RATE_LIMITER`. `wrangler.jsonc` uses namespace `240529`; change it if that namespace collides with another binding in the same Cloudflare account.

## Source provenance

The wide catalog adapts public-profile rules from the MIT-licensed Sherlock Project manifest pinned to commit `e40a45ec2a074b90703b3b4b842c8a3adbd6ada3`. Ariadne does not copy Sherlock's yes/no semantics: catalog positives are deliberately downgraded to `POSSIBLE`, challenge pages stay `BLOCKED`, and direct high-confidence `FOUND` results remain limited to Ariadne's verified adapters.

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the Sherlock license notice.

## Safety boundary

Ariadne is for public profile discovery and self-auditing public username footprints. It does not use breach databases, password-reset flows, signup-form account enumeration, authentication bypasses, or private APIs. Search history is not stored.

See [`docs/architecture.md`](docs/architecture.md) for source-admission and evidence rules and [`SECURITY.md`](SECURITY.md) for security boundaries.
