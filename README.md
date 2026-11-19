# KALIN

A static HTML/CSS/JavaScript care-coordination prototype for families and caregivers. Auth and data use Supabase. No build step, no framework.

> **Note for AI assistants / new contributors:** read this whole file before changing anything. The "Current status", "Gotchas" and "Rules" sections matter most.

## Run locally
1. Serve the folder with a local web server (VS Code Live Server, usually `http://127.0.0.1:5500`). Do not open the HTML files with `file://`.
2. Open `login.html`, then sign in or create an account.

## Stack
- Plain HTML + CSS + vanilla JS (classic `<script>` tags, not ES modules).
- Supabase JS v2 loaded from a CDN (`@supabase/supabase-js@2.45.4`), client created in `js/supabase.js`.
- Fonts: Figtree (display) and Inter (body) from Google Fonts.
- Planned AI: Google Gemini (free tier) called from a Supabase Edge Function. Never from the browser.

## File map
| File | Purpose |
|---|---|
| `login.html`, `js/login.js`, `css/login.css` | Sign in, sign up, email confirmation. `login.css` also holds the shared design tokens (`--navy-*`, `--ink`, `--muted`, `--line`, `--field`, `--teal`, `--danger`, `--display`, `--body`) and form styles used by every page. |
| `reset-password.html`, `js/reset-password.js` | Password recovery. |
| `js/supabase.js` | Supabase URL + publishable key, `createKalinClient()`. |
| `dashboard.html`, `css/dashboard.css` | Home: circle cards, create-circle dialog, sidebar layout (shared by all app pages). |
| `js/dashboard.js` | **Shared app bootstrap for every app page** (session guard, sidebar Circles drawer, circle loading, create-circle dialog). Also loaded by `calendar.html` and `circle.html`. |
| `calendar.html`, `js/calendar.js`, `css/calendar.css` | Weekly shift calendar. Not yet connected to real data. |
| `circle.html`, `js/circle.js`, `css/circle.css` | A single circle's page (`circle.html?id=<uuid>`). |

## Supabase setup

### Auth
- Authentication → URL Configuration: Site URL `http://127.0.0.1:5500`, redirect URLs `http://127.0.0.1:5500/**` and `http://localhost:5500/**`. Add the deployed URL before going live.
- Never put a `service_role` key in browser code. The publishable key in `js/supabase.js` is the only key allowed there.

### Database (already run)
All tables are in `public`, with Row Level Security enabled and explicit grants to `authenticated`.

- `circles` (`id`, `name` ≤60 chars, `description` ≤120 chars, `is_active`, `created_by` default `auth.uid()`, `created_at`)
- `circle_members` (`circle_id`, `user_id`, `role` in `owner|member`, `joined_at`, PK `(circle_id, user_id)`)
- `public.is_circle_member(uuid)`: `security definer`, `set search_path = ''`, used by policies to avoid RLS recursion.
- `public.add_circle_owner()` trigger on `circles` insert: adds the creator to `circle_members` as `owner`.
- Policies: members read their circles and fellow members; users insert circles as themselves; only the owner updates or deletes a circle. There is intentionally **no insert policy on `circle_members`** (members must be added by a trigger or a server function, e.g. a future invite flow). There is no "leave circle" policy yet.
- `care_notes` (`id`, `circle_id`, `author_id` default `auth.uid()`, `body` 1–2000 chars, `created_at`) and `ai_log` (`id`, `circle_id`, `kind` in `handoff_brief|summary`, `body`, `created_by`, `created_at`). Members of the circle can read and insert. Authors can delete their own notes. **These two tables were written but the owner has not yet confirmed they ran or tested them** (see "Not verified").

### Idea not yet applied
Limit users to 5 active created circles with a `before insert` trigger on `circles` (counts `is_active` rows by `created_by`). Not run.

## Current status

### Working
- Sign in, sign up, confirmation, password reset.
- Home: lists the user's circles as cards, create-circle dialog, circle count badge.
- Sidebar: collapsible Circles list (state remembered in `localStorage`), round color dots, active circle highlighted.
- Circle page (`circle.html`): header card with "[Name]'s care circle", description (only if set), "On duty: No one assigned" placeholder, gear menu for the owner with **Delete circle** (confirm dialog, then returns Home).
- Circle page placeholders (visual only, no behaviour): **To do**, **Medication**, **Shift volunteering board**, **AI log**, and a **Handoff brief** button in the top bar. All show "Coming soon" and do nothing.

### Not built yet
- Real shifts data, "who's on duty", and calendar wiring (`loadCalendarCircles()` in `js/calendar.js` is an empty stub).
- Invites, and showing other members' names (needs a `profiles` table filled at sign-up; today other members appear only as generic "Member").
- Notifications.
- Edit circle name/description: the code (`openEdit`, `#edit-dialog`) still exists in `circle.html`/`circle.js` but no UI opens it.
- Unused-but-kept helpers in `js/circle.js`: `dutyCard`, `weekCard`, `membersCard`, `settingsCard`, `memberRow`.

### AI feature plan (Gemini, free tier)
1. A Supabase Edge Function `handoff-brief` (created in the dashboard: Edge Functions → Deploy a new function → Via Editor).
2. It builds a Supabase client from the caller's `Authorization` header (so RLS still applies), reads recent `care_notes` for the `circle_id`, calls `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent` with header `x-goog-api-key`, and returns the text. Save results to `ai_log`.
3. Secrets (Edge Functions → Secrets): `GEMINI_API_KEY`, `GEMINI_MODEL` (a stable Flash/Flash-Lite model ID; avoid `preview`/`exp`).
4. The browser calls it with `client.functions.invoke('handoff-brief', { body: { circle_id } })`.
5. Use made-up data only on the free tier (Google may use free-tier prompts to improve products). Output must be labelled a draft, never medical advice, and must never suggest doses. Cache outputs in `ai_log` and rate-limit per circle.

### Not verified
- The `care_notes` / `ai_log` SQL was given to the owner but they have **not** yet checked the tables exist or inserted test rows.
- Gemini API key / `GEMINI_MODEL` secrets: owner was in the middle of adding them. The Edge Function has **not** been deployed.
- Nothing in this project has been tested by the assistant against the live Supabase project (no network access from the assistant's sandbox). JS was only syntax-checked with `node --check`.

## Gotchas (read before editing)
- **All app pages share one global script scope.** `dashboard.js`, `calendar.js` and `circle.js` are classic scripts loaded on the same page, so top-level `function` names overwrite each other and top-level `const`/`let` redeclarations throw. This already caused a bug: `calendar.js` had its own `colorFor()` and `loadCircles()` which replaced the dashboard's and made the sidebar color dots disappear. They are now `calendarColorFor()` and `loadCalendarCircles()`. Prefix or wrap new page-specific code (`circle.js` is an IIFE) and check for collisions.
- `js/dashboard.js` exposes globals other pages rely on: `client`, `currentUser`, `window.kalinReady`, `el()`, `colorFor()`, `loadCircles()`, `circles`. Pages wait on `await window.kalinReady` before querying.
- The dashboard-specific code in `dashboard.js` is guarded with null checks so it is safe on pages without those elements. Keep it that way.
- Dialog styles in `dashboard.css` are keyed by id (`#circle-dialog`, `#edit-dialog`). A new dialog needs its id added to those selectors.
- The narrow-screen sidebar (≤860px) is icon-only; the Circles toggle there jumps to `dashboard.html#circles`.
- The sidebar Circles list hides its overflow during the open/close animation (`.animating` class) to avoid a flashing scrollbar.

## Rules
- Never put `service_role` or any secret (Gemini, etc.) in browser code or commit it.
- Build DOM with `textContent` / `createElement` (see `el()`); never put user-entered text (circle names, notes) into `innerHTML`.
- Every new table needs RLS enabled, explicit policies, and a `grant ... to authenticated`. Membership checks go through `public.is_circle_member()`.
- Don't store real sensitive care information until access rules have been reviewed and tested.
- Match the existing design: navy sidebar, white rounded cards (`border-radius: 20px`, `1px solid var(--line)`), pill/rounded buttons, the `--*` tokens in `login.css`. Round color dots for circles, not squares.

## Suggested next steps
1. Owner confirms `care_notes` / `ai_log` exist and inserts a few fake notes.
2. Deploy the `handoff-brief` Edge Function, set secrets, then wire the **Handoff brief** and **AI log** placeholders in `js/circle.js` (calling `functions.invoke`, saving to `ai_log`, rendering the result with `textContent`, handling rate-limit errors).
3. Build care notes UI, then shifts/on-duty, then invites + `profiles`.