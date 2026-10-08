"use client";
import { usePathname } from "next/navigation";
import { ConferenceProvider } from "@/lib/context";
/** Public delegate pages (/submit/… and /amend/…) never open the staff workspace, its device storage or a staff session. */
export const isPublicPath = (path: string | null) => !!path && (path.startsWith("/submit/") || path.startsWith("/amend/"));
export function ConferenceShell({ children }: { children: React.ReactNode }) {
  if (isPublicPath(usePathname())) return <>{children}</>;
  return <ConferenceProvider>{children}</ConferenceProvider>;
}
