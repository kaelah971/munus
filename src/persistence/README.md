# Persistence boundary

Production persistence is served by the same-origin API in `server/` and backed by Neon PostgreSQL. The API derives the owning user from a verified opaque HttpOnly session and exposes profile plus non-secret preference reads/writes only for the current user.

`RemoteProfileApi` is the browser boundary used when `VITE_MUNUS_API_BASE_URL` or production mode is enabled. Production sessions are never written to localStorage. The local session/profile/preferences adapters remain only for explicit development/test mode, and the optional app-lock PIN remains local by design.

`DATABASE_URL` is server-only. The API enforces ownership from the validated Munus session and parameterized user-scoped queries; the browser never receives database credentials.
