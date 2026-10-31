// Conference identity (DCMUN) and platform identity (MUNOS) are deliberately separate (docs/BRAND.md §1).
// Visible credits read from here; internal identifiers (cache names, storage keys, RPC names) do not.
export const BRAND = {
  conference: "DCMUN",
  conferenceName: "Doha College Model United Nations",
  product: "MUNOS",
  logo: "/dcmun-logo.jpg",
  logoAlt: "DCMUN — Doha College Model United Nations seal",
} as const;
// Ported from PHESMUN PR #1 with the same creator, contributor and licence wording.
export const PLATFORM = {
  name: "MUNOS",
  fullName: "Model United Nations Conference Management System",
  creator: "Zuhayr Siddique",
  creatorUrl: "https://www.linkedin.com/in/zhrsidd/",
  copyright: "Copyright © 2026 Zuhayr Siddique. All rights reserved.",
  contributors: [{ name: "John Paul Ribeiru", role: "Development Contributor", url: "https://www.linkedin.com/in/john-paul-ribeiru-797b2442b" }],
} as const;
