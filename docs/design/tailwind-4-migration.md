# Migrating the web app to Tailwind CSS 4 (done)

| | |
|---|---|
| **Status** | Done: Tailwind 4.3.3 via `@tailwindcss/vite`, CSS-first config in `apps/web/src/index.css` |
| **Why a plan and not a change** | It touches every component's styling and the build pipeline, and the benefit is mostly build-time. It should be its own PR with visual comparison, not mixed into feature work. |
| **Related** | `apps/web/src/index.css`, `apps/web/vite.config.ts` (`tailwind.config.ts` and `postcss.config.js` were removed) |

## Outcome

- `npm audit` (full tree) went from 8 advisories (5 high) to 0; the dev-only row is gone from KNOWN_ISSUES.
- Tokens stay as bare `H S% L%` triples in `:root` / `.light`; `@theme` maps them to `--color-*`, so `theme.test.ts` is unchanged.
- `tailwindcss-animate` is replaced by `tw-animate-css`; the unused `@tailwindcss/typography`, `autoprefixer` and `postcss` dependencies are removed.
- Custom classes in `index.css` are `@utility` blocks, so only the ones used in `src/` are emitted (as with Tailwind 3's purge).
- Renames applied: `bg-gradient-*` to `bg-linear-*`, `flex-shrink-0` to `shrink-0`, `outline-none` to `outline-hidden`, `shadow-sm` to `shadow-xs`, `backdrop-blur[-sm]` one step down the scale, `data-[x]` to `data-x`, `var(--x)` arbitrary values to `(--x)`. `rounded-sm/md/lg` keep the shadcn radius scale defined in `@theme`.
- Known deltas: the built CSS is about 4 kB larger gzipped (about 16.5 kB to 20.9 kB) because Tailwind 4 emits `@property` registrations and `color-mix()` fallbacks for every opacity modifier; the default palette (`red-500`, `cyan-400`, ...) is now OKLCH, so those few colours shift slightly; buttons get an explicit `cursor: pointer` rule because Tailwind 4 stopped doing it.
- The screenshot comparison in step 1 and 7 below was not done by a human; the Playwright smoke suite, contrast tests and a before/after diff of the compiled class list were used instead. Eyeball the app in both themes before release.

## Why (original plan)

- The Tailwind 3 toolchain pulls in dev-only packages that carry advisories (`braces`, `micromatch`, `chokidar`, `postcss-selector-parser`). They never reach production, but they show up in `npm audit` for the whole tree.
- Tailwind 4 ships a faster engine, configures through CSS, and removes the PostCSS plugin chain we maintain by hand.
- The theme tokens (`--background`, `--primary`, `--class-*`, the new `.light` block) already live in CSS, so the move is mostly mechanical.

## Current state (what has to move)

| Piece | Where | Tailwind 4 equivalent |
|---|---|---|
| Colours mapped to CSS variables (`hsl(var(--primary))`) | `tailwind.config.ts` `theme.extend.colors` | `@theme` in `index.css` |
| `darkMode: ["class"]` | `tailwind.config.ts` | `@custom-variant dark (&:where(.dark, .dark *));` |
| `tailwindcss-animate` | plugin | `tw-animate-css` (or keep via `@plugin` if compatible) |
| `@tailwind base/components/utilities` | `index.css` | `@import "tailwindcss";` |
| Custom utilities in `@layer utilities` (glow, gradients) | `index.css` | `@utility` definitions |
| Font families (`Rajdhani`, `Inter`) | `tailwind.config.ts` | `@theme { --font-heading: ... }` |
| `autoprefixer` + `postcss` | `postcss.config.js` | built in; use `@tailwindcss/vite` |

## Steps

1. **Freeze visuals.** Capture reference screenshots of every page in both themes at 375, 768 and 1280 px from a seeded database (the repo's smoke harness: a scratch MariaDB, `NODE_ENV=development`, a seeded session cookie). Store them outside the repo or in a PR comment.
2. Run the official upgrade tool on a branch: `npx @tailwindcss/upgrade`. Review its diff instead of trusting it; it rewrites class names that changed.
3. Replace the PostCSS setup with the `@tailwindcss/vite` plugin in `vite.config.ts`.
4. Move colours, fonts and the `dark` variant into CSS (`@theme`, `@custom-variant`). Keep the token names the same, so `theme.test.ts` (WCAG contrast) keeps working unchanged. It reads `index.css` directly.
5. Port the custom utilities and the animation plugin.
6. Fix renamed or removed utilities. The ones most likely to bite this codebase: `shadow-sm/shadow/rounded` scale shifts, `outline-none` → `outline-hidden`, `ring` default width and colour, `bg-gradient-*` → `bg-linear-*`, the default border colour now being `currentColor`, and opacity modifiers on CSS-variable colours (check `bg-primary/20`).
7. Compare against the step-1 screenshots; investigate every difference. Check focus rings (the global `:focus-visible` rule), the Sheet and Dialog animations, and the dark/light toggle.
8. Run the full gate: `npm run lint`, `typecheck`, `test` (including the contrast tests), `build`, and compare bundle CSS size.
9. Re-run `npm audit` and delete the "dev-only advisories" row from KNOWN_ISSUES.

## Browser support

Tailwind 4 requires modern browsers (Safari 16.4+, Chrome 111+, Firefox 128+) because it uses `@property` and `color-mix()`. The app's audience (Discord users) is on current browsers, but confirm against your own analytics before merging.

## Rollback

The change is confined to the web package's styling and build files. Reverting the PR restores Tailwind 3; no data or API changes are involved.

## Definition of done

- Screenshots match in both themes at all three widths (or every difference is deliberate and noted).
- The contrast tests pass untouched.
- `npm audit` no longer lists the Tailwind dev advisories.
- Production build is no larger than before.
