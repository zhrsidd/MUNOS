import type { Role } from "./domain";

/** One route inside a workspace: "" is the workspace home. Routes never change; only where they are reached from does. */
export interface Destination {
  slug: string;
  label: string;
}
/** A top-level entry: a direct link (slug) or a menu of destinations (children). */
export interface NavItem {
  label: string;
  slug?: string;
  children?: Destination[];
}
const health: Destination = { slug: "health", label: "System health" };

/**
 * Destination map (docs/UI_OVERHAUL.md). Everyday work is a direct link; setup and rare tools sit in a menu.
 * Chair keeps Amendments and Voting as direct links: they are used live during debate, so they must not be
 * one menu deeper than before.
 */
export function navigationFor(role: Role): NavItem[] {
  switch (role) {
    case "chair":
      return [
        { label: "Debate", slug: "" },
        { label: "Roll call", slug: "roll-call" },
        { label: "Resolutions", slug: "documents" },
        { label: "Amendments", slug: "amendments" },
        { label: "Participation", slug: "participation" },
        { label: "Voting", slug: "voting" },
        { label: "More", children: [{ slug: "photos", label: "Group photos" }, health] },
      ];
    case "approval":
      return [
        { label: "Review inbox", slug: "" },
        { label: "History", slug: "history" },
        { label: "More", children: [health] },
      ];
    case "logistics":
      return [
        { label: "Print queue", slug: "" },
        { label: "Completed", slug: "completed" },
        { label: "More", children: [health] },
      ];
    case "admin":
      return [
        { label: "Overview", slug: "" },
        { label: "Programme", children: [{ slug: "conference", label: "Conference" }, { slug: "sessions", label: "Sessions" }, { slug: "photos", label: "Group photos" }] },
        {
          label: "People",
          children: [{ slug: "committees", label: "Committees" }, { slug: "delegates", label: "Delegates" }, { slug: "schools", label: "Schools" }, { slug: "staff", label: "Chairs & staff" }, { slug: "access-codes", label: "Access codes" }],
        },
        {
          label: "Operations",
          children: [{ slug: "submissions", label: "Resolution links" }, { slug: "amendment-links", label: "Amendment links" }, { slug: "scoring", label: "Scoring" }, { slug: "workflow", label: "Workflow & features" }],
        },
        { label: "More", children: [{ slug: "audit", label: "Audit log" }, health] },
      ];
  }
}
/** Every route a role can reach from the navigation. */
export const destinationSlugs = (role: Role) => navigationFor(role).flatMap((i) => (i.children ? i.children.map((c) => c.slug) : [i.slug!]));
/** The entry that contains the current section, for the active marker. */
export const activeEntry = (items: NavItem[], section: string) => items.find((i) => (i.children ? i.children.some((c) => c.slug === section) : i.slug === section));
