"use client";
import { usePathname } from "next/navigation";
import { ConferenceProvider } from "@/lib/context";
/** Public pages (/submit/…, /amend/… and /about) never open the staff workspace, its device storage or a staff session. */
export const isPublicPath = (path: string | null) => !!path && (path.startsWith("/submit/") || path.startsWith("/amend/") || path === "/about");
export function ConferenceShell({ children }: { children: React.ReactNode }) {
  if (isPublicPath(usePathname())) return <>{children}</>;
  return <ConferenceProvider>{children}</ConferenceProvider>;
}
