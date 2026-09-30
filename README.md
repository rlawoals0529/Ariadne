# Ariadne

**Follow the thread. Keep the evidence.**

Ariadne searches public profile pages for a username and keeps uncertainty visible. It does not treat a page loading as proof that an account exists, and it no longer treats weak page-level “missing” signals as proof that an account is absent.

## v0.7 — bigger friend mode

Compare Friends supports **2–6 usernames** and checks up to two people at once. A full username scan is split into batches of up to 30 sites, reducing the number of browser-to-Worker requests while keeping outbound source checks capped at five concurrent connections per Worker request.

Friend mode now includes:

- **Most in common** — pair with the largest number of shared Found/Maybe sites;
- **Internet twins** — pair with the highest overlap percentage in this scan;
- **Most different** — pair with the lowest overlap percentage;
- **Same corner** — pair with the strongest shared category such as gaming, social, or developer;
- **Most one-of-a-kind** — person with the most sites not seen for another friend;
- **Everyone’s here** — sites that appeared for every completed friend.

The games keep **Found** and **Maybe** separate and never promote an uncertain result into a confirmed identity. Friend comparisons remain local to the browser session and are not saved by Ariadne.

The Worker rate-limit budget is 40 search-batch requests per IP per minute. With the current source count and 30-site batches, a six-person comparison normally needs 30 search-batch requests, leaving headroom for normal use without removing abuse controls.

## v0.6 — more exact username checks

Ariadne upgraded **Codewars, DEV Community, Hugging Face, and Keybase** from broad page checks to first-party public username lookups. Along with GitHub, GitLab, Hacker News, Codeberg, Reddit, AniList, Bluesky, Chess.com, and Codeforces, Ariadne now has **13 exact username adapters**.

When an exact site endpoint returns the requested username, Ariadne may mark the result **Found**. If the endpoint explicitly reports that the account is absent, it may mark the result **No match**. A different username, rate limit, block, timeout, or ambiguous response stays uncertain.

## v0.5.1 — false-negative guard

A real profile exposed an important flaw in the older broad-site rules: a stale or generic page marker could look like a “missing profile” response even when the profile existed. Twitch was one example.

Ariadne now applies this rule globally:

- **Exact first-party username checks** may return `NOT_FOUND` when the endpoint explicitly says the username is absent.
- **Broad page/catalog checks may not return definitive `NOT_FOUND`.** Their negative-looking signals are downgraded to `UNKNOWN` / **Couldn’t tell**.

This intentionally prefers an honest uncertain result over hiding a real account with a false negative.

## Plain-language result model

| Internal status | What the app says | Meaning |
| --- | --- | --- |
| `FOUND` | **Found** | The site returned the requested username. |
| `POSSIBLE` | **Maybe** | The public profile page looks plausible, but Ariadne cannot confirm the username automatically. |
| `NOT_FOUND` | **No match** | An exact site check explicitly reported that the username was absent. |
| `UNKNOWN` | **Couldn’t tell** | The response was unclear, including weak broad-site missing signals. |
| `BLOCKED` | **Blocked** | The site rate-limited, challenged, or otherwise prevented the check. |
| `SKIPPED` | **Skipped** | The username does not fit that site’s username rules. |

The main interface uses plain wording such as **Verified by site** and **Needs a look**. HTTP codes and raw evidence stay under **Technical details**.

## Source model

Ariadne combines two source tiers:

- **Exact username adapters** use first-party public APIs that return an identifier Ariadne can compare with the requested username.
- **Wide public-profile checks** cover additional social, developer, gaming, creative, media, community, and optional adult sites. Their positive results stay **Maybe**, and their negative results stay **Couldn’t tell** unless an exact adapter exists.

Adult/explicit sources are **off by default**. Ariadne only checks public profile pages and public profile APIs; it does not use signup forms, password-reset flows, breach data, or private account data.

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

`check` runs evidence, source, and friend-comparison tests, the production TypeScript/Vite build, and a Wrangler deployment dry run. Pull requests also run a production dependency audit before merge.

## Deployment

```bash
npm run deploy
```

The Worker includes a Cloudflare Rate Limiting binding named `SEARCH_RATE_LIMITER`. `wrangler.jsonc` uses namespace `240529`; change it if that namespace collides with another binding in the same Cloudflare account.

## Source provenance

The wide catalog adapts public-profile rules from the MIT-licensed Sherlock Project manifest pinned to commit `e40a45ec2a074b90703b3b4b842c8a3adbd6ada3`. Ariadne changes Sherlock-style yes/no semantics: catalog positives become `POSSIBLE`, catalog negatives do not prove absence, challenge pages stay `BLOCKED`, and `FOUND` / definitive `NOT_FOUND` remain limited to stronger exact evidence.

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the Sherlock license notice.

## Safety boundary

Ariadne is for public profile discovery and self-auditing public username footprints. It does not use breach databases, password-reset flows, signup-form account enumeration, authentication bypasses, or private APIs. Searches and friend comparisons are not stored.

See [`docs/architecture.md`](docs/architecture.md) for source-admission and evidence rules and [`SECURITY.md`](SECURITY.md) for security boundaries.
