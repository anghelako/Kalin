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
| `calendar.html`, `js/calendar.js`, `css/calendar.css` | Weekly shift calendar connected to Supabase: volunteer, release, owner-only create/delete shift dialog. |
| `circle.html`, `js/circle.js`, `css/circle.css` | A single circle's page (`circle.html?id=<uuid>`): header card, AI log, Handoff brief dialog, Add note dialog, placeholders. |
| `supabase/shifts_setup.sql` | SQL for `profiles` + `shifts` + volunteer/release functions. Paste into the Supabase SQL Editor. |
| `supabase/functions/handoff-brief/index.ts` | Edge Function that calls Gemini. Deployed by pasting into the Supabase dashboard (not auto-deployed from this folder). |

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

- `profiles` (`id` → auth.users, `full_name`), filled by trigger `on_auth_user_created` and backfilled. A user can read their own profile and profiles of people who share a circle (`shares_circle_with()`).
- `shifts` (`id`, `circle_id`, `shift_date` date, `slot` `morning|evening`, `assigned_to` → profiles (null = OPEN), `created_by`, unique `(circle_id, shift_date, slot)`). Members read; only the circle owner inserts (open shifts only) and deletes. **No UPDATE policy/grant**: volunteering and releasing go through `claim_shift(shift_id)` / `release_shift(shift_id)` (security definer; claim is one atomic UPDATE where `assigned_to is null`, so two people can't take the same shift). Helpers: `is_circle_owner()`, `shares_circle_with()`.
- SQL lives in `supabase/shifts_setup.sql`. It must be run AFTER the circles setup. **Not yet confirmed run by the owner.**

### Idea not yet applied
Limit users to 5 active created circles with a `before insert` trigger on `circles` (counts `is_active` rows by `created_by`). Not run.

## Current status

### Working
- Sign in, sign up, confirmation, password reset.
- Home: lists the user's circles as cards, create-circle dialog, circle count badge.
- Sidebar: collapsible Circles list (state remembered in `localStorage`), round color dots, active circle highlighted.
- Circle page (`circle.html`): header card with "[Name]'s care circle", description (only if set), live **On duty** (green dot + name when the current shift, by the device's clock, is assigned; morning 7:00–15:00, evening 15:00–22:00; refreshed every minute), gear menu for the owner with **Delete circle**.
- **Calendar** (code written, tested only with a mock): real circles in the "Viewing" dropdown, shifts for the visible week with the volunteer's name (from `profiles`), Volunteer / Release buttons, owner-only **Create shift** dialog (circle, date, morning/evening/both, repeat none/daily/weekly for 1–12 weeks, existing shifts are skipped) and an × to delete a shift. Circle colors use the same hash as the sidebar (`colorFor` in `dashboard.js`, PALETTE order matches `CIRCLE_COLORS`).
- **Shift volunteering board** (circle page): open shifts in the next 14 days for that circle with a Volunteer button.
- **AI feature (code written, see "Not verified")**:
  - **Handoff brief** button (top bar) opens a dialog, calls the `handoff-brief` Edge Function with `kind: 'handoff_brief'`, shows the result with a Copy button and "AI-generated draft. Not medical advice."
  - **AI log** card lists saved `ai_log` rows (newest first, empty state "No summaries yet"), has **Generate summary** (`kind: 'summary'`) and **Add note** (inserts into `care_notes`, max 2000 chars).
  - Errors from the function (rate limit, no notes, not configured) are shown inline; buttons are disabled while a request runs.
- Placeholders that still do nothing: **To do**, **Medication**.

### Not built yet
- Editing a shift, assigning a shift to someone else, swapping shifts, shift notifications, time zones other than the device's own.
- Invites (there is still no way to add other members to a circle, so the volunteer flow can only be exercised end to end once invites exist or rows are added to `circle_members` by hand). Member names now come from `profiles` where they are displayed (calendar, on duty).
- Notifications.
- Edit circle name/description: the code (`openEdit`, `#edit-dialog`) still exists but no UI opens it.
- Unused-but-kept helpers in `js/circle.js`: `dutyCard`, `weekCard`, `membersCard`, `settingsCard`, `memberRow`.
- Viewing/deleting individual care notes (only adding exists).

### AI feature: how it works
- Edge Function `handoff-brief` (`supabase/functions/handoff-brief/index.ts`): input `{ circle_id, kind }`, `kind` is `handoff_brief` or `summary`. It builds a Supabase client from the caller's `Authorization` header + anon key (RLS applies, no service-role key), refuses if the circle already generated an `ai_log` row in the last 60 s (429), reads the latest 50 `care_notes` (404 if none), calls Gemini `generateContent` (`x-goog-api-key`, model from `GEMINI_MODEL`), inserts the result into `ai_log`, and returns `{ id, body, created_at }`. Errors return `{ error }` with a safe message. Notes are treated as untrusted data in the prompt. The prompt forbids medical advice and dose suggestions.
- Secrets (Edge Functions → Secrets): `GEMINI_API_KEY`, `GEMINI_MODEL` (stable Flash/Flash-Lite ID, not `preview`/`exp`).
- Deploy: Dashboard → Edge Functions → Deploy a new function → Via Editor → name `handoff-brief` → paste the file → Deploy.
- Free tier: use made-up data only (Google may use free-tier prompts to improve products). Before real families use it, switch to a billing-enabled key and get consent.

### Not verified
- **Live Supabase:** nothing has been run against the real project. The owner has not yet confirmed that `care_notes` / `ai_log` exist, has not deployed the `handoff-brief` Edge Function, and may not have set the Gemini secrets. **`supabase/shifts_setup.sql` has not been run.** Until it is, the calendar shows "The shift tables are not set up in Supabase yet" and the circle page's board shows the same message.
- **Tested only with a mocked Supabase client** (headless Chromium, fake in-memory data): AI log/Handoff brief/Add note flows; calendar loading, volunteer, losing a race to another volunteer, release, create (incl. daily repeat, both slots, duplicates skipped, past date rejected), delete; circle-page on-duty (faked 9 AM and 11 PM clock) and volunteering board. JS was syntax-checked with `node --check`.
- **Not tested at all:** the SQL itself (never executed), the PostgREST embeds (`circles(name)`, `profiles:assigned_to(full_name)`), the RPC calls against real functions, the Edge Function and Gemini, and every row level security rule (for example: a non-member cannot read shifts; a member cannot assign shifts to others; owners cannot create assigned shifts). Run the manual checks below before trusting it.

### Manual checks to run after the SQL
1. `select to_regclass('public.profiles'), to_regclass('public.shifts'), to_regprocedure('public.claim_shift(uuid)');` returns three non-null values.
2. As the circle owner, create a shift in Calendar; a second account that is a member sees it and can volunteer; a third non-member account sees nothing.
3. Two members clicking Volunteer on the same open shift: only one succeeds, the other sees "This shift is no longer available."
4. A member cannot release someone else's shift or delete a shift (try from the browser console with `client.from('shifts').delete()`; it should affect 0 rows).
5. The person on the current shift shows as "On duty" on the circle page.

## Gotchas (read before editing)
- **All app pages share one global script scope.** `dashboard.js`, `calendar.js` and `circle.js` are classic scripts loaded on the same page, so top-level `function` names overwrite each other and top-level `const`/`let` redeclarations throw. This already caused a bug: `calendar.js` had its own `colorFor()` and `loadCircles()` which replaced the dashboard's and made the sidebar color dots disappear. They are now `calendarColorFor()` and `loadCalendarCircles()`. Prefix or wrap new page-specific code (`circle.js` is an IIFE) and check for collisions.
- `js/dashboard.js` exposes globals other pages rely on: `client`, `currentUser`, `window.kalinReady`, `el()`, `colorFor()`, `loadCircles()`, `circles`. Pages wait on `await window.kalinReady` before querying.
- The dashboard-specific code in `dashboard.js` is guarded with null checks so it is safe on pages without those elements. Keep it that way.
- Dialog styles in `dashboard.css` are keyed by id (`#circle-dialog`, `#edit-dialog`). A new dialog needs its id added to those selectors.
- The narrow-screen sidebar (≤860px) is icon-only; the Circles toggle there jumps to `dashboard.html#circles`.
- Calendar functions that would collide with dashboard.js are prefixed (`calendarColorFor`, `loadCalendarCircles`, `calFriendlyError`, `calSetStatus`).
- The sidebar Circles list hides its overflow during the open/close animation (`.animating` class) to avoid a flashing scrollbar.

## Rules
- Never put `service_role` or any secret (Gemini, etc.) in browser code or commit it.
- Build DOM with `textContent` / `createElement` (see `el()`); never put user-entered text (circle names, notes) into `innerHTML`.
- Every new table needs RLS enabled, explicit policies, and a `grant ... to authenticated`. Membership checks go through `public.is_circle_member()`.
- Don't store real sensitive care information until access rules have been reviewed and tested.
- Match the existing design: navy sidebar, white rounded cards (`border-radius: 20px`, `1px solid var(--line)`), pill/rounded buttons, the `--*` tokens in `login.css`. Round color dots for circles, not squares.

## Suggested next steps
1. Owner runs `supabase/shifts_setup.sql`, confirms with the check above, then runs the manual checks.
2. Confirm `care_notes` / `ai_log` exist, set the Gemini secrets, deploy `handoff-brief`, and test the AI flow.
3. Build invites (server-side function that adds `circle_members`), since volunteering needs more than one member.
4. Then: care notes list/delete, To do, Medication, the 5-circles-per-user limit.