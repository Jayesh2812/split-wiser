import { useSyncExternalStore } from "react";
import { getState, subscribe } from "../lib/store";
import type { AppState } from "../types";

/** Subscribe a component to the whole app state. Re-renders on any commit. */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}
