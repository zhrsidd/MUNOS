"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import type { StaffAccess } from "../lib/access";
import type { Committee } from "../lib/domain";
import { readLoadingCommittee } from "../lib/loading-screen";
import { DurableStore } from "../lib/sync/store";
import { WorkspaceLoading } from "./workspace-loading";

const store = new DurableStore();
const subscribeVisibility = (listener: () => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};
const pageVisible = () => document.visibilityState !== "hidden";
const serverVisible = () => true;

/** Artwork is requested only after a verified Chair's cached committee opted in. */
export function CommitteeWorkspaceLoading({ access }: { access: StaffAccess }) {
  const pathname = usePathname();
  if (pathname !== "/chair" && !pathname.startsWith("/chair/")) return <WorkspaceLoading />;
  // Route changes remount the selection: returning to a route must re-read its current setting.
  return <CachedCommitteeLoading key={pathname} access={access} />;
}

function CachedCommitteeLoading({ access }: { access: StaffAccess }) {
  const [cached, setCached] = useState<{ access: StaffAccess; committee: Committee | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readLoadingCommittee(store, process.env.NEXT_PUBLIC_CONFERENCE_ID, access).then(committee => {
      if (!cancelled) setCached({ access, committee });
    });
    return () => { cancelled = true; };
  }, [access]);
  if (!cached || cached.access !== access || !cached.committee) return <WorkspaceLoading />;
  return <AlternativeLoadingScreen committeeCode={cached.committee.code} />;
}

/** Also used by the Executive's explicit preview; it never controls readiness. */
export function AlternativeLoadingScreen({ committeeCode }: { committeeCode: string }) {
  const [failed, setFailed] = useState(false);
  const visible = useSyncExternalStore(subscribeVisibility, pageVisible, serverVisible);
  if (failed) return <WorkspaceLoading />;
  return (
    <section className="committee-loading" data-motion={visible ? "running" : "paused"} aria-label={`${committeeCode} workspace loading`}>
      <Image className="committee-loading-art" src="/loading/committee-collage-v1.webp" alt="" fill unoptimized onError={() => setFailed(true)} />
      <div className="committee-loading-heading"><strong>DCMUN OS</strong><span>{committeeCode}</span></div>
      <span className="committee-loading-tag">COMMITTEE IN SESSION</span>
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
