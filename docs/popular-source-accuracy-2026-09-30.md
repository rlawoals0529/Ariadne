# Popular-source accuracy plan — 2026-09-30

Ariadne should prioritize popular sites only when their evidence can be made materially stronger than a generic page check.

## Implemented in v0.9

### Twitch
Official docs:
- https://dev.twitch.tv/docs/api/reference/#get-users
- https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/

Ariadne uses an app access token and `GET https://api.twitch.tv/helix/users?login={username}`.

A result is **Found** only when Twitch returns the requested login. An empty `data` array is an explicit **No match**. Token failures, rate limits, and mismatches stay uncertain.

### YouTube
Official docs:
- https://developers.google.com/youtube/v3/docs/channels/list
- https://developers.google.com/youtube/v3/docs

Ariadne uses `channels.list` with the official `forHandle` parameter. The Data API requires an API key or OAuth token for requests.

A result is **Found** only when YouTube returns a channel for the exact handle lookup. Zero returned channels is **No match**. If YouTube returns a conflicting custom URL, Ariadne keeps the result uncertain.

### Steam Community
Official docs:
- https://partner.steamgames.com/doc/webapi/ISteamUser#ResolveVanityURL

Ariadne uses `ResolveVanityURL` for individual profile vanity names. A successful resolution to a SteamID is **Found**.

Steam's public documentation does not define a missing-result contract clearly enough for Ariadne to make every unresolved response a definitive **No match**, so unresolved vanity names stay **Couldn’t tell**.

## High-value next targets

### Instagram
Keep the current broad result conservative. Meta's supported Instagram APIs are oriented around authenticated/professional-account workflows rather than arbitrary public username existence checks. Do not add login, signup, password-reset, or private scraping fallbacks.

### TikTok
TikTok's Display API returns profile information for a user who has authorized the application. It is not an arbitrary public username lookup, so it should not replace the broad username check.

### X
A future exact adapter is possible only if current X API access and cost make a username lookup appropriate. Do not use third-party mirrors as identity proof.

### Spotify
Spotify removed the old public arbitrary user-profile endpoint in February 2026. The current user profile API is for the authenticated user, so Spotify should remain a cautious broad check rather than an exact username adapter.

### Discord
Discord usernames are unique, but the supported APIs do not provide a safe arbitrary-public-username existence lookup for this product. Do not use friend requests, account creation, login, or other side channels to infer existence.

## Admission rule

Popularity alone is not enough. A new exact adapter should meet all of these:
1. first-party or standards-based public endpoint;
2. no password-reset, signup, login, or account-recovery probing;
3. exact identifier evidence, or an official exact lookup filter;
4. explicit missing semantics before returning **No match**;
5. ambiguous, blocked, or rate-limited responses remain **Couldn’t tell** or **Blocked**;
6. secrets stay server-side.
