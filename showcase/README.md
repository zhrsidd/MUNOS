# MUNOS showcase — independent staging site

A standalone marketing site; does not import the DCMUN app, connect to Supabase, register a service worker or require credentials. No deployment configuration has been changed.

```sh
cd showcase
npm ci
npm run dev -- --port 4173
```

Open http://localhost:4173. For a static build: `npm run build`; the output is `showcase/dist/`. Serve with `npm run preview -- --port 4173`. A separate staging host can serve that directory; it must not replace the DCMUN deployment. Staging is marked `noindex, nofollow`.

## Brand system

- Logo: public/munos-logo.svg and transparent PNG export, with the simplified marine column and cyan laurel icon. Public/munos-symbol.svg and favicon.svg share identical geometry. This replaces the old gradient badge from draft PR #75 and is distinct from the DCMUN seal.
- Downloadable brand images: public/munos-brand-sheet.svg and .png. SVG uses vector shapes and outlined lettering throughout; no embedded raster image or external font dependency.
- Identity: UN-inspired cyan `#009EDB`, marine ink `#062B42`, action blue `#00689D`, ice `#E4F3FA` and white. Flat colour surfaces, crisp rules, cartographic line globe; no generated gradients or glow. See BRAND.md for colour roles. Tokens scoped to this site in src/style.css.
- Type: self-hosted Fraunces (display headings, with a true italic) and Space Grotesk (body/interface). Downloaded from Google Fonts; font-specific SIL Open Font License notices are included in public/. The logo and brand-sheet wordmarks use outlined Space Grotesk, so they do not depend on locally installed fonts.
- Motion: locally bundled Motion. Viewport entrances, finite decorative float, tab transitions, button hover, hero parallax and a scroll-linked pinned resolution workflow on wide/tall screens. Reduced-motion preference disables animation, including when changed during the session. All information remains visible with JavaScript disabled.
- Contacts and credits mirror `lib/brand.ts`; email provided by owner. Custom builds are paid and quoted by scope. No invented pricing or customer claims.
- UI previews use fictional examples and do not promise that every custom build includes every feature.

## Browser verification

After `npm ci`, install Chromium with `npx playwright install chromium`, run the dev server on port 4173, and run `npx playwright test`. Tests cover navigation, contact, keyboard-operated workspaces, mobile overflow, no-JS visibility and reduced motion. Screenshots are written to ignored `test-results/`.

## Cloudflare Pages — recommended deployment

Connect the private GitHub repository to Cloudflare Pages. Select the branch `codex/munos-showcase` (this work has not been merged into main), and configure:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Root directory | `showcase` |
| Build command | `npm run build` |
| Build output directory | `dist` |

No environment variables, database credentials or server functions are required. The site stays public while the Git repository remains private. For drag-and-drop deployment, build locally and upload only `showcase/dist/`. When the source is merged, change the deployment branch to main.

Reference: https://developers.cloudflare.com/pages/configuration/build-configuration/

The site still carries staging `noindex, nofollow` metadata. Remove that tag in index.html when ready for search indexing. Do not deploy the repository root, which is the separate DCMUN application.

## Previous GitHub Pages preparation

An earlier static snapshot was pushed to gh-pages. Pages activation was blocked by HTTP 403 and the site was never enabled. That branch is not the deployment source for Cloudflare and is not updated by this change.

## Conference references

The compact conference-history section names DCMUN XVIII and PHESMUN X as requested by the owner. Conference logos retain their original artwork/colours and identify their respective conferences. DCMUN seal copied unchanged from this repository's public/dcmun-logo.jpg. PHESMUN seal copied unchanged from zhrsidd/PHESMUNOS, public/phesmun-logo.png, main commit 73e337e62cecb870e906500cbe12779ec12c4c80. Copies are served locally from public/conferences; no GitHub authentication or hotlink is needed by visitors.

## Link previews

Static Open Graph and Twitter Card tags in index.html point to https://munos.pages.dev/ and its public 1200×630 social-preview.png. Bots can read these tags without JavaScript or authentication. The generated PNG is committed, so deployment builds need no browser. To regenerate it after a logo update: install Chromium with `npx playwright install chromium`, then run `node scripts/render-social-image.mjs` from showcase/.

If you add a custom domain, update canonical, og:url and the absolute Open Graph/Twitter image URLs together. Staging noindex metadata is independent of the robots.txt crawl allowance. After deployment, refresh LinkedIn's cached preview at https://www.linkedin.com/post-inspector/ and then add the link again.
