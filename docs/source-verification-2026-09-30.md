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
