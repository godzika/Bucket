import { QueryClient } from "@tanstack/react-query";

import { useAuthStore } from "./auth-store";
import { isolateQueriesOnAuthChange } from "./isolateQueriesOnAuthChange";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * Drop cached listings/file/share queries as soon as the auth token changes.
 *
 * Query keys are not user-scoped, and `staleTime: 30s` plus SPA login/logout
 * (no full reload) would otherwise keep the previous account's filesystem
 * listing and share tokens visible to the next user.
 */
isolateQueriesOnAuthChange(
  queryClient,
  () => useAuthStore.getState().token,
  (listener) => useAuthStore.subscribe((state) => listener(state.token))
);
