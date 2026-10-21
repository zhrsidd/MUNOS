import { IDENTITY_SEPARATOR, type ResolutionIdentity } from "@/lib/resolution-identity";

/**
 * `GA1/01 — France`, with the code and the country styled apart. The text reads as one string to assistive
 * technology and copies as one string. Long country names wrap (see .resolution-identity in globals.css).
 * Pure markup, so the public amendment page can use it without the staff context.
 */
export function ResolutionName({ identity, className = "" }: { identity: ResolutionIdentity; className?: string }) {
  return (
    <span className={`resolution-identity${className ? ` ${className}` : ""}`}>
      <span className="resolution-identity-code">{identity.code}</span>
      {identity.submitter !== null && (
        <>
          {IDENTITY_SEPARATOR}
          <span className={`resolution-identity-submitter${identity.available ? "" : " unavailable"}`}>{identity.submitter}</span>
        </>
      )}
    </span>
  );
}
