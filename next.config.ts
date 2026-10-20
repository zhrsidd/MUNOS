import type { NextConfig } from "next";
import { version } from "./package.json";
import { checkProductionTarget, NEVER_SUPABASE_REFS, supabaseRef } from "./lib/platform/target-guard";

// Target-identity guard: a cloud build never points at the PHESMUN production project, and a Vercel Production build must point at
// exactly the project named in EXPECTED_SUPABASE_REF. It fails the build instead of deploying a wrong target.
if (process.env.NEXT_PUBLIC_DATA_BACKEND === "supabase") {
  const ref = supabaseRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (ref && NEVER_SUPABASE_REFS.includes(ref)) throw Error(`Target guard: ${ref} is the PHESMUN production project. Refusing to build against it.`);
  if (process.env.VERCEL_ENV === "production") {
    const target = checkProductionTarget(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env);
    if (!target.ok) throw Error(`Target guard: ${target.reason}. Refusing to build for Production.`);
  }
}

// Build identity is fixed at build time so every screen can say exactly which
// deployment it is running. Vercel provides the VERCEL_* system variables.
const build = {
  NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || version,
  NEXT_PUBLIC_BUILD_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "",
  NEXT_PUBLIC_BUILD_BRANCH: process.env.VERCEL_GIT_COMMIT_REF || "",
  NEXT_PUBLIC_BUILD_ENV: process.env.VERCEL_ENV || (process.env.NODE_ENV === "production" ? "local-build" : "development"),
  NEXT_PUBLIC_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID || "",
  NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
};

const security = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  agentRules: false,
  devIndicators: false,
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  env: build,
  async redirects() {
    return [
      { source: "/chair/awards", destination: "/chair/participation", permanent: false },
      { source: "/admin/awards", destination: "/admin/scoring", permanent: false },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: security },
      // The service worker must always be revalidated so a rollback or emergency fix reaches devices.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      // Submission links are bearer links: never leak them via Referer or search indexing.
      {
        source: "/submit/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      { source: "/amend/:path*", headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Cache-Control", value: "private, no-store" },
      ] },
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};
export default config;
