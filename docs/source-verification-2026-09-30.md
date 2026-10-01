# Source verification — 2026-09-30

This note records the evidence used for Ariadne's v0.8 exact-source accuracy pass. Exact adapters are admitted only when Ariadne can compare a returned first-party identifier with the requested username. A successful HTTP response by itself is never enough.

## Lichess

- First-party API reference: https://lichess.org/api#tag/Users/operation/apiUser
- API guidance: https://lichess.org/page/api-tips
- Adapter: `GET https://lichess.org/api/user/{username}`
- Positive evidence: response `username` must equal the requested username (case-insensitive).
- Negative evidence: HTTP 404 from this username-specific API endpoint.
- Rate limits and server errors remain `BLOCKED` / `UNKNOWN`.

## Roblox

- First-party Creator Hub reference: https://create.roblox.com/docs/cloud/reference/features/users
- Adapter: `POST https://users.roblox.com/v1/usernames/users`
- The Creator Hub documents this endpoint as “Get users by usernames” with no cookie required.
- Positive evidence: returned canonical `name` must equal the requested username (case-insensitive).
- Negative evidence: an empty `data` array for the exact submitted username.
- `excludeBannedUsers` is false so a banned account is not silently treated as unused.

## Mastodon.social

- Mastodon WebFinger reference: https://docs.joinmastodon.org/spec/webfinger/
- Adapter: `GET https://mastodon.social/.well-known/webfinger?resource=acct:{username}@mastodon.social`
- Positive evidence: returned `subject` must equal the requested `acct:` URI.
- Negative evidence: HTTP 404 from the WebFinger lookup.
- This uses the federation discovery mechanism rather than authenticated account search.

## Scratch

- First-party endpoint: `GET https://api.scratch.mit.edu/users/{username}`
- During this research pass, the first-party endpoint returned a public profile JSON object containing a canonical `username` field for an existing account.
- Positive evidence: returned `username` must equal the requested username (case-insensitive).
- Negative evidence: HTTP 404 from the username-specific endpoint.
- Scratch does not provide the same formal stability documentation as the other endpoints above, so runtime failures stay uncertain rather than being guessed.

## Admission rule

If any of these endpoints drifts, starts requiring authentication, returns a mismatched identifier, rate-limits Ariadne, or produces an ambiguous response, the adapter must return `UNKNOWN` or `BLOCKED`. The broad catalog duplicate is disabled only while the stronger adapter exists.


## 2026-10-01 exact-source additions

### Federated WebFinger sources

Ariadne now applies the same standards-based WebFinger verification pattern to Mastodon.cloud, Mastodon.xyz, mstdn.social, mstdn.io, social.tchncs.de, chaos.social, Fosstodon, Framapiaf, and Pixelfed.social.

- Reference: https://docs.joinmastodon.org/spec/webfinger/
- Positive evidence: returned `subject` equals the requested `acct:username@host` identifier.
- Negative evidence: HTTP 404 from that host's WebFinger endpoint.
- Authentication walls, rate limits, malformed JSON, and subject mismatches do not become Found.

### Mixcloud

- Official API: https://www.mixcloud.com/developers/
- Username guidance: https://help.mixcloud.com/hc/en-us/articles/10054754875932-FAQ-Usernames
- Adapter: `GET https://api.mixcloud.com/{username}/`
- Positive evidence: returned username or API object key resolves to the requested username.
- Negative evidence: HTTP 404.
- Public API rate limiting remains Blocked.

### Launchpad

- API overview: https://help.launchpad.net/API
- REST service docs: https://api.launchpad.net/1.0/
- Adapter: `GET https://api.launchpad.net/1.0/~{username}`
- Positive evidence: returned `name` equals the requested username.
- Negative evidence: HTTP 404.
- Other failures remain uncertain.


## 2026-10-01 second exact-source additions

### TETR.IO

- Official TETRA CHANNEL API: https://tetr.io/about/api/
- Adapter: `GET https://ch.tetr.io/api/users/{username}`
- The public API documents `data.username` on the username-specific user endpoint.
- Ariadne only returns Found when that canonical username matches the requested username.
- HTTP 404 is treated as an exact miss; other unsuccessful or malformed responses remain uncertain or blocked.

### RubyGems

- Official RubyGems.org API: https://guides.rubygems.org/rubygems-org-api/
- Adapter: `GET https://rubygems.org/api/v1/profiles/{handle}.json`
- The official Profile Methods response includes the user's canonical `handle`.
- Ariadne only returns Found when the returned handle matches the request.
- HTTP 404 is an exact miss.

### Gravatar

- Official profile endpoint: https://docs.gravatar.com/rest/api-data-specifications/endpoints-references/
- Adapter: `GET https://api.gravatar.com/v3/profiles/{profileIdentifier}`
- Gravatar documents profile URL slugs as valid public profile identifiers, a 200 response for a profile, and 404 for no profile.
- Ariadne extracts the returned `profile_url` slug and requires it to match the requested username before returning Found.
- Rate limits and server failures remain blocked or uncertain.

### LemmyWorld

- Official Lemmy API reference: https://join-lemmy.org/api/main
- Adapter: `GET https://lemmy.world/api/v4/person?username={username}`
- Lemmy documents this person lookup as usable without bearer authentication and accepts a username query.
- Ariadne requires the returned person's canonical `name` to match the requested username before returning Found.
- Ariadne only treats an explicit HTTP 404 as an exact miss; other API failures remain uncertain.


## 2026-10-01 SourceForge exact-source promotion

SourceForge's official API documentation includes public user-profile endpoints and states that unauthenticated requests operate with anonymous-visitor permissions.

- API documentation: https://sourceforge.net/api-docs/
- Profile endpoint: `GET https://sourceforge.net/rest/u/{username}/profile`
- Returned identity field: `username`
- Ariadne requires the returned username to match the requested username before returning Found.
- HTTP 404 is an exact miss.
- Authentication walls, rate limits, server failures, malformed responses, and identifier mismatches do not become Found.

This exact adapter replaces the inherited broad SourceForge page rule rather than running alongside it.


## 2026-10-01 Gitee exact-source promotion

Gitee's OpenAPI documentation lists `GET /v5/users/{username}` for retrieving a user, marks the access token optional, and states that no authorization is required. The returned `UserInfo` schema includes the canonical `login` field.

- endpoint: `https://gitee.com/api/v5/users/{username}`
- positive evidence: returned `login` equals the requested username;
- HTTP 404: exact miss;
- identifier mismatch: Couldn't tell;
- authentication/rate-limit/server failures: blocked or uncertain.

This exact adapter replaces the inherited broad Gitee rule.


## 2026-10-01 Gitea exact-source promotion

Gitea documents `GET /api/v1/users/{username}` as its user lookup endpoint and the returned user object includes the canonical login field.

- documentation: https://docs.gitea.com/api/1.24/operations/user-get/
- endpoint: `https://gitea.com/api/v1/users/{username}`
- positive evidence: returned `login` equals the requested username;
- HTTP 404: exact miss;
- HTTP 401: Blocked;
- identifier mismatch: Couldn't tell.

Ariadne does not assume authentication-free availability. If the host requires authentication, the adapter reports Blocked rather than falling back to a weaker inference.


## 2026-10-01 Discourse forum exact-source promotion

Discourse exposes a username-specific JSON route at `/u/{username}.json`. Discourse Meta documents the route for user data and examples show a payload containing `user.username`; public profile restrictions may reduce the other returned fields without removing that canonical username.

References:
- https://meta.discourse.org/t/adding-non-visible-user-custom-fields-to-the-api/276618
- https://meta.discourse.org/t/get-a-single-user-by-username-response-limited-via-python-request/313887

Ariadne's forum adapter:

- requests `https://{forum-host}/u/{username}.json`;
- requires returned `user.username` to match before returning Found;
- treats HTTP 404 as No match;
- treats HTTP 401/403 as Blocked;
- leaves malformed, non-JSON, or mismatched responses as Couldn't tell.

The adapter is used only for public Discourse community profiles already in Ariadne's catalog, plus HackerSploit and Windy.

## 2026-10-01 programming.dev exact-source promotion

Lemmy's official API documents `GET /api/v4/person` with an optional bearer authorization and a `username` query parameter for fetching person details.

Reference:
- https://join-lemmy.org/api/main

Ariadne requests `https://programming.dev/api/v4/person?username={username}` and only returns Found when the returned person's canonical `name` matches the requested username.


## 2026-10-01 third exact-source additions

### GNOME VCS

GNOME hosts its developer accounts on a GitLab instance.

- GitLab Users API: https://docs.gitlab.com/api/users/
- Adapter: `GET https://gitlab.gnome.org/api/v4/users?username={username}`
- GitLab documents exact username filtering and unauthenticated access to the users collection.
- Ariadne returns Found only when an item in the returned array has a case-insensitive canonical `username` match.
- An empty returned array is an exact miss. Authentication/server failures remain blocked or uncertain.

### NotABug.org

NotABug is a Gitea instance.

- Gitea user API: https://docs.gitea.com/api/1.26/operations/user-get/
- Adapter: `GET https://notabug.org/api/v1/users/{username}`
- Gitea documents the response `login` as the user's username and documents HTTP 404 for a missing user.
- Ariadne requires returned `login` to match before returning Found.

### Freelancer

- Official developer portal: https://developers.freelancer.com/
- Adapter: `GET https://www.freelancer.com/api/users/0.1/users?usernames[]={username}&compact=true`
- The endpoint is on Freelancer's official API domain and accepts username-filtered public user lookups.
- Ariadne inspects returned user objects and requires a canonical `username` match.
- An empty users object is treated as an exact miss; auth/rate-limit failures remain Blocked or Couldn't tell.

### Car Talk Community and Spells8

Both are handled through Ariadne's existing Discourse exact adapter pattern.

- Discourse API reference: https://docs.discourse.org/
- Ariadne requests the username-specific JSON profile endpoint and requires returned `user.username` / `username` equality.
- 404 is an exact miss; 401/403 stays blocked.


## 2026-10-01 fourth exact-source additions

### Wikipedia / Wikimedia global account

- CentralAuth API documentation: https://www.mediawiki.org/wiki/Extension:CentralAuth/API
- Adapter: `GET https://meta.wikimedia.org/w/api.php?action=query&list=globalusers&gususers={username}&format=json`
- CentralAuth documents `globalusers` as a read-only lookup for named global users.
- Ariadne returns Found only when the returned global `name` matches the requested username.
- An explicit missing marker or empty result is treated as an exact miss.

### freeCodeCamp

- Current public route implementation: https://github.com/freeCodeCamp/freeCodeCamp/blob/main/api/src/routes/public/user.ts
- Current response schema: https://github.com/freeCodeCamp/freeCodeCamp/blob/main/api/src/schemas/users/get-public-profile.ts
- Adapter: `GET https://api.freecodecamp.org/api/users/get-public-profile?username={username}`
- The current route returns `result: user.username` on a successful public profile and HTTP 404 with an empty object for a nonexistent user.
- Ariadne requires the returned `result` value to match the requested username.
- A 400 automated-client rejection is treated as Blocked, not No match.

### Signal Community

- Public forum: https://community.signalusers.org/
- Discourse API reference: https://docs.discourse.org/
- The site identifies itself as Discourse-powered and Ariadne uses the same exact `/u/{username}.json` verification pattern as its other admitted Discourse communities.
- The returned canonical username must match before Ariadne returns Found.

This source is intentionally labeled **Signal Community**. It does not inspect Signal messenger usernames, contacts, phone numbers, or private Signal profiles.
