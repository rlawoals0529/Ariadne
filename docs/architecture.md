# Architecture

## Goal

Ariadne answers a narrow question: does a public source provide reliable evidence that a requested username maps to a public account?

The answer space is deliberately larger than yes/no:

- `FOUND`: source-specific positive identity evidence.
- `POSSIBLE`: a public profile looks plausible, but Ariadne cannot confirm the username automatically.
- `NOT_FOUND`: a stronger exact source explicitly reports that the username is absent.
- `UNKNOWN`: the response does not support a reliable claim.
- `BLOCKED`: a rate limit, authentication requirement, CAPTCHA, or access control prevented verification.
- `SKIPPED`: the identifier is invalid for that source, so no request was sent.

The UI translates these states into **Found**, **Maybe**, **No match**, **Couldn’t tell**, **Blocked**, and **Skipped**. The exported JSON keeps the precise internal states.

## Request path

1. React sends `POST /api/search` with a username, an NSFW opt-in boolean, and an optional numeric cursor.
2. The Worker validates the input and applies Cloudflare's rate-limit binding using the client IP as the key.
3. The source registry excludes NSFW entries unless the caller explicitly opted in.
4. The selected registry is split into batches of at most 30 sources.
5. Each Worker request runs at most five outbound checks concurrently, staying below Cloudflare Workers' six-simultaneous-connection limit.
6. Exact adapters use direct public API identity evidence. Wide-catalog adapters use source-specific public profile rules.
7. When a site has both a broad catalog rule and an exact adapter, the broad duplicate is disabled.
8. The search safety layer downgrades any broad catalog `NOT_FOUND` result to `UNKNOWN`; only exact adapters may make a definitive absence claim.
9. The API returns a batch plus `nextCursor`; the browser accumulates batches into one report.
10. The browser renders the verdicts but never upgrades `POSSIBLE` to `FOUND` on its own.

## Source tiers

### Exact adapters

An exact source needs a stable public verification signal. Prefer first-party public JSON APIs that return the requested identifier and have documented or unambiguous missing behavior.

Exact sources may return `FOUND` only when the requested identifier itself is present in source-specific evidence. They may return `NOT_FOUND` only when their stronger endpoint explicitly indicates absence. Identifier mismatches stay `UNKNOWN`.

Current always-on exact adapters are:

- GitHub
- GitLab
- Hacker News
- Codeberg
- Reddit
- AniList
- Bluesky
- Chess.com
- Codeforces
- Codewars
- DEV Community
- Hugging Face
- Keybase
- Lichess
- Scratch
- Roblox
- Mastodon.social (WebFinger)

### Credential-backed popular-site adapters

Twitch, YouTube, Steam Community, and Last.fm have stronger official lookup APIs, but those APIs require application credentials. Ariadne constructs these adapters only when the corresponding Worker secrets are present.

- Twitch requires `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET`. The Worker obtains an app access token server-side and uses Helix `Get Users?login=`.
- YouTube requires `YOUTUBE_API_KEY` and uses `channels.list` with the `forHandle` filter.
- Steam Community requires `STEAM_WEB_API_KEY` and uses `ResolveVanityURL`.
- Last.fm requires `LASTFM_API_KEY` and uses the official unauthenticated `user.getInfo` method. Ariadne only turns its explicit "User not found" response into a definitive miss; other API errors remain uncertain or blocked.

When a credential-backed adapter has an existing broad catalog duplicate, that weaker duplicate is disabled for the request. Twitch, YouTube, and Steam therefore replace their fallback checks when credentials are active. Last.fm has no inherited broad duplicate in this catalog, so it adds one source only when its API key is configured.

Secrets are server-side Worker bindings. They are never returned by `/api/sources` or placed in the React bundle.

### Wide catalog

The wide catalog is adapted from the MIT-licensed Sherlock Project source manifest pinned to commit `e40a45ec2a074b90703b3b4b842c8a3adbd6ada3`.

Ariadne deliberately changes Sherlock-style semantics:

- a generic HTTP success is never promoted directly to `FOUND`;
- a successful configured rule becomes `POSSIBLE`;
- a configured missing marker or missing-style status from a broad catalog rule is **not trusted as proof of absence** and is downgraded to `UNKNOWN` by the search layer;
- 401/403/429, challenge pages, and known CAPTCHA markers become `BLOCKED`;
- 5xx responses, timeouts, and unclassified failures remain `UNKNOWN`;
- per-source username regexes are checked before network requests when available.

This false-negative guard exists because broad site markup can drift or generic page content can appear on both real and missing profiles. Twitch exposed a concrete example of that failure mode.

Catalog rules are limited to public profile pages and public profile APIs. Non-public account-existence mechanisms are intentionally outside the product boundary.

## Scan analytics

Solo-mode analytics are computed client-side from the current `SearchResponse`. They do not require telemetry or persistence.

The UI exposes coverage, exact-resolution rate, verified share of positive signals, uncertainty rate, median source latency, P90 source latency, an evidence funnel, and a category footprint. These are descriptive scan metrics only. They are not identity probabilities, privacy scores, safety scores, or cross-user rankings.

See `docs/product-metrics.md` for formulas and product guardrails.

## Friend mode

Friend mode compares **2–6** username reports entirely in the browser. It stores no friend group.

To keep larger comparisons practical, the browser scans up to two friends concurrently. With the current source count and 30-source server batches, one username normally needs five `/api/search` requests and a six-person comparison normally needs 30. The Cloudflare rate-limit binding allows 40 search-batch requests per IP per minute, leaving limited headroom without removing abuse controls.

Friend-game cards are derived only from the current reports:

- **Most in common** — pair with the largest total `FOUND` + `POSSIBLE` overlap;
- **Internet twins** — pair with the highest Jaccard-style overlap percentage: shared sites divided by the union of their Found/Maybe sites, rounded to a whole percent for display;
- **Most different** — pair with the lowest overlap percentage;
- **Same corner** — pair with the largest shared source-category count;
- **Most one-of-a-kind** — participant with the most sites unique to them in this scan;
- **Everyone’s here** — sites with a Found/Maybe result for every completed participant.

Verified overlap is tracked separately from broader Maybe overlap. These summaries are not privacy, safety, reputation, or identity scores.

## NSFW handling

Adult/explicit sources are tagged `nsfw: true` and excluded by default. The browser must send `includeNsfw: true` before those sources are selected. When enabled, each result keeps its NSFW flag and can be filtered separately in the UI.

Ariadne does not fetch or display adult media. It only checks public profile endpoints and returns the profile URL/evidence state.

## Privacy and abuse controls

The service stores no searches and has no user database. It does not access breach data or private account data. The public endpoint is rate-limited, large scans are batched, and raw identifiers are not persisted by the Worker.

Future persistence, saved friend groups, or public sharing features must be opt-in and documented before implementation.

## Validation

Unit tests cover evidence classification, catalog selection, NSFW exclusion, exact-adapter identity matches and explicit misses, broad-source count, generic `POSSIBLE` behavior, the broad-source false-negative guard, challenge-page blocking, and friend overlap/game calculations. CI also runs the production build, Wrangler dry deploy, and production dependency audit before merge.

Live source behavior can drift independently of Ariadne. A catalog entry passing unit tests does not imply that the external site currently permits automated verification. Runtime blocks and ambiguous responses remain `BLOCKED` or `UNKNOWN` rather than being converted into fabricated match claims.
