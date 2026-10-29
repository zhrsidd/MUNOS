# MUNOS Showcase Implementation Plan

**Goal:** Separate cinematic marketing and brand presentation for paid custom MUN systems.
**Architecture:** Standalone Vite static site in showcase; Motion bundled locally. No conference application edits.
**Tech Stack:** HTML, CSS, JavaScript, Vite, Motion.
**Spec:** docs/superpowers/specs/2026-10-29-munos-showcase-design.md

## Constraints
Preserve draft logo unchanged; true repository feature copy; no invented pricing or testimonials; separate branding and runtime; reduced motion.

## Review focus
Mobile overflow; keyboard tab interaction; no-script content visibility; motion preference changes; accurate contact links.

## Tasks
- [x] 1. Add standalone package, original brand asset and brand-sheet SVG, responsive static content and documented design tokens.
- [x] 2. Add Motion entrances and interactive workflow tabs with keyboard access and reduced motion.
- [x] 3. Build standalone site, browser-check mobile/desktop, contact/links/tabs/reduced motion; run repository typecheck, lint, tests and build. Record limitations.

Execution: inline in existing task branch `work`. This is reversible marketing UI: verify through browser flows rather than implementation-mirroring unit tests. No deployment or PR creation.

Verification evidence and limitations: showcase/VERIFICATION.md. User additionally authorised GitHub Pages publication; static branch pushed, activation blocked by integration Pages permission.
