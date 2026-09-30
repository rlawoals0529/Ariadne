# Ariadne

**Follow the thread. Keep the evidence.**

Give Ariadne a username and it checks public sites for that handle. It does not treat every page that loads as proof. A first-party lookup can confirm the username or explicitly say it is missing; a broad profile-page check stays uncertain when the page cannot settle the question.

## What a scan means

The result is an evidence report, not a row of green and red guesses.

- **Exact checks** use public first-party APIs or standards-based lookups when the site exposes one.
- **Broad checks** cover more of the web, but a plausible page is only **Maybe** and a weak missing signal is **Couldn’t tell**.
- **The report shows its own limits**: scan coverage, exact resolution, verified share, uncertainty, response-time distribution, an evidence funnel, and category footprint.
- **Compare Friends** checks 2–6 usernames and keeps Found separate from Maybe while calculating overlap from the current scan.
- Searches and comparisons are not stored by Ariadne.

That caution is the point. A false positive wastes your time, while a false negative can hide the account you were trying to find.

## Exact integrations

Ariadne has exact adapters for GitHub, GitLab, Hacker News, Codeberg, Reddit, AniList, Bluesky, Chess.com, Codeforces, Codewars, DEV Community, Hugging Face, Keybase, Lichess, Scratch, Roblox, and Mastodon.social. Twitch, YouTube, and Steam Community use server-side credentials when required. Last.fm is credential-gated and additionally requires explicit public-use approval before the Worker enables its public adapter. Without a credential, or without the required approval flag, Ariadne does not claim Last.fm exact evidence.

Worker secrets used by those credential-gated adapters:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `YOUTUBE_API_KEY`
- `STEAM_WEB_API_KEY`
- `LASTFM_API_KEY`
- `LASTFM_PUBLIC_APPROVED` (only set to `true` after Last.fm has provided the required written approval for public access)

Keep those values server-side. Do not put them in the browser bundle or commit them.

Release-by-release notes live in [`CHANGELOG.md`](CHANGELOG.md).

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

There are two kinds of checks:

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
