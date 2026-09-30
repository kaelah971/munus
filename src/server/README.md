# Munus production API boundary

Munus now includes a small same-origin Node API in `server/`. It does not move the Vite client to another framework. Run it with `npm run db:migrate` followed by `npm run server:start`; put the Vite static build and this API behind the same origin in deployment.

## Routes

- `POST /auth/challenge` creates a persisted, five-minute, single-use Nimiq login challenge.
- `POST /auth/verify` verifies the exact signed challenge with `@nimiq/core`, consumes it atomically, creates the user/session, and sets an HttpOnly cookie.
- `GET /auth/session` restores the server session from that cookie.
- `POST /auth/logout` revokes the server session and clears the cookie.
- `GET /profile` and `PUT`/`PATCH /profile` read/write only the profile owned by the validated session.
- `GET /preferences` and `PUT`/`PATCH /preferences` persist non-secret user preferences for the validated session.
- `/pockets`, `/reminders`, and `/spend-rules` provide authenticated planning CRUD; pocket allocations use a row-locked PostgreSQL transaction so totals cannot race.
- `/contacts` provides manual Nigeria-first contact CRUD with archive semantics; `/support-rules` stores soft support warnings only.
- `/support-requests` provides authenticated pending/approved/declined/cancelled/prepared request lifecycle routes; `/support-drafts` stores reviewable non-payment intents.
- `GET /request/:publicRequestId` exposes a deliberately safe, opaque public projection with masked phone data. It never exposes wallet addresses or authorizes payment.

The server verifies that the supplied Ed25519 public key derives the challenged Nimiq address and that its signature verifies the exact UTF-8 challenge message. No wallet transaction is involved. Support routes likewise never call Nimiq Pay or a provider; they only save plans and review states.

## PostgreSQL trust boundary

The API uses `DATABASE_URL` only on the server. It is never a `VITE_*` variable and is never sent to the browser. Every query derives `user_id` from the verified opaque session and scopes ownership in parameterized SQL. PostgreSQL row locks protect pocket allocation updates, while the application session remains the primary authorization boundary.

Sessions store only SHA-256 hashes of random opaque tokens. The raw token exists only in the HttpOnly cookie. Cookies are `Secure` in production, `SameSite=Lax`, and server-revocable.

## Configuration

Client-safe values are `VITE_MUNUS_API_BASE_URL`, `VITE_MUNUS_PRODUCTION_AUTH`, `VITE_MUNUS_SESSION_MODE`, and the explicitly gated `VITE_MUNUS_LOCAL_AUTH`. Server-only values are documented in the root `.env.example`: `DATABASE_URL`, cookie/session settings, and the Nimiq network.

Production builds use the remote path and never silently fall back to localStorage auth. Local auth/profile/session storage remains available only for explicitly enabled development/test runs.
