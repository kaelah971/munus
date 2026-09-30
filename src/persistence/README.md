# Persistence boundary

The current browser adapter stores only local development session/profile/preferences data in localStorage. `RemoteProfileApi` defines the authenticated profile boundary for production; the server derives the user from an HttpOnly session. Production sessions are intended to use the backend boundary with Supabase-owned rows protected by RLS. No service-role secret belongs in this Vite client.
