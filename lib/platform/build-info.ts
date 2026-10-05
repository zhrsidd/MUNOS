// Build identity, fixed when the deployment is built (see next.config.ts).
// Safe to show to any operator: contains no secrets.
export interface BuildInfo {
  version: string;
  commit: string;
  shortCommit: string;
  branch: string;
  environment: string;
  deploymentId: string;
  builtAt: string;
}
export const buildInfo: BuildInfo = {
  version: process.env.NEXT_PUBLIC_APP_VERSION || "development",
  commit: process.env.NEXT_PUBLIC_BUILD_COMMIT || "",
  shortCommit: (process.env.NEXT_PUBLIC_BUILD_COMMIT || "").slice(0, 7),
  branch: process.env.NEXT_PUBLIC_BUILD_BRANCH || "",
  environment: process.env.NEXT_PUBLIC_BUILD_ENV || "development",
  deploymentId: process.env.NEXT_PUBLIC_DEPLOYMENT_ID || "",
  builtAt: process.env.NEXT_PUBLIC_BUILD_TIME || "",
};
/** Human label such as "0.2.0 · a1b2c3d · production". */
export function releaseLabel(info: BuildInfo = buildInfo) {
  return [info.version, info.shortCommit || "local build", info.environment].join(" · ");
}
