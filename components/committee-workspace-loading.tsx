"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";

import {ChairOpening, type OpeningInput} from "../lib/chair-opening";
import { WorkspaceLoading } from "./workspace-loading";

const subscribeVisibility = (listener: () => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};
const pageVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
const serverVisible = () => true;

// Module lifetime is the page opening, so routing/provider remounts cannot restart the introduction.
const opening = new ChairOpening();

export function useChairOpening({access, health, data, pathname, committeeId, selectionReady}: OpeningInput) {
 const state = useSyncExternalStore(opening.subscribe, opening.getSnapshot, opening.getSnapshot);
 useEffect(() => {opening.update({access,health,data,pathname,committeeId,selectionReady});}, [access, health, data, pathname, committeeId, selectionReady]);
 // Check current access/recovery synchronously too: an effect must never flash stale authorized artwork.
 return typeof document !== "undefined" && opening.canPresent({access,health,data,pathname,committeeId,selectionReady}) && state.phase !== 'done' ? state : null;
}

export function CommitteeWorkspaceLoading({ ready }: { ready: boolean }) {
 const state = useSyncExternalStore(opening.subscribe, opening.getSnapshot, opening.getSnapshot);
 const visible = useSyncExternalStore(subscribeVisibility, pageVisible, serverVisible);
 useEffect(() => {
  if (!visible) {opening.hidden(); return;}
  if (state.phase !== 'showing') return;
  // Wait for the decoded image's visible DOM to paint, not authorization, cache lookup or image request time.
  let second = 0;
  const first = requestAnimationFrame(() => {second = requestAnimationFrame(opening.presented);});
  return () => {cancelAnimationFrame(first);cancelAnimationFrame(second);opening.hidden();};
 }, [state.phase, visible]);
 if (!state.committee || (state.phase !== 'artwork' && state.phase !== 'showing')) return <WorkspaceLoading />;
 return <>
  {state.phase === 'artwork' && <WorkspaceLoading />}
  <div hidden={state.phase === 'artwork'}>
   <AlternativeLoadingScreen committeeCode={state.committee.code} onArtworkReady={opening.artworkReady} onArtworkFailed={opening.artworkFailed} onSkip={ready && state.phase === 'showing' ? opening.skip : undefined} />
  </div>
 </>;
}

/** Also used by the Executive's explicit preview; it never controls readiness. */
export function AlternativeLoadingScreen({ committeeCode, onArtworkReady, onArtworkFailed, onSkip }: { committeeCode: string; onArtworkReady?: () => void; onArtworkFailed?: () => void; onSkip?: () => void }) {
  const [failed, setFailed] = useState(false);
  const visible = useSyncExternalStore(subscribeVisibility, pageVisible, serverVisible);
  if (failed) return <WorkspaceLoading />;
  return (
    <section className="committee-loading" data-motion={visible ? "running" : "paused"} aria-label={`${committeeCode} workspace loading`}>
      <div className="committee-loading-header">
        <div className="committee-loading-heading"><strong>MUNOS</strong><span>{committeeCode}</span></div>
        <div className="committee-loading-controls"><span className="committee-loading-tag">COMMITTEE IN SESSION</span>{onSkip && <button type="button" className="committee-loading-skip" onClick={onSkip}>Enter workspace</button>}</div>
      </div>
      <div className="committee-loading-scene">
        <Image className="committee-loading-art" src="/loading/committee-collage-v1.webp" alt="" fill unoptimized loading="eager" onLoad={() => onArtworkReady?.()} onError={() => {setFailed(true);onArtworkFailed?.();}} />
      </div>
      <div className="committee-loading-bottom">
        <div className="committee-loading-label" role="status" aria-label="Opening your workspace">
          <span className="sr-only">Opening your workspace</span>
          <span aria-hidden="true">Establishing quorum<span className="committee-loading-dots"><span>.</span><span>.</span><span>.</span></span></span>
        </div>
        <aside className="committee-loading-tip"><span>DELEGATE SURVIVAL TIP</span><p>A point of information is not a podcast.</p></aside>
      </div>
    </section>
  );
}
