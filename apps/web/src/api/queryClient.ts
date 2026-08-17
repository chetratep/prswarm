import { QueryClient } from "@tanstack/react-query";

// Single shared QueryClient instance. Exported (rather than only constructed
// in main.tsx) so the low-level fetch wrapper in client.ts can reach into the
// cache and flip the cached session status when a request comes back 401 —
// that's how a mid-session credential expiry gets the whole app back to the
// login gate without every page having to know about auth.
export const queryClient = new QueryClient();
