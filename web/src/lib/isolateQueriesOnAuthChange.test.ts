import { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { strict as assert } from "node:assert";

import { isolateQueriesOnAuthChange } from "./isolateQueriesOnAuthChange.ts";

type AuthState = {
  token: string | null;
  setToken: (token: string | null) => void;
};

const useAuthStore = create<AuthState>((set) => ({
  token: "alice-token",
  setToken: (token) => set({ token }),
}));

const queryClient = new QueryClient();
const listingKey = ["filesystem", "list", "root"] as const;
const sharesKey = ["files", "shares", "alice-file"] as const;

queryClient.setQueryData(listingKey, {
  files: [{ id: "alice-file", original_filename: "secrets.pdf" }],
});
queryClient.setQueryData(sharesKey, [{ token: "alice-share-token" }]);

isolateQueriesOnAuthChange(
  queryClient,
  () => useAuthStore.getState().token,
  (listener) => useAuthStore.subscribe((state) => listener(state.token))
);

assert.equal(
  (queryClient.getQueryData(listingKey) as { files: { id: string }[] }).files[0]?.id,
  "alice-file"
);

useAuthStore.getState().setToken("alice-token");
assert.ok(queryClient.getQueryData(listingKey), "same token must keep cache");

useAuthStore.getState().setToken(null);
assert.equal(queryClient.getQueryData(listingKey), undefined);
assert.equal(queryClient.getQueryData(sharesKey), undefined);

queryClient.setQueryData(listingKey, { files: [{ id: "should-not-leak" }] });
useAuthStore.getState().setToken("bob-token");
assert.equal(
  queryClient.getQueryData(listingKey),
  undefined,
  "login as another user must drop the previous session cache"
);

console.log("isolateQueriesOnAuthChange: ok");
