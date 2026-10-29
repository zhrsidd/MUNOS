# MUNOS showcase — independent staging site

A standalone marketing site; does not import the DCMUN app, connect to Supabase, register a service worker or require credentials. No deployment configuration has been changed.

```sh
cd showcase
npm ci
npm run dev -- --port 4173
```

Open http://localhost:4173. For a static build: `npm run build`; the output is `showcase/dist/`. Serve with `npm run preview -- --port 4173`. A separate staging host can serve that directory; it must not replace the DCMUN deployment. Staging is marked `noindex, nofollow`.

## Brand system

- Original logo: `public/munos-logo.png`, unchanged from draft PR #75 (`codex/munos-future-branding`, `docs/branding/munos-future/munos-brand-identity.png`). It is distinct from the DCMUN seal.
- Downloadable brand image: `public/munos-brand-sheet.svg`, standalone SVG with embedded original logo.
- Identity: navy `#080e22`, royal blue `#3564f3`, pale blue `#9fbaff`, paper `#f7f8fc`. Tokens scoped to this site in `src/style.css`.
- Type: locally hosted Manrope and DM Sans, reused from the repository; existing SIL Open Font License terms apply.
- Motion: locally bundled Motion. Viewport entrances, finite decorative float, tab transitions, button hover. Reduced-motion preference disables animation, including when changed during the session. All information remains visible with JavaScript disabled.
- Contacts and credits mirror `lib/brand.ts`; email provided by owner. Custom builds are paid and quoted by scope. No invented pricing or customer claims.
- UI previews use fictional examples and do not promise that every custom build includes every feature.

## Browser verification

After `npm ci`, install Chromium with `npx playwright install chromium`, run the dev server on port 4173, and run `npx playwright test`. Tests cover navigation, contact, keyboard-operated workspaces, mobile overflow, no-JS visibility and reduced motion. Screenshots are written to ignored `test-results/`.

## GitHub Pages

The static build is published on the repository's `gh-pages` branch. Enable it in **Settings → Pages → Build and deployment → Deploy from a branch → gh-pages → / (root) → Save**. Expected URL: https://zhrsidd.github.io/MUNOS/ . The repository is private; GitHub Pages eligibility depends on the owner's GitHub plan. Do not change repository visibility to enable hosting.

The session integration received HTTP 403 for both reading Pages settings and creating the site, so activation requires an owner with Pages settings access. No live URL is claimed until Pages is enabled and checked.

To update the site, build this folder and publish only `dist/` to `gh-pages`. Never publish the conference app or `.env` files. The branch includes `.nojekyll` for static file serving.
