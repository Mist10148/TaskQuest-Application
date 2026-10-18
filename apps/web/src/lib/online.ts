import { useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

const snapshot = () => navigator.onLine;
const serverSnapshot = () => true;

/** Whether the browser thinks it is online (a best-effort hint: `true` does not prove the server is reachable). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** What to tell the person when a request fails before it reaches the server. */
export const OFFLINE_MESSAGE = "You appear to be offline. Check your connection and try again.";

/** True for the TypeError `fetch` throws when the network request itself failed (offline, DNS, refused). */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}
