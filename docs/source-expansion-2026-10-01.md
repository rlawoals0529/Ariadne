# Source expansion and accuracy audit — 2026-10-01

Ariadne's goal is broader public-profile coverage without treating every reachable page as proof that a username exists.

This pass compares Ariadne's catalog with the current Sherlock source snapshot:

- Sherlock snapshot: `sherlock-project/sherlock@e40a45ec2a074b90703b3b4b842c8a3adbd6ada3`
- Sherlock entries in that snapshot: 481
- Ariadne distinct source names before this pass: 133
- Ariadne distinct source names after this pass: about 211
- Expected default selection with no optional API credentials: 186 standard public-profile sources plus 19 opt-in adult sources (205 total)
- Expected direct/exact adapters with no optional credentials: 28

The automated source-catalog tests enforce the lower bounds above so later edits cannot silently shrink coverage.

## New exact checks

Exact sources are admitted only when Ariadne can compare a returned first-party or standards-based identifier with the requested username. A successful page load alone is not enough.

### Federated profiles via WebFinger

Ariadne now uses the standard `/.well-known/webfinger?resource=acct:username@host` flow for:

- Mastodon.cloud
- Mastodon.xyz
- mstdn.social
- mstdn.io
- social.tchncs.de
- chaos.social
- Fosstodon
- Framapiaf
- Pixelfed.social

The returned `subject` must match the requested `acct:` identifier. HTTP 404 is treated as an exact miss; rate limits, authentication walls, malformed responses, and mismatched subjects remain uncertain or blocked.

Reference:
- https://docs.joinmastodon.org/spec/webfinger/

### Mixcloud

Mixcloud documents a public read API that does not require authentication for user reads. Ariadne requests the username-specific API object and compares the returned username/key with the requested username.

References:
- https://www.mixcloud.com/developers/
- https://help.mixcloud.com/hc/en-us/articles/10054754875932-FAQ-Usernames

HTTP 404 is an exact miss. Public-API rate limiting or blocking remains Blocked.

### Launchpad

Launchpad exposes people through its public REST API at `https://api.launchpad.net/1.0/~<name>`. Ariadne compares the returned person `name` with the requested username.

References:
- https://help.launchpad.net/API
- https://api.launchpad.net/1.0/
- https://help.launchpad.net/API/launchpadlib

HTTP 404 is an exact miss. Other failures remain uncertain or blocked.

## Broad public-profile expansion

Ariadne also adds a curated Sherlock-derived batch of public profile pages across developer, gaming, creative, media, community, and social categories.

Broad-source rules remain deliberately weaker:

- a broad positive is **Maybe**, never **Found**;
- broad missing-profile signals are downgraded to **Couldn't tell** before they reach the user;
- a generic redirect to a site homepage, login page, auth page, 404 route, or not-found route is **Couldn't tell**;
- an empty successful response is **Couldn't tell**;
- anti-bot or CAPTCHA responses remain **Blocked**.

This pass adds sources including CodeChef, CodeSandbox, Crowdin, Gitee, HackerEarth, DMOJ, Lobsters, ObservableHQ, Open Collective, Packagist, Python.org Discussions, RubyGems, DailyMotion, Giphy, Odysee, Rate Your Music, ReverbNation, SlideShare, TheMovieDB, WordPress, Cults3D, MuseScore, MyMiniFactory, OpenGameArt, Redbubble, SpeakerDeck, YouPic, Kongregate, Newgrounds, PSNProfiles, Pokemon Showdown, RuneScape, Splits.io, TETR.IO, Typeracer, osu!, SpaceHey, Status Cafe, Pronouns.page, Untappd, and others.

## Intentionally held back

Ariadne does not aim to mirror every Sherlock entry. This pass intentionally excludes or defers categories that do not fit the product's evidence and safety boundaries.

### Breach / compromised-data sources

Examples include BreachSta.rs-related targets and HudsonRock-style breach or infostealer lookups.

Reason: Ariadne is a public-profile finder, not a breach-data or compromised-account discovery product.

### Financial and payment-account targets

Examples include Cash App and Venmo-style username lookups.

Reason: these can expose payment identities and are not necessary to Ariadne's public-profile purpose.

### Messaging-account side channels

Examples include arbitrary Discord, Slack, Signal, or similar account-existence probing.

Reason: supported APIs generally do not provide a safe arbitrary-public-username existence lookup, and Ariadne will not use friend requests, signup, login, recovery, or other behavioral side channels.

### Login, signup, recovery, or account-creation enumeration

Not admitted even when another OSINT tool can infer existence through those flows.

Reason: the product only checks public profile surfaces and first-party/standards-based public lookup endpoints.

### Third-party mirrors and proxy-only checks

Sources whose only practical rule depends on an unofficial mirror, embedded shared API key, or proxy-only bypass are held until Ariadne has a direct public-profile rule or first-party lookup.

### Fragile anti-bot-only sources

Sites whose current Sherlock entry explicitly notes that they only work through a proxy or are dominated by challenge pages are held rather than inflating coverage with mostly Blocked results.

## Automated catalog guardrails

`tests/sourceCatalog.test.mjs` now checks:

1. selected source IDs are unique;
2. selected source names remain unique after broad rules are replaced by exact adapters;
3. standard source profile URLs use HTTPS;
4. adult sources never leak into the standard selection;
5. prohibited side-channel targets stay out of the searchable set;
6. standard and exact-source counts do not silently fall below this pass's coverage floor;
7. a broad source redirected to a generic destination becomes **Couldn't tell**;
8. an empty successful broad response becomes **Couldn't tell**;
9. an ordinary broad positive remains **Maybe**, never **Found**.

The intended direction is to continue adding sources in batches while keeping these invariants stronger than the raw source-count goal.


## Scan ordering and wide-scan latency

The larger catalog changes scan scheduling as well as source count.

Ariadne now orders eligible sources as:

1. core direct checks;
2. exact adapters;
3. configured credential-backed exact checks;
4. broad catalog rules.

This means the strongest evidence appears in the earliest result batches instead of waiting behind hundreds of heuristic pages.

Exact/direct checks keep the existing 4.5 second per-source timeout. Broad catalog checks use a 3.2 second timeout because a slow broad page can only produce Maybe/uncertain evidence anyway. Timeout responses remain Couldn't tell; Ariadne does not convert a timeout into a missing account.


## Second coverage + accuracy pass

The follow-up pass expands the no-credential searchable set from 205 to 245 sources:

- 226 standard public-profile sources;
- 19 opt-in adult sources;
- 32 direct/exact checks before optional credential-backed integrations;
- 128 extended Sherlock-derived public-profile rules;
- roughly 251 distinct registered source names across the worker catalog and exact adapters.

### New exact replacements / additions

The second pass adds exact adapters for:

- TETR.IO — first-party TETRA CHANNEL user API;
- RubyGems — official profile API;
- Gravatar — official profile-by-slug API;
- LemmyWorld — Lemmy's public person lookup.

TETR.IO and RubyGems replace older broad rules. LemmyWorld also replaces its prior broad rule. Gravatar is a new exact-only source.

The exact adapters require canonical identifier equality before returning Found. A 200 response with a different username remains Couldn't tell.

### Second curated broad batch

The broad catalog adds developer/community destinations such as Ask Fedora, Caddy Community, Cloudflare Community, Discuss Elastic, Joplin Forum, Jupyter Community Forum, Nextcloud Forum, n8n Community, Sublime Forum, WICG Forum, GeeksforGeeks, Gradle Plugins, NotABug.org, and LinuxFR.org.

It also adds public gaming/media/creator profiles including NintendoLife, NitroType, Polygon, Sporcle, Star Citizen, VLR, CurseForge, GameFAQs, GameSpot, Giant Bomb, Genius Users, LottieFiles, Playstrategy, Pychess, Slant, Smule, MyDramaList, ThemeForest, and others.

These remain broad rules: a positive is Maybe, generic redirects/empty successes are Couldn't tell, and the search layer does not promote broad missing signals to definitive No match.

### Updated invariants

The source-catalog test suite now requires:

- at least 225 standard sources;
- at least 32 direct/exact checks;
- at least 23 exact adapter definitions;
- at least 128 extended public-profile rules;
- all 30 entries in the first result batch to be direct/exact checks;
- canonical-identifier matches for the new exact adapters;
- canonical-identifier mismatches to remain Couldn't tell.


## Third coverage + source-health pass

This pass raises the no-credential searchable floor again:

- at least 258 standard public-profile sources;
- 19 opt-in adult sources;
- at least 34 direct/exact checks;
- at least 25 exact adapter definitions;
- at least 161 extended Sherlock-derived public-profile rules.

### Exact SourceForge verification

SourceForge is promoted from a broad page rule to its documented public REST profile API:

- profile: `https://sourceforge.net/u/{username}/profile/`
- API: `GET https://sourceforge.net/rest/u/{username}/profile`
- positive evidence: returned `username` equals the requested username;
- explicit HTTP 404: exact miss;
- authentication/rate-limit/server failures: blocked or uncertain.

SourceForge documents that anonymous API requests have anonymous-visitor permissions and documents both the user-profile REST route and the returned `username` field.

### Third curated broad batch

The public-profile catalog adds another conservative batch including:

- developer/security: CSSBattle, CTAN, Coders Rank, Codolio, CryptoHack, CyberDefenders, HackTheBox, PentesterLab, Replit, Weblate, Ionic Forum;
- creator/portfolio: ColourLovers, Contently, Coroflot, Crevado, Exposure, Houzz, WebNode, Weebly, Wix;
- media/community/social: HubPages, Instapaper, Issuu, LibraryThing, Plurk, Polarsteps, Sessionize, Velog, Wordnik, CNET, Native Instruments Community, Icons8 Community.

These remain Maybe-only broad rules. Generic redirects and empty 200 responses remain Couldn't tell, anti-bot pages remain Blocked, and broad missing-page signals remain conservative at the search layer.

### Entries deliberately held back in this pass

Some otherwise tempting Sherlock entries were not admitted:

- **Wikidot**: the current upstream rule still uses an HTTP profile URL, which violates Ariadne's HTTPS-only catalog invariant.
- **Minds**: the upstream probe uses a registration-validation endpoint rather than a public-profile lookup.
- **omg.lol**: the upstream probe is an address-availability endpoint rather than profile evidence.
- **Imgur**: the upstream rule embeds a shared client ID in the probe URL; Ariadne does not inherit third-party/shared credentials.
- **Kick**: upstream explicitly notes that the rule is only viable through a proxy because of Cloudflare.
- **Discord / Slack / Signal / payment and breach-data targets** remain excluded for the existing public-profile-only reasons.

### Source quality audit

A new `npm run audit:sources` command compiles the source catalog and reports:

- standard and opt-in adult source counts;
- direct/exact versus broad/heuristic counts;
- exact adapter count;
- extended broad-rule count;
- broad rule composition by status-code, missing-message, and redirect rule;
- count of dedicated probe URLs and username validators;
- count of weakest status-only rules;
- catalog provenance.

The audit fails on duplicate IDs/names, non-HTTPS public profile URLs, coverage regression below this pass's floors, or a direct/exact share below 10% of standard sources. CI now runs this audit on every PR and main push.


### Gitee exact-source promotion

Gitee is also promoted from a broad profile rule to its documented OpenAPI user endpoint:

- endpoint: `GET https://gitee.com/api/v5/users/{username}`;
- Gitee documents the access token as optional and the endpoint as requiring no authorization;
- the returned `UserInfo` model exposes the canonical `login`;
- Ariadne only returns Found when `login` matches the requested username;
- HTTP 404 is an exact miss; mismatches and other ambiguous failures remain uncertain.
