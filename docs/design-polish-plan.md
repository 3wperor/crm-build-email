# YCAReach design polish plan

**Goal:** make YCAReach look and feel like a deliberately designed product, not a stock template, while keeping it **simple and calm** (the owner likes the current simplicity). Nothing here changes what the app does, only how it looks, reads and responds.

**Audience:** an AI coding agent working in this repo. Do the phases in order. Show the owner screenshots at the end of each phase, and pause for approval before starting the next.

---

## 0. Ground rules (read first)

- **Ask the owner before adding any dependency.** The ones this plan expects are listed in [Dependencies to approve](#dependencies-to-approve). Don't add anything else without asking.
- **Behaviour must not change.** Keep every server action, route, permission check and `data-testid` attribute. Before finishing each phase, all of these must pass:
  - `pnpm -r test`
  - `pnpm --filter @crm/web exec tsc --noEmit`
  - `pnpm --filter @crm/web lint`
  - `pnpm --filter @crm/web build`
- **Do not add an app-wide `loading.tsx`.** In Next 15 it stopped the URL from updating after server actions that call `redirect()`, which was a real bug here. Use `<Suspense>` with skeletons *inside* pages instead. If you do add a section-level `loading.tsx`, check that every form in that section still redirects correctly.
- **Keep navigation fast.** `components/nav.tsx` loads pages in advance on hover, and `next.config.ts` sets `staleTimes`. Don't undo either.
- **Keep it restrained:**
  - one accent colour
  - one font family (two at most)
  - no gradients on app screens
  - no emoji in the interface
  - no stock illustrations
  - motion only where it helps
- **Mind the plain-English audience.** Many users aren't technical. Visible text must be understandable without email or tech jargon.
- **Verify by looking.** Screenshot every route at 1280px and 390px wide, in light and dark mode, before and after (see [Phase 10](#phase-10--qa-and-sign-off)).

## Decisions the owner should make first

Ask these up front. Offer a recommendation for each.

1. **Brand colour.** One accent colour, used for primary buttons, links, focus rings and the logo. Recommend a confident blue or teal that stays readable on white and dark backgrounds. Show 3 options as swatches on a real button and badge.
2. **Logo.** Either a simple wordmark plus a small mark that works at 16px (favicon), or an existing logo from the owner.
3. **Font.** Recommend **Inter** (or Geist) for everything, loaded with `next/font`, which is built in and needs no new dependency. Use tabular numbers in tables and stats.
4. **Dark mode.** Keep following the device setting (current behaviour), or add a toggle in the user menu.
5. **Approve the dependencies** listed below.

## Dependencies to approve

| Package | Why | Alternative if declined |
|---|---|---|
| `sonner` | Toast notifications ("Saved", "Sent to ada@…") instead of small inline text | Build a minimal toast with React context and `aria-live` |
| `@radix-ui/react-dialog` | Accessible confirm dialogs and the mobile menu (replaces 7 `window.confirm()` calls) | Native `<dialog>` element with a small wrapper |
| `@radix-ui/react-dropdown-menu` | Row actions ("⋯") and the user menu | Native `<details>` popovers |
| `@radix-ui/react-select`, `@radix-ui/react-switch`, `@radix-ui/react-checkbox`, `@radix-ui/react-radio-group`, `@radix-ui/react-tooltip` | Styled, accessible form controls and tooltips (17 files use native `<select>`) | Restyle the native controls with CSS (`appearance-none`, `accent-color`) |

These are the shadcn/ui building blocks the project already follows (`components/ui/*` came from shadcn). Pin exact versions, as the rest of `package.json` does.

---

## Phase 1: Brand foundation

**Why:** the stock shadcn grey palette, the system font and the text-only logo are the biggest giveaways.

- **Design tokens** (`apps/web/src/app/globals.css`):
  - Set `--primary`, `--ring` and `--sidebar-primary` to the brand colour, with a light tint (`--accent`) for selected states. Define both light and dark values.
  - Add semantic tokens and use them everywhere instead of ad-hoc Tailwind colours. Today there are many `text-emerald-600`, `bg-amber-500/10` and `text-destructive` scattered around.
    - `--success`, `--warning`, `--info`, each with a matching `-foreground` and a subtle background.
  - Add a type scale (page title, section title, body, small, caption) and two or three shadow levels.
  - Keep `--radius` but use it consistently.
  - Check that every text/background pair meets WCAG AA contrast, in both themes.
- **Font:** load it with `next/font` in `app/layout.tsx`, and set `--font-sans`. Add `font-variant-numeric: tabular-nums` to tables and stat figures.
- **Logo:**
  - `components/brand/logo.tsx`: an SVG mark plus wordmark, in full and icon-only versions. Replace the four hand-written `YCA<span>Reach</span>` wordmarks in the sidebar, welcome, docs and public header.
  - App icons: `app/icon.svg`, `app/apple-icon.png`, and an `app/opengraph-image.tsx` (social share card) for the homepage.
- **Page metadata:** a proper `description`, plus `themeColor`.

**Done when:** the brand colour appears on primary actions across the app; there's a favicon in the browser tab; and nothing still uses the stock grey-on-black `--primary`.

## Phase 2: App shell and navigation

Files: `app/(app)/layout.tsx`, `components/nav.tsx`.

- **Mobile navigation (currently missing).** On phones the sidebar is hidden and nothing replaces it. Add a top bar with a menu button that opens the nav in a slide-out drawer (Dialog), and close it on navigation.
- **Group the sidebar** (11 flat items today):
  - **Outreach:** Campaigns, Leads, Inboxes
  - **Conversations:** Replies (with the count badge), Pipeline
  - **Insights:** Analytics
  - **Deliverability:** Warmup, Suppression
  - Pinned to the bottom: Settings, Docs, and a user menu (avatar initials, name, email, role, workspace switcher, sign out).
- **Calm the header:**
  - Keep the plan badge.
  - Move "Agent: draft-only" into Settings → Claude & MCP; it's jargon in the header.
  - Turn the "Sending live" badge and kill switch into one clear control: a status pill ("Sending on") that opens a small menu with "Pause all sending".
- **Banners** (billing, sending paused): one shared `Banner` component using the semantic tokens, with an icon and an optional action.
- **Page headers:** move `PageHeader` out of `components/coming-soon.tsx` into `components/page-header.tsx`, and delete the leftover "coming soon" component. Every page gets the same header: title, a one-line description, and actions on the right. Add breadcrumbs on detail pages (Campaigns → Campaign name).

**Done when:**
- Every page can be reached on a 390px-wide screen.
- The sidebar is grouped.
- The header shows at most three things.

## Phase 3: Component consistency

Build each in `components/ui/` once, then replace every one-off version.

- **Dialog / ConfirmDialog:** replace all 7 `window.confirm()` calls (`grep -rn "confirm(" apps/web/src`). Destructive actions get a red confirm button that names the action ("Delete campaign"). The reply composer's "still has [placeholders]" warning becomes a dialog that lists them.
- **Toasts:** replace inline success text with toasts. That's `state.message` rendered as `text-emerald-600`, such as "Saved." or "Sent to …". Keep error messages next to the field or form, where people are looking.
- **Form controls:**
  - A `Textarea` component (the same textarea class string is copy-pasted in 3 files, with other variations elsewhere).
  - `Select`, `Checkbox`, `Switch` (use for on/off settings like "Draft answers to new replies"), and `RadioGroup` (welcome flow, own-key provider).
  - A `Field` wrapper: label, control, hint and error, laid out the same way everywhere.
- **Buttons:** a loading state with a spinner (today the label just changes to "Saving…"); icon buttons always have tooltips.
- **EmptyState:** an icon, a one-line explanation and one primary action. Replace the 8 dashed-border "No … yet" cards.
- **Skeletons:** for tables, stat cards and the reply thread, used inside `<Suspense>` boundaries.
- **DropdownMenu:** row actions in tables (delete, pause, and so on) instead of scattered buttons.
- **Badge variants** mapped to meaning (success / warning / danger / info / neutral), not to colours.

**Done when:** there's no `window.confirm`, no copy-pasted control class strings, no dashed-card empty states, and every save shows the same toast.

## Phase 4: Data presentation

- **One formatting module** (`lib/format.ts`), used everywhere:
  - `formatDate`: relative times for recent events ("2 hours ago"), with the exact time in a tooltip. Use the workspace timezone (`organizations.default_timezone`) and the `en-GB` locale. This replaces the 36 raw `toLocaleString()` calls, which currently format differently depending on the server's settings.
  - `formatNumber`, `formatPercent`, `formatGBP`.
  - `plural(n, "email")` → "1 email" / "3 emails".
- **Status labels:** one map from internal values to friendly labels and badge variants. Replace the 9 `replace(/_/g, " ")` calls and any uppercase raw values. For example:

  | Internal value | Shown as |
  |---|---|
  | `out_of_office` | Out of office |
  | `classification_source` "HEURISTIC" / "AI" | Sorted automatically / Sorted by AI (or hidden) |
  | `pending_approval` | Waiting for approval |
  | lead `status` and campaign `status` values | Similarly friendly labels |

- **Tables:**
  - Consistent padding, a sticky header, row hover, numbers aligned right.
  - Long text truncated, with the full text in a tooltip.
  - Pagination ("Showing 1–50 of 1,240") where lists are capped today: replies are capped at 100, and several lists use `.limit()`.
  - On phones, tables either scroll inside their card or turn into stacked cards.
- **Charts** (`components/charts`): use the brand colour plus the existing `--viz-*` slots, with consistent axes, tooltips and empty states.

## Phase 5: Words (copy and tone)

- **One voice:** friendly, plain, short. Use sentence case for all titles and buttons. Buttons are verbs ("Add inbox", "Start campaign").
- **Glossary.** Use the same word everywhere, and keep technical terms in "Advanced" sections:

  | Instead of | Say |
  |---|---|
  | Kill switch | Pause all sending |
  | SMTP / IMAP (in main flows) | Sending / receiving settings (technical details under "Advanced") |
  | Classification | Reply type |
  | MCP / agent | Connect Claude |
  | Suppression list | Do-not-email list (keep "suppression" as a secondary term) |
  | Variant A/B | Version A / Version B |
  | Enroll | Add to campaign |

- **Errors:**
  - Say what happened and what to do next. For example: "Couldn't connect to Gmail. Check the app password and try again."
  - Never show raw database or provider errors. Today 28 places return `error.message` directly. Log those, and map the common ones to friendly text.
- Read every page aloud once. If a non-technical person would stumble, rewrite it.

## Phase 6: Key screens

Keep the structure; improve hierarchy and focus.

- **Dashboard:** from "five counts" to "what needs me today":
  - Replies waiting for an answer, newest first, with the AI draft status.
  - Today's sending vs limits.
  - The goal tracker.
  - The getting-started checklist, until it's done.
  - Totals move to Analytics.
- **Replies:** an inbox-style layout. A list on the left (sender, first line, type badge, "AI draft ready") and the conversation plus composer on the right. On phones, list and conversation are separate screens.
- **Campaign page:**
  - A clear header: name, status pill, one primary action (Start / Pause), and a ⋯ menu.
  - Tabs styled consistently.
  - The sequence editor as a vertical timeline (Day 0 → wait 3 days → follow-up), with the Write with AI card at the top.
- **Inboxes:** health shown as a simple traffic light with a plain-English reason; connection settings tucked under "Advanced".
- **Pipeline:** cleaner cards (name, company, last message, days in stage), with a column total in the header.
- **Billing:** the current plan summary first, then the plan picker.
- **Auth pages:** a split layout. The form on one side; on the other, a short value statement and the 3 trial facts (7 days, 200 emails, no card).
- **Welcome flow and homepage:** apply the new tokens and font; check the calculator and fact boxes match the app.

## Phase 7: Feedback and motion

- **Optimistic UI** for toggles and quick actions (marking a reply handled, settings switches), with toasts on success and a rollback on error.
- **Pending states:** a spinner inside the button, the button disabled, and the label kept the same.
- **Motion:**
  - Subtle (150–200ms) fades and slides for dialogs, drawers and toasts only.
  - Respect `prefers-reduced-motion`.
  - Keep the top navigation progress bar.

## Phase 8: Accessibility

- Visible focus rings in the brand colour. The app must be fully usable with the keyboard, including the pipeline (already has keyboard moves), dialogs and menus.
- Every input has a label. Icon-only buttons have `aria-label`s. Toasts use `aria-live`.
- Text contrast meets AA in both themes. Status is never shown by colour alone (always an icon or word as well).
- Target: Lighthouse Accessibility ≥ 95 on the homepage, dashboard, campaign, replies and settings.

## Phase 9: Edges people notice

- **Error pages:** `app/not-found.tsx`, `app/error.tsx` and `app/(app)/error.tsx`. Each is branded and explains the problem in one line, with a way back. There are none today, so Next's defaults show.
- **System emails:** give the reminder emails (`lib/system-mail.ts`, `noticeEmail` in `packages/core/src/onboarding.ts`) a simple branded HTML layout: logo, one button, footer. Provide matching HTML for the owner to paste into the Supabase "Confirm signup" and "Magic link" templates.
- **Tab titles:** every page has a meaningful title ("Replies · YCAReach"), checked across all routes.
- **Number of things on screen:** remove debug-looking details from normal views. Move internal IDs, raw message IDs and "classification source" labels to tooltips or Advanced.

## Phase 10: QA and sign-off

1. **Seed data.** Create a demo workspace with realistic data (3 campaigns, ~200 leads, 20 replies across all types, pipeline cards, analytics history). Then screenshot pages with real-looking content, not empty states only.
2. **Screenshots.** Capture every route at **1280×800 and 390×844, in light and dark mode**: before (Phase 0) and after. Put them side by side for the owner.
3. **Checks.** No console errors. No horizontal scrolling on phones. No text overflowing its box. Lighthouse Accessibility ≥ 95.
4. **Tests.** All tests, the typecheck, lint and build pass.
5. **Hand-off.** List anything deferred, and note any copy you changed that the owner should approve.

---

## Suggested order and size

| Phase | Effort | Visible impact |
|---|---|---|
| 1 Brand foundation | Small | Very high |
| 2 Shell and mobile nav | Medium | Very high |
| 3 Components | Medium | High |
| 4 Data presentation | Medium | High |
| 5 Copy | Small–medium | High |
| 6 Key screens | Large | High |
| 7 Feedback and motion | Small | Medium |
| 8 Accessibility | Small–medium | Medium |
| 9 Edges | Small | Medium |
| 10 QA | Medium | (confidence) |

If time is short, Phases 1–3 alone remove most of the "template" look.
