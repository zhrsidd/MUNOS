"use client";
import { useMemo } from "react";
import { useConference } from "./context";
import { resolutionIdentities, type DelegateSource } from "./resolution-identity";

/** Resolves a resolution to its identity from the delegates this reader's snapshot already holds. */
export function useResolutionIdentities() {
  const { data } = useConference();
  return useMemo(() => resolutionIdentities(data.delegates), [data.delegates]);
}
/** Same lookup for a screen that holds its own delegate list (a committee-filtered view). */
export function useIdentitiesFor(delegates: DelegateSource) {
  return useMemo(() => resolutionIdentities(delegates), [delegates]);
}
