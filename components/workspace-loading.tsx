"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const subscribeVisibility = (listener: () => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};
const pageVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
const serverVisible = () => true;

/** Initial opening only. Ready workspaces keep their content and use the sync strip for background work. */
export function WorkspaceLoading({ label = "Opening your workspace…" }: { label?: string }) {
  const emblem = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  const visible = useSyncExternalStore(subscribeVisibility, pageVisible, serverVisible);
  useEffect(() => {
    if (!emblem.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(emblem.current);
    return () => observer.disconnect();
  }, []);
  return (
    <main className="workspace-loading" data-motion={visible && inView ? "running" : "paused"}>
      <div ref={emblem} className="workspace-loading-emblem" aria-hidden="true">
        <div className="workspace-loading-plate">
          {/* Serve the original URL: it is already prepared by the offline shell. */}
          <Image src="/dcmun-logo.jpg" alt="" width={112} height={112} unoptimized priority />
        </div>
        <div className="workspace-loading-orbit" />
      </div>
      <h1>DCMUN<span>Conference OS</span></h1>
      <p role="status" aria-live="polite" aria-atomic="true">{label}</p>
    </main>
  );
}
