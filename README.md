# Ariadne

**Follow the thread. Keep the evidence.**

Ariadne is an evidence-first public account discovery tool. Give it a username and it checks public profile sources while preserving why each result was classified the way it was.

The core rule is simple: **HTTP 200 is not proof that an account exists.** A result is only `FOUND` when a source-specific signal identifies the requested username. Rate limits, anti-bot responses, network failures, and ambiguous responses stay `BLOCKED` or `UNKNOWN`.

## v0.1

The first release checks five sources with public APIs:

- GitHub
- GitLab
- Hacker News
- Codeberg
- Reddit

Each result includes status, confidence, profile URL, HTTP state, verification signals, timestamp, and duration. The UI can open a profile, copy its URL, copy the evidence record, and export the complete report as JSON.

## Status model

| Status | Meaning |
| --- | --- |
| `FOUND` | Positive source-specific identity evidence matched the requested username. |
| `NOT_FOUND` | The source explicitly reported that no matching account exists. |
| `UNKNOWN` | Ariadne could not make an evidence-backed claim. |
| `BLOCKED` | Rate limiting or access controls prevented verification. |
| `SKIPPED` | The username is invalid for that source, so no request was sent. |

Unknown is intentionally not treated as absence.

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

`check` runs the evidence tests, TypeScript/build validation, and a Wrangler deployment dry run. Pull requests run the same build path in GitHub Actions before merge.

## Deployment

```bash
npm run deploy
```

The Worker includes a Cloudflare Rate Limiting binding named `SEARCH_RATE_LIMITER`. `wrangler.jsonc` uses namespace `240529`; change it if that namespace collides with another binding in the same Cloudflare account.

## Safety boundary

Ariadne is for public profile discovery. It does not use breach databases, password-reset flows, signup-form account enumeration, authentication bypasses, or private APIs. Search history is not stored in v0.1.

See [`docs/architecture.md`](docs/architecture.md) for the source-admission and evidence rules and [`SECURITY.md`](SECURITY.md) for security boundaries.
