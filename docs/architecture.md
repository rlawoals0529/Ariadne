# Architecture

## Goal

Ariadne answers a narrow question: does a public source provide evidence that a requested username maps to a public account?

The answer space is deliberately larger than yes/no:

- `FOUND`: source-specific positive identity evidence.
- `NOT_FOUND`: source-specific explicit negative evidence.
- `UNKNOWN`: response exists, but does not support a claim.
- `BLOCKED`: rate limit or access control prevented verification.
- `SKIPPED`: the identifier is invalid for that source, so no request was sent.

## Request path

1. React sends `POST /api/search` with a username.
2. The Worker validates the input and applies Cloudflare's rate-limit binding.
3. Five source adapters run in parallel, staying under the Workers six-connection limit.
4. Each adapter returns raw HTTP state plus a source-specific identity observation.
5. The evidence classifier produces a typed verdict.
6. The API returns the verdict and its evidence; the browser renders but does not reinterpret it.

## Source admission

A source should not ship merely because a profile URL can be templated. It needs a stable public verification signal. Prefer, in order:

1. public JSON API with an identifier field and explicit missing result;
2. stable redirect behavior with positive and negative controls;
3. profile-specific response markers with positive and negative controls.

Never treat a generic HTTP 2xx response as sufficient proof.

## Privacy and abuse controls

The initial service stores no searches, has no user database, and does not access breach data or private account-existence mechanisms. The public endpoint is rate-limited. Future persistence must be opt-in and documented before implementation.

## Validation state

As of the bootstrap commit, the pure evidence classifier is covered by local unit tests. GitHub's public user API was also reachable and returned its documented identifier field during research. GitLab, Hacker News, Reddit, and Codeberg adapters are based on current public API contracts, but live outbound execution from this development environment was unavailable; those adapters are therefore **NOT TESTED live** until CI/deployment smoke checks can reach them.
