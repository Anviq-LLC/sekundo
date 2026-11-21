# Phone-width layout

The web app is used on phones, in the browser and as an installed page, until there is a store app.
Every screen has to work at 390 pixels wide. This page is the rule and how it is held.

## Rules

- **Side padding.** Dialog and overlay bodies use `px-4 sm:px-8`, never a fixed `px-8`. The dialog
  itself is already capped to the screen width.
- **Headers wrap.** A dialog header with several actions uses `flex-wrap`, so the close button stays
  on screen instead of pushing out of it.
- **No side by side below `md`.** A list beside a viewer shows only the viewer on a phone, and a row
  of statistics stacks (`grid-cols-1 sm:grid-cols-3`).
- **No fixed pixel widths** on content. A fixed width is for a panel that is hidden below `md`.

## Where it is held

`apps/web/e2e/settings/plugin-marketplace.spec.ts` opens Integrations at 390 pixels and fails when the
close button leaves the screen. New overlays add the same check to their own spec.

## Screens fixed so far

Integrations, bot templates, skills, usage statistics and the artifact viewer.
