import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { StudioState } from "./store";

export const StudioContext = createContext<StoreApi<StudioState> | null>(null);

export function useStudio<T>(selector: (state: StudioState) => T): T {
  const store = useContext(StudioContext);
  if (!store) throw new Error("StudioContext is missing");
  return useStore(store, selector);
}

/** The store itself, for handlers that read the state when they run (menus). */
export function useStudioApi(): StoreApi<StudioState> {
  const store = useContext(StudioContext);
  if (!store) throw new Error("StudioContext is missing");
  return store;
}

/** Says on the banner that something could not be done; outside Writer (no store), it is only logged. */
export function useFail(): (what: string, e: unknown) => void {
  const store = useContext(StudioContext);
  return (what, e) => (store ? store.getState().fail(what, e) : console.error(what, e));
}
