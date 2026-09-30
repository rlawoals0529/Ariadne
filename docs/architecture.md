# Architecture

## Goal

Ariadne answers a narrow question: does a public source provide evidence that a requested username maps to a public account?

The answer space is deliberately larger than yes/no:

- `FOUND`: source-specific positive identity evidence.
- `POSSIBLE`: a broader public-profile rule suggests a match, but Ariadne does not have enough evidence to confirm it automatically.
- `NOT_FOUND`: source-specific explicit negative evidence.
- `UNKNOWN`: response exists, but does not support a claim.
- `BLOCKED`: rate limit, authentication, CAPTCHA, or access control prevented verification.
- `SKIPPED`: the identifier is invalid for that source, so no request was sent.

The UI translates these states into simpler language such as **Found**, **Maybe**, **No match**, and **Couldn’t tell**. The exported JSON keeps the precise internal states.

## Request path

1. React sends `POST /api/search` with a username, an NSFW opt-in boolean, and an optional numeric cursor.
2. The Worker validates the input and applies Cloudflare's rate-limit binding using the client IP as the key.
3. The source registry excludes NSFW entries unless the caller explicitly opted in.
4. The selected registry is split into batches of at most 20 sources.
5. Each Worker request runs at most five outbound checks concurrently, staying below Cloudflare Workers' six-simultaneous-connection limit.
6. Exact adapters use direct public API identity evidence. Wide-catalog adapters use source-specific public profile heuristics.
7. When a site has both a heuristic catalog rule and an exact adapter, the heuristic duplicate is disabled.
8. The API returns a batch plus `nextCursor`; the browser accumulates batches into one report.
9. The browser renders the verdicts but never upgrades `POSSIBLE` to `FOUND` on its own.

## Source tiers

### Exact adapters

An exact source needs a stable public verification signal. Prefer, in order:

1. public JSON API with an identifier field and explicit missing result;
2. stable redirect behavior with positive and negative controls;
3. profile-specific response markers with positive and negative controls.

Exact sources may return `FOUND` only when the requested identifier itself is present in source-specific evidence. Current exact adapters include GitHub, GitLab, Hacker News, Codeberg, Reddit, AniList, Bluesky, Chess.com, and Codeforces.

### Wide catalog

The wide catalog is adapted from the MIT-licensed Sherlock Project source manifest pinned to commit `e40a45ec2a074b90703b3b4b842c8a3adbd6ada3`.

Ariadne deliberately changes Sherlock-style semantics:

- a generic HTTP success is never promoted directly to `FOUND`;
- a successful configured rule becomes `POSSIBLE` with medium confidence;
- explicit configured missing markers become `NOT_FOUND` with medium confidence;
- 401/403/429, challenge pages, and known CAPTCHA markers become `BLOCKED`;
- 5xx responses, timeouts, and unclassified failures remain `UNKNOWN`;
- per-source username regexes are checked before network requests when available.

Catalog rules are limited to public profile pages and public profile APIs. Non-public account-existence mechanisms are intentionally outside the product boundary.

## Friend mode

Friend mode compares 2–4 completed username reports entirely in the browser. It stores no friend group.

The friend-game cards are derived from raw overlap only:

- **Most in common** sorts pairs by shared verified matches first, then by total `FOUND` + `POSSIBLE` overlap;
- **Most different** uses the smallest total overlap;
- **Same corner** uses the largest shared source-category count;
- **Most one-of-a-kind** uses the number of sources unique to one participant in the current scan.

These summaries are not privacy, safety, reputation, or identity scores. `POSSIBLE` results remain visibly separate from `FOUND` results.

## NSFW handling

Adult/explicit sources are tagged `nsfw: true` and excluded by default. The browser must send `includeNsfw: true` before those sources are selected. When enabled, each result keeps its NSFW flag and can be filtered separately in the UI.

Ariadne does not fetch or display adult media. It only checks public profile endpoints and returns the profile URL/evidence state.

## Privacy and abuse controls

The service stores no searches and has no user database. It does not access breach data or private account data. The public endpoint is rate-limited, large scans are batched, and raw identifiers are not persisted by the Worker.

Future persistence, saved friend groups, or sharing features must be opt-in and documented before implementation.

## Validation

Pure evidence classification, catalog selection, NSFW exclusion, exact-adapter behavior, broad-source count, generic `POSSIBLE` behavior, missing-profile behavior, and challenge-page blocking are covered by unit tests. CI also runs the production build, Wrangler dry deploy, and production dependency audit before merge.

Live source behavior can drift independently of Ariadne. A catalog entry passing unit tests does not imply that the external site currently permits automated verification. Runtime blocks remain `BLOCKED` or `UNKNOWN` rather than being converted into fabricated match claims.
