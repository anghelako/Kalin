# Kalin code and security review

Reviewed the working tree, including the untracked Circles and Pharmacy list files. The README was read first. **Verified** means the cited behavior or gap follows from repository source. **Assumed** means its impact or behavior depends on deployed settings, database code, or runtime conditions. No build, browser session, live Supabase query, Gemini request, or exploit test was run for this review. No deployed authorization failure was established.

## Pass 1 · File map

Sizes in bytes at review time.

| Area | Files |
|---|---|
| Documentation and repo | `README.md` (18,781), `.gitignore` (70) |
| Pages | `login.html` (8,120), `reset-password.html` (4,630), `dashboard.html` (11,940), `circles.html` (7,609), `circle.html` (15,600), `calendar.html` (11,359), `pharmacies.html` (7,400), `pharmacy.html` (14,560) |
| Auth and shared JS | `js/supabase.js` (845), `js/login.js` (8,003), `js/reset-password.js` (3,499), `js/dashboard.js` (25,926), `js/shell.js` (1,487), `js/home.js` (29,954) |
| Circle and calendar JS | `js/circles.js` (5,464), `js/circle.js` (31,538), `js/calendar.js` (23,137), `js/todo.js` (10,350) |
| Pharmacy and medication JS | `js/pharmacies.js` (4,615), `js/pharmacy.js` (21,202), `js/pharmacy-core.js` (6,873), `js/medication.js` (21,212) |
| Styles | `css/app-ui.css` (35,133), `css/calendar.css` (11,444), `css/circle.css` (10,970), `css/dashboard.css` (19,230), `css/login.css` (12,920), `css/pharmacy.css` (9,786) |
| Supabase | `supabase/functions/home-digest/index.ts` (7,855) |
| Images | `images/favicon.png` (14,391), `images/kalin-logo.png` (64,270) |

## Top 10 changes

1. **High · B01** Commit a reproducible database baseline and versioned migrations for every feature the client calls.
2. **High · B03, B04** Gate real care data on a passing role and RPC authorization matrix using owner, member, and non-member accounts.
3. **High · B06** Remove identifiable care data from Gemini input and use a deterministic summary for care-critical status.
4. **High · B07, B08** Reserve Gemini quota atomically before generation and give generated digest rows a trusted write path.
5. **High · F01** Make logout trustworthy across both browser stores and isolate temporary recovery sessions.
6. **High · F02, F07** Preserve independently loaded care alerts and visibly mark medication and pharmacy data stale when a refresh fails.
7. **High · B05** Verify the leave, claim, record-dose, and undo transactions together with their constraints and permissions.
8. **Medium · F03, F04** Give Calendar latest-request-wins behavior and key circles by ID so same-named circles stay separate.
9. **Medium · F05, F06** Use a shared eligibility rule for upcoming shifts and define the circle’s schedule time zone.
10. **Medium · X01, X02** Check in the five regression tests below and replace the README’s stale setup and status claims.

## Pass 2 · Backend findings

| ID | Severity | Area | File:line | Problem | Suggested fix | Effort | Verified or Assumed |
|---|---|---|---|---|---|---|---|
| B01 | High | Schema and migrations | `README.md:41`, `:53`, `:123`, `:127`, `:137`; `home-digest/index.ts:115` | The checkout contains no SQL, so the documented setup and client database dependencies cannot be recreated or audited locally. | Export the deployed schema without application data, review and commit a baseline plus ordered migrations, and test a fresh install and upgrade in a disposable environment. | L | Verified |
| B02 | High | Missing function source | `README.md:82`; `js/circle.js:243` | The client calls `handoff-brief`, but its handler is absent from the checkout. | Recover the deployed source and review caller authentication, membership checks, note limits, provider handling, log writes, and deployment settings before enabling it for real data. | M | Verified |
| B03 | High | RLS and grants | `README.md:42–52`, `:130`, `:138–141`; `js/home.js:570` | The isolation of circles, profiles, shifts, notes, AI logs, join requests, tasks, inventory, schedules, doses, stock movements, and personal digests depends on absent policies and grants. | Check each table and exposed view under `anon`, `authenticated`, and the documented member roles, including write restrictions, column grants, and embeds. | L | Assumed |
| B04 | High | Privileged RPCs | `README.md:46`, `:52`, `:130`, `:139–141`; `js/calendar.js:197`; `js/medication.js:100`, `:129` | The repo cannot establish whether privileged functions use a fixed search path, validate the caller and target row, or expose execute permission beyond their intended callers. | Audit function definitions, owners, signatures, validation, grants and defaults, then test denied calls as anonymous, non-member, ordinary member, and owner. | M | Assumed |
| B05 | High | Atomicity and integrity | `README.md:44–52`, `:140–144`; `js/circle.js:853–869`; `js/pharmacy.js:467` | The leave confirmation promises shift release, while the browser only deletes membership and depends on unreviewable database code for atomic release and for ledger consistency. | Verify generated IDs and checks, circle-scoped foreign keys, cascades and retention, the release trigger or RPC, shift uniqueness, dose uniqueness and locking, and exactly-once ledger effects in concurrency tests. | L | Assumed |
| B06 | High | Gemini disclosure and output trust | `js/home.js:587–628`; `supabase/functions/home-digest/index.ts:133–156` | The function forwards client-supplied circle names and medicine names with dose timing and accepts a structurally valid brief without verifying its facts or medical claims. | Generate a deterministic brief from authorized facts or send only de-identified counts and event types, then keep generated text separate from actionable care status. | M | Verified |
| B07 | High | Gemini spending | `supabase/functions/home-digest/index.ts:9–10`, `:110–142`, `:155–161` | The process-local lock and latest-success lookup do not reserve a provider call across workers, and the request sets no explicit model output-token budget. | Reserve per-user and project quota in a shared atomic store before the provider call, set an output cap, and monitor provider calls including failed generations. | M | Verified |
| B08 | High | Digest write provenance | `supabase/functions/home-digest/index.ts:103–108`, `:155–159`; `js/home.js:564–579` | The handler inserts using the caller’s JWT and provides no source-visible way to distinguish its write from another write made with the same identity. | Confirm deployed behavior, narrow generated digest writes to a trusted server path, and keep caller reads constrained to their own rows. | M | Verified source design, live policy unverified |
| B09 | Medium | Edge resource limits and observability | `supabase/functions/home-digest/index.ts:61–100`, `:127–131`, `:146–164` | The body read has a byte cap but no handler-level deadline and precedes token validation, while generic failures leave no source-visible diagnostic event across the auth, DB, and provider stages. | Apply a deadline to body reading, authenticate before expensive work where practical, and record stage and status without payloads, secrets, or model output. | M | Verified |
| B10 | Low | Browser origins | `supabase/functions/home-digest/index.ts:3–7`, `:84–108` | The function accepts every browser origin through CORS even though it separately requires a valid bearer token. | Use an origin allowlist for supported deployments if cross-origin clients are unnecessary, while keeping token checks in place. | S | Verified |
| B11 | Medium | Database access paths | `js/dashboard.js:454–497`; `js/home.js:570–571`; `js/calendar.js:135–142`; `js/pharmacy.js:512–517` | The schema needed to assess membership, date-range, newest-digest, and item-ledger queries is absent. | Compare existing indexes and plans against actual usage before adding candidates such as membership by user, shift dates, digests by user and creation time, and movements by item and creation time. | M | Assumed |

The RLS and function audit criteria follow the official [Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions guide](https://supabase.com/docs/guides/database/functions), and [Edge Function auth guide](https://supabase.com/docs/guides/functions/auth). Check provider data handling against the applicable [Gemini API terms](https://aistudio.google.com/docs/terms).

## Pass 3 · Frontend findings

| ID | Severity | Area | File:line | Problem | Suggested fix | Effort | Verified or Assumed |
|---|---|---|---|---|---|---|---|
| F01 | High | Auth session lifecycle | `js/dashboard.js:5–10`, `:31–50`; `js/login.js:7–9`, `:232–244`; `js/reset-password.js:2`, `:97–108` | Logout ignores returned errors and redirects after signing out only the active client, while login probes both stores and recovery defaults to persistent storage. | Define one active session across both storage modes, isolate recovery, and show an actionable error if sign-out or recovery cleanup fails. | M | Verified |
| F02 | High | Home and bell care alerts | `js/home.js:151–152`, `:169–208`, `:684–695` | Failure of any medication, task, or shift read discards all care alerts, even when the other categories loaded successfully. | Track failure and retry per category and preserve successful alerts alongside a specific unavailable status. | M | Verified |
| F03 | Medium | Calendar races | `js/calendar.js:628–664`, `:672–696`; `js/dashboard.js:482–526` | Overlapping reloads can let an earlier response overwrite newer state, including Calendar rows from a previous week under the current header. | Capture the selected week and membership context per request and ignore stale successes and failures before updating shared state. | M | Verified unguarded flow |
| F04 | Medium | Calendar circle identity | `js/calendar.js:148–158`, `:249–281`, `:465–505` | Filters, counts, and colors use display names, so separate circles with the same name are grouped together. | Use circle IDs for keys and filters and retain names solely for display. | S | Verified |
| F05 | Medium | Past shift actions | `js/circle.js:573–586`, `:600–613`; `js/calendar.js:192–212`, `:304–315`; `js/home.js:190–194` | The circle board includes all open slots on today’s date and Calendar enables volunteering on displayed open shifts with no start-time check, while Home limits upcoming shifts by start time. | Define when claims close, share that rule across views, and enforce it in the database if past claims are forbidden. | M | Verified UI, RPC rules unverified |
| F06 | Medium | Scheduling time zones | `js/pharmacy-core.js:53–72`; `js/medication.js:50–70`, `:100–104`; `js/circles.js:72–94`; `js/home.js:91–94` | Shift and dose dates depend on the viewer’s device, so differently configured devices can show different schedules and submit different slot dates for the same circle. | Define a circle time zone and shared date helpers, or explicitly constrain the pilot to one zone and test transitions at midnight. | M | Verified calculation, real usage unverified |
| F07 | High | Stale medication and stock state | `js/medication.js:44–82`, `:113–139`; `js/pharmacy.js:30–43`, `:478–484`; `js/circle.js:515–519` | Silent refresh failures leave older stock, dose, or on-duty information on screen without marking it stale, including after a successful mutation. | Update from confirmed mutation responses, then flag stale views with a timestamp and retry while retaining last-known values. | M | Verified |
| F08 | Medium | Signup privacy | `js/login.js:122–140`, `:175–198`, `:214–227` | Signup turns an obfuscated duplicate response into an explicit existing-account message when identities are empty. | Give duplicate and new signup attempts the same acknowledgement where confirmation is required, keep recovery copy neutral, and verify the deployed Auth settings. | S | Verified branch, deployment behavior unverified |
| F09 | Medium | Recovery keyboard access | `js/reset-password.js:65–83`; `js/login.js:58–80` | Recovery’s password reveal listens only to pointer input and blur, while sign-in implements keyboard press and release. | Reuse equivalent Space and Enter handling or use a conventional accessible reveal toggle on recovery. | S | Verified |
| F10 | Medium | Third-party script integrity | `login.html:169`; `reset-password.html:101`; `dashboard.html:250`; `js/supabase.js:14` | Auth and app pages load a pinned CDN script without an integrity attribute, and the checkout provides no CSP configuration for those pages. | Self-host or integrity-pin the bundle, then test a restrictive hosting CSP and document which headers are set in production. | M | Verified repository configuration |
| F11 | Medium | Join request visibility | `js/dashboard.js:514–522`; `js/home.js:243–247`, `:353–363` | A failed shared request fetch clears pending cards silently, and all join alerts land at a review list that renders only the first five requests. | Keep the last known request list with a visible failure state, and offer pagination or a targeted link for each pending request. | M | Verified |
| F12 | Medium | API row caps | `js/pharmacies.js:103–108`; `js/pharmacy.js:30–35`; `js/calendar.js:135–142`; `js/medication.js:54–71` | Unpaginated reads can yield incomplete lists or summaries when the selected data exceeds the configured response cap. | Page with stable ordering where complete rows are needed and consider a scoped aggregate for pharmacy chip counts once volume justifies it. | M | Verified unbounded reads, deployment cap unverified |
| F13 | Medium | Stock history race | `js/pharmacy.js:506–525` | Closing one history dialog and opening another before the first response arrives can show the wrong item’s movements under the current title. | Track the active item or request ID and discard older or closed-dialog responses before writing the list. | S | Verified unguarded flow |
| F14 | Medium | Dose and stock retry semantics | `js/medication.js:96–104`, `:263`; `js/pharmacy.js:462–481` | As-needed recording and stock adjustments send no request identity, so the client cannot reliably reconcile an ambiguous timeout with its original mutation. | Use a scoped idempotency key and a response that lets the client confirm the operation before it invites a retry. | M | Verified client behavior, DB deduplication unverified |
| F15 | Medium | Saved AI brief freshness | `js/home.js:559–579`, `:707–712`; `dashboard.html:82–93` | Home displays the newest saved brief under “Today’s brief” without checking its date or whether the user still belongs to every circle represented in it. | Expire or explicitly mark saved briefs stale across day and membership changes, and document retention for generated summaries. | M | Verified |
| F16 | Medium | Circle settings and pharmacy tabs | `js/circle.js:140–179`; `pharmacy.html:251–256`; `js/pharmacy.js:414–427`, `:573–575` | Custom Circle settings opens without moving focus into its menu, and pharmacy’s roving stock tabs are click-driven, leaving inactive choices outside the keyboard sequence. | Use a native disclosure or implement menu focus and Escape restoration, and give stock tabs arrow-key navigation or replace them with ordinary buttons. | M | Verified |
| F17 | Low | UI diagnostics | `js/dashboard.js:395–397`, `:630–653`; `js/pharmacy-core.js:167–175`; `js/circle.js:902–904` | Multiple user-visible errors use raw database message text, which can expose implementation details and varies with server changes. | Map known error codes to safe, actionable copy and record sanitized diagnostics separately. | S | Verified |
| F18 | Low | Hidden and unreachable controls | `circle.html:69–72`; `js/circle.js:92–124`, `:378`, `:803–808` | The handoff trigger remains inside a hidden container, and the retained members and settings helpers have no visible route from the rendered circle page. | Decide which controls belong in the active UI and remove unreachable helpers after that decision. | S | Verified |

Browser security review covered every `innerHTML`, `outerHTML`, `insertAdjacentHTML`, and navigation sink in the checkout. Calendar’s dynamic text and attribute values pass through its escaping helper, and the remaining HTML writes are static or use internal icon constants in the reviewed paths. URL parameters select IDs or a fixed return route, and the browser credential in `js/supabase.js:6–17` is a publishable key. The repo does not establish production CSP, Auth policy, or RLS. For platform behavior, see [sign-up response behavior](https://supabase.com/docs/reference/javascript/auth-signup), [sign-out behavior](https://supabase.com/docs/reference/javascript/auth-signout), and [select row limits](https://supabase.com/docs/reference/javascript/select).

## Pass 4 · Cross-cutting findings

| ID | Severity | Area | File:line | Problem | Suggested fix | Effort | Verified or Assumed |
|---|---|---|---|---|---|---|---|
| X01 | Medium | Reproducible tests | `README.md:87–96`, `:137` | The README describes prior mock and SQL testing, but the checkout has no committed browser fixtures, SQL tests, or automated test runner. | Commit the five focused test groups below and run them against a clean checkout. | M | Verified |
| X02 | Medium | README and deployment drift | `README.md:17–33`, `:48`, `:60–90`, `:103–106`, `:115–119`, `:145` | Setup references are absent and the feature guide describes the old shell, join and notification gaps, and an AI deployment path that cannot be reproduced from this tree. | Update the file map and status from working entry points, and separate source availability from deployment and test status. | S | Verified |
| X03 | Medium | Ownership contract | `js/circle.js:14–15`; `js/pharmacy.js:82`; `js/todo.js:34`; `js/home.js:97`; `README.md:141` | Owner UI checks disagree on whether creation or membership role is authoritative. | Choose one source of truth and enforce or test the invariant across owner creation, approval, leave, pharmacy, and task actions. | M | Verified split, deployed consistency unverified |
| X04 | Medium | Shell and globals | `dashboard.html:17–65`; `calendar.html:18–66`; `pharmacies.html:18–66`; `js/dashboard.js:721–732`; `js/shell.js:1–37` | Repeated navigation and dialog markup allows drift, and the shared Pharmacy fallback already relies on a link’s current DOM and text. | Keep classic scripts, give shared navigation stable route markers, and add a markup contract test for the common IDs, tab targets, and script order. | S | Verified |
| X05 | Low | Redundant reads and timers | `js/calendar.js:162–188`, `:628–643`; `js/home.js:305–315`, `:682–704`; `js/circle.js:793`; `js/medication.js:570–576` | Calendar refetches circles on week changes despite the shared bootstrap, and hidden pages have timer paths that continue polling or rendering. | Reuse membership snapshots for week changes and pause discretionary refreshes while a document is hidden, with one refresh on return. | M | Verified |

### README corrections

- `README.md:30–33`, `:53`, `:123`, `:127`, `:137` name missing `supabase/todo_setup.sql`, `supabase/pharmacy_setup.sql`, `supabase/shifts_setup.sql`, `supabase/circles_join_setup.sql`, and `supabase/functions/handoff-brief/index.ts`. Base circles, profile and shift, notes and AI log, personal digest, and leave-trigger definitions are absent. The checked-in Edge Function is `home-digest`.
- `README.md:48`, `:75–76`, `:118`, and `:145` conflict with source for the leave UI, invite codes, request review, and the in-app notification bell. The leave database trigger and all deployed RPC behavior remain unverified. Document which reminders are in-app and which delivery channels are planned.
- `README.md:62–64`, `:68`, and `:103–106` describe an old Home/rail layout, a visible top-bar handoff trigger, and older dialog selectors. Source has dedicated Circles and Pharmacy list pages, shared profile and notification popovers, and a hidden handoff trigger.
- `README.md:41–53`, `:87–90`, and `:137` mix setup claims, unverified deployment, and different test descriptions. Record each environment separately and link the migration versions and test artifacts supporting it.
- I disagree with using viewer-local time as the lasting schedule contract in `README.md:74`, `:142), and with treating a billing-enabled Gemini key and consent in `README.md:85` as sufficient preparation for identifiable care inputs. A shared schedule needs one date boundary per circle, and external disclosure needs a data-minimization and provider review before real inputs are enabled.

### Five most valuable tests to add

1. **SQL baseline and three-role RLS matrix.** Apply migrations to disposable Postgres/Supabase, then test owner, member, and unrelated or declined user reads, writes, denied RPC execution, and profile/stock/history embeds across two circles.
2. **Leave and claim concurrency.** Race two claimers and a membership leave against the same shift, verify the owner protection and unrelated shifts, and assert the final state matches the stated retention rule for past shifts.
3. **Medication transaction and authorization.** Race two clients for the same scheduled dose, retry an as-needed or stock operation, undo inside and outside the window, and reconcile quantities, flags, and ledger rows.
4. **Edge boundary and spending.** Stub Gemini and test invalid tokens, oversized and slow bodies, client-supplied facts, filtered provider responses, multi-worker quota, and the difference between a trusted insert and a user API write.
5. **Mock-client browser regression.** Cover both session stores and failed logout, recovery keyboard operation, rapid week navigation with duplicate circle names, partial notification failure, and stale medication refresh after success.

## Keep as is

1. The static classic-script architecture and page IIFEs. Fix concrete hot spots without a framework or build migration.
2. The text-only DOM helper and existing Calendar escape handling for template text and attributes.
3. The public browser key and server-side Gemini secret lookup as separate concerns.
4. The shared `KalinRx` status helpers and single batched list queries for stock and current duty.
5. The Edge Function’s caller token check, bounded UTF-8 body reader, provider timeout, and generic client-facing failures.

## Do not build yet

- **Push, SMS, or email reminders.** Establish trustworthy in-app state and one schedule time zone first.
- **More AI summaries or medication advice.** Resolve data disclosure, saved brief provenance, and spending controls first.
- **Ownership transfers or new administrative roles.** Settle the existing owner invariant and test it before expanding permissions.
- **A framework migration or generalized component system.** Shared route markers, a few helpers, and contract tests address the drift with less risk.

## Must be checked on the live project

- [ ] Export current schemas and compare migration history with a fresh local baseline. Confirm apply order for base auth/profiles and circles, membership and joins, shifts and leave handling, care notes and AI logs, tasks, pharmacy/schedules/doses/ledger, and personal digests. Confirm repeatability for the scripts that are intended to be rerun, and rehearse restoring a backup without production care data.
- [ ] Inspect `pg_policies`, table and column grants, schema exposure, function owners, fixed search paths, and execute grants to `PUBLIC`, `anon`, and `authenticated`. Review every exposed RPC including `claim_shift`, `release_shift`, `request_to_join`, `respond_to_join_request`, `create_pharmacy_item`, `adjust_pharmacy_stock`, `mark_dose_taken`, `undo_dose`, the leave mechanism, and membership and ownership helpers.
- [ ] Use synthetic data and three accounts. The owner should see and manage its circle and review only its own join requests, the member should see its circle and perform only allowed care actions, and the unrelated or declined account should see no care rows and fail cross-circle reads and writes. Rotate the third account through pending, declined, approved, and former-member states. Repeat read checks with no session.
- [ ] Test profile embeds, join-code visibility, one-time approval and denial behavior, creator and role consistency, ID and length constraints, collision behavior, cascades, retention, and measured query plans against the deployed schema.
- [ ] Validate shift claim/release and leave concurrency, direct stock and ledger write restrictions, medication record and undo concurrency, and personal digest isolation with both API-role and ordinary UI flows.
- [ ] Confirm which Edge Functions are deployed, their source revisions, JWT and CORS configuration, Gemini secrets and model availability, quota and spending caps, data-processing settings, and monitoring. Check for broad production redirect allowlists, recovery expiry, Auth settings, CAPTCHA or rate controls where appropriate, and actual session cleanup on logout.

## Questions for me

1. Is the deployed Supabase project the source of truth for the missing SQL and `handoff-brief` source?
2. Is this still a synthetic-data prototype, or do any circles contain real care information?
3. Which time zone should govern each circle’s shifts and doses when caregivers travel?
4. Should leaving a circle release only current and future shifts, or also erase historical assignments and access to saved briefs?
5. Should circle ownership ever differ from the creator account?
