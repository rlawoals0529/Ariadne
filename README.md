# Ariadne

**Follow the thread. Keep the evidence.**

Ariadne searches public profile pages for a username and keeps uncertainty visible. It does not turn a generic successful webpage response into a confirmed identity.

The core rule is simple: **a page loading is not proof that the account exists.** Exact username matches from a site's public API can become `FOUND`; broader page checks stay `POSSIBLE` until a person opens the profile and confirms it. Rate limits, anti-bot responses, network failures, and ambiguous responses stay `BLOCKED` or `UNKNOWN`.

## v0.5 — clearer wording, better exact checks, more friend games

v0.5 makes the app easier to understand without changing the conservative evidence model.

### Accuracy

Three sources that previously relied on broader profile rules now use stronger first-party public APIs:

- **Bluesky** — public AppView profile lookup;
- **Chess.com** — read-only PubAPI player endpoint;
- **Codeforces** — official `user.info` API.

Their weaker catalog duplicates are disabled, so Ariadne does not show the same site twice or prefer a heuristic result when an exact username check is available. Ariadne now has at least nine direct username adapters.

### Friend mode

The former Thread Party wording is simplified to **Compare friends**. The comparison still uses only the current browser session and is not saved.

Friend mode now adds factual, lightweight game cards:

- **Most in common** — pair with the most shared sites, using verified overlap first when breaking ties;
- **Most different** — pair with the fewest shared sites in the current scan;
- **Same corner** — pair with the strongest shared category such as gaming, social, or developer sites;
- **Most one-of-a-kind** — person with the most sites that did not appear for another friend.

These are playful summaries of the scan, not privacy, safety, reputation, or identity scores. `POSSIBLE` / “Maybe” results still require a manual check.

### Plain-language UI

Technical labels are translated in the main interface:

- `FOUND` → **Found**;
- `POSSIBLE` → **Maybe**;
- direct API evidence → **Verified by site**;
- heuristic profile evidence → **Needs a look**;
- technical response details are moved behind a **Technical details** disclosure.

The JSON export keeps the full machine-readable evidence for advanced users.

## v0.4 — evidence basis + broader coverage

v0.4 made the distinction between strong and heuristic evidence visible and added AniList plus 22 curated first-party public-profile rules from Ariadne's pinned Sherlock source snapshot.

## Source model

Ariadne combines two source tiers:

- **Exact username adapters** use first-party public APIs that return an identifier Ariadne can compare with the requested username.
- **Wide public-profile catalog** covers social, developer, gaming, creative, media, and community sites. The catalog is adapted from a pinned Sherlock Project source manifest and keeps heuristic hits separate from confirmed matches.

Adult/explicit sources are **off by default**. Ariadne only checks public profile pages and public profile APIs; it does not use signup forms, password-reset flows, breach data, or authenticated/private account data.

Large scans are split into small server-side batches. Each Worker request checks at most 20 sources with no more than five concurrent outbound connections.

## Status model

| Status | User-facing meaning | Internal meaning |
| --- | --- | --- |
| `FOUND` | Found | The source returned the requested identifier. |
| `POSSIBLE` | Maybe | A public profile rule suggests a match, but Ariadne cannot confirm it automatically. |
| `NOT_FOUND` | No match | The source returned a configured missing-profile signal. |
| `UNKNOWN` | Couldn’t tell | The response did not support a reliable claim. |
| `BLOCKED` | Blocked | Rate limiting, authentication, CAPTCHA, or anti-bot controls prevented verification. |
| `SKIPPED` | Skipped | The username does not fit that source's username rules, so no request was sent. |

Unknown is intentionally not treated as absence, and Maybe is intentionally not treated as Found.

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

`check` runs evidence/catalog tests, TypeScript/build validation, and a Wrangler deployment dry run. Pull requests run the same build path in GitHub Actions before merge.

## Deployment

```bash
npm run deploy
```

The Worker includes a Cloudflare Rate Limiting binding named `SEARCH_RATE_LIMITER`. `wrangler.jsonc` uses namespace `240529`; change it if that namespace collides with another binding in the same Cloudflare account.

## Source provenance

The wide catalog adapts public-profile rules from the MIT-licensed Sherlock Project manifest pinned to commit `e40a45ec2a074b90703b3b4b842c8a3adbd6ada3`. Ariadne changes Sherlock-style yes/no semantics: generic catalog positives become `POSSIBLE`, challenge pages stay `BLOCKED`, and high-confidence `FOUND` results remain limited to exact identifier evidence.

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the Sherlock license notice.

## Safety boundary

Ariadne is for public profile discovery and self-auditing public username footprints. It does not use breach databases, password-reset flows, signup-form account enumeration, authentication bypasses, or private APIs. Searches and friend comparisons are not stored.

See [`docs/architecture.md`](docs/architecture.md) for source-admission and evidence rules and [`SECURITY.md`](SECURITY.md) for security boundaries.
