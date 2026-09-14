"use client";
import { useSyncExternalStore } from "react";

const QUERY = "(pointer: coarse)";
const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};
/** True on touch-first devices; false during SSR and on mouse devices. */
export const useCoarsePointer = () => useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
