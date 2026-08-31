/** Clear React Query cache when the auth token switches accounts. */

export function isolateQueriesOnAuthChange(
  queryClient: { clear: () => void },
  getToken: () => string | null,
  subscribe: (listener: (token: string | null) => void) => () => void
): () => void {
  let lastAuthToken = getToken();
  return subscribe((token) => {
    if (token !== lastAuthToken) {
      lastAuthToken = token;
      queryClient.clear();
    }
  });
}
