# Ariadne

**Follow the thread. Keep the evidence.**

Ariadne searches public profile pages for a username and keeps uncertainty visible. It does not treat a page loading as proof that an account exists, and it no longer treats weak page-level “missing” signals as proof that an account is absent.

## v1.0 — evidence analytics and finished product experience

Ariadne v1.0 turns each username scan into a small evidence report rather than a flat list of links.

The solo report now includes:

- **scan coverage** — how much of the configured source set has returned;
- **exact resolution** — how often first-party/standards-based checks reached Found or No match;
- **verified share** — the mix of exact Found signals versus broader Maybe signals;
- **uncertainty** — Blocked + Couldn’t tell among attempted checks;
- **median and P90 source response time** from the current scan;
- an **evidence funnel** from attempted sources to verified matches;
- a **category footprint** that keeps Found and Maybe visually separate.

These metrics are calculated from the current scan in the browser. Ariadne still stores no searches and does not claim identity probabilities, privacy scores, or reputation scores. See `docs/product-metrics.md` for definitions and guardrails.

v1.0 also adds an exact **Last.fm** adapter using the official `user.getInfo` method. It is enabled when `LASTFM_API_KEY` is configured. Last.fm documents that this lookup requires an API key but does not require user authentication.

The frontend keeps the warm paper/thread identity while improving scanability, responsive result cards, keyboard focus, touch targets, sticky result filters, and the hierarchy between search, evidence summary, analytics, and individual sources.

## v0.9 — popular-site exact integrations

The next accuracy targets are **Twitch, YouTube, and Steam Community** because they are high-value username destinations and each has an official lookup path.

Ariadne now includes exact adapters for all three, but they are **credential-gated**:

- **Twitch** uses Helix `Get Users` with an app access token and compares the returned `login`.
- **YouTube** uses `channels.list?forHandle=` and only confirms a handle when the official Data API returns a channel for that exact handle lookup.
- **Steam Community** uses `ResolveVanityURL` and only confirms a vanity name when Steam resolves it to a SteamID. An unresolved response stays **Couldn’t tell** rather than becoming a definitive No match.

Until the relevant server-side credential is configured, Ariadne keeps the existing broad page check for that site. Once credentials are present, the stronger adapter automatically replaces the weaker duplicate instead of adding a second result.

Required Worker secrets:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `YOUTUBE_API_KEY`
- `STEAM_WEB_API_KEY`
- `LASTFM_API_KEY`

Do not expose these values in the browser bundle or commit them to the repository.

## v0.8 — exact checks over guesswork

Accuracy is the priority for this release. Ariadne adds four stronger public identity checks and disables their weaker catalog duplicates:

- **Lichess** — first-party user API returns the canonical username;
- **Scratch** — first-party profile API returns the username;
- **Roblox** — documented public username lookup returns the canonical account name;
- **Mastodon.social** — standards-based WebFinger returns the account subject.

That raises the exact-username tier from **13 to 17 sites** without increasing the overall number of sites scanned. These adapters may say **Found** only when the returned identity matches the requested username, and **No match** only when the first-party endpoint gives an explicit missing result. Mismatches, authentication requirements, rate limits, timeouts, and ambiguous responses stay uncertain.

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

Ariadne upgraded **Codewars, DEV Community, Hugging Face, and Keybase** from broad page checks to first-party public username lookups. Along with GitHub, GitLab, Hacker News, Codeberg, Reddit, AniList, Bluesky, Chess.com, and Codeforces, Ariadne had **13 exact username adapters** before the v0.8 accuracy pass.

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
