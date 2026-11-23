# Kalin verification for Batches A, B and C

23 November 2026 · Read-only verification of the linked Supabase project and the current working tree. Live evidence came from PostgreSQL catalogs, advisors and Edge deployment metadata/source. No application records were read and no live RPC, Edge endpoint, or provider was invoked. The checklist counts checks, not database records. PASS for source or metadata establishes that the expected definition is present. Hosted behavior still needs the smoke tests below.

## Checklist

| ID | Area | What was checked | Result | Evidence | Action needed |
| --- | --- | --- | --- | --- | --- |
| RLS-01 | DB | Public schema policies exclude PUBLIC and anon | PASS | All 29 public policies target authenticated in `pg_policies`. Batch A policy changes begin at `supabase/migrations/20261123090000_batch_a_hardening.sql:6`. | — |
| RLS-02 | DB | Current membership required to delete a care note | PASS | Live DELETE predicate is `author_id = auth.uid() AND is_circle_member(circle_id)`. `supabase/migrations/20261123090000_batch_a_hardening.sql:16`. | — |
| GRT-03 | DB | Schema-scoped table and function defaults | PASS | `pg_default_acl` for `postgres` has owner/service-role defaults only for public tables and functions. Sequence defaults and managed `supabase_admin` defaults are outside the revocations. `supabase/migrations/20261123090000_batch_a_hardening.sql:79`, `docs/BATCH_A.md:23`. | Revoke PUBLIC EXECUTE per new routine. |
| GRT-04 | DB | Circle name and description constraints | PASS | Live checks enforce 1–60 trimmed name characters and at most 120 description characters when non-null. `supabase/migrations/20261123090000_batch_a_hardening.sql:228`, `:238`. | See INT-05 for validation state. |
| FN-08 | DB | Empty search path on the four Batch A functions | PASS | Live `proconfig` has `search_path=""` for `add_circle_owner`, `add_circle_owner_membership`, `is_circle_member` and `owns_circle`. `supabase/migrations/20261123090000_batch_a_hardening.sql:85`. | — |
| INT-05 | DB | All four staged constraints and validation flags | PASS | All are **NOT VALID** (`convalidated=false`). `circles_batch_a_name_length`, `circles_batch_a_description_length`, `medication_schedules_batch_a_times`, `medication_schedules_batch_a_weekdays`. Both live array validator bodies match the migration. `supabase/migrations/20261123090000_batch_a_hardening.sql:192`, `:220`. | Schedule any review and validation separately, per `docs/BATCH_A.md:20`. |
| RLS-03 | DB | Neutral fallback in signup, pharmacy actor, and join-request logic | PASS | Enabled `auth.users` signup trigger uses `handle_new_user`. Live bodies of that routine, `pharmacy_actor_name` and `request_to_join` match the `Member` fallback definitions. Join contact remains a separate field. `supabase/migrations/20261123090000_batch_a_hardening.sql:91`, `:112`, `:124`. | Test signup via a synthetic account without a supplied name. |
| B-TIME-01 | DB | `manila_today()` exists and is stable | PASS | `provolatile=s`, uses the statement instant in Asia/Manila. `supabase/migrations/20261123100000_batch_b_behavior.sql:6`. | — |
| B-TIME-02 | DB | `manila_now()` exists and is stable | FAIL | `provolatile=v`. The live body matches the migration, which explicitly declares VOLATILE and uses `clock_timestamp()`. Claim/release read it after locks to check the actual cutoff. `supabase/migrations/20261123100000_batch_b_behavior.sql:14`, `:205`, `:248`, `docs/BATCH_B.md:7`, `:13`. | Reconcile the stability expectation with the post-lock clock requirement. |
| B-SHIFT-01 | DB | `shifts.assigned_name` access | PASS | Live text column, effective authenticated SELECT=true, INSERT=false, UPDATE=false. Member shift SELECT policy still applies. `supabase/migrations/20261123100000_batch_b_behavior.sql:129`. | — |
| B-SHIFT-02 | DB | Claim/release locking, cutoff, assignment and stable messages | PASS | Live claim/release bodies match. Membership is locked before the shift, Manila time is checked after locking, and updates are conditional. Snapshot stored on claim and cleared on release. `not_a_member`, `shift_taken`, `shift_started` present in both. `supabase/migrations/20261123100000_batch_b_behavior.sql:180`, `:223`. | — |
| B-SHIFT-03 | DB | Past-date insert guard | PASS | Enabled BEFORE INSERT `batch_b_shift_date_guard` uses the matching helper with `shift_in_past`. `supabase/migrations/20261123100000_batch_b_behavior.sql:158`, `:176`. | — |
| B-DOSE-01 | DB | Mark dose checks and messages | PASS | Live body matches. Membership, active schedule/item, configured date/time, range/frequency and future Manila dates covered. `not_a_member`, `schedule_inactive`, `item_inactive`, `invalid_dose_slot`, `dose_slot_in_future` present. `supabase/migrations/20261123100000_batch_b_behavior.sql:295`. | — |
| B-DOSE-02 | DB | Undo dose checks and messages | PASS | Live body matches membership → schedule → stock → dose locking, status recheck, owner/actor and 15-minute checks. `not_a_member` and existing undo messages retained. `supabase/migrations/20261123100000_batch_b_behavior.sql:410`. | — |
| B-STOCK-01 | DB | Create medicine and adjust stock validation | PASS | Both bodies match owner, scale and bounds checks. `invalid_stock_amount` in both, `invalid_stock_threshold` on creation, `stock_limit_exceeded` on adjustment. `supabase/migrations/20261123100000_batch_b_behavior.sql:492`, `:540`. | — |
| B-OWNER-01 | DB | Owner triggers and partial unique index | PASS | All four Batch B owner guards enabled and baseline creator-insert trigger enabled. Index `circle_members_batch_b_one_owner` is unique on `circle_id` where role is owner. `supabase/migrations/20261123100000_batch_b_behavior.sql:46`, `:105`, `supabase/migrations/0000_baseline.sql:984`. | — |
| B-DATE-01 | DB | Manila schedule start-date default | PASS | Live `medication_schedules.start_date` defaults to `manila_today()`. `supabase/migrations/20261123100000_batch_b_behavior.sql:290`. | — |
| B-LEAVE-01 | DB | Leaving preserves completed and past shifts | PASS | Enabled member AFTER DELETE trigger uses matching body. Future dates and unfinished slots on the Manila day are cleared, including the snapshot. Earlier shifts and completed same-day slots retain the snapshot. `supabase/migrations/20261123100000_batch_b_behavior.sql:262`, `docs/BATCH_B.md:8`. | — |
| C-CONSENT | DB | AI consent defaults off and uses the owner RPC | PASS | `circles.ai_enabled` is boolean, NOT NULL, DEFAULT false. Authenticated effective INSERT/UPDATE on the column are false. No anonymous public policy applies. Only the matching owner-gated `set_circle_ai_enabled` body changes the column among cataloged routines. `supabase/migrations/20261123110000_batch_c_ai_privacy.sql:4`, `:15`, `:33`. | — |
| C-QUOTA | DB | Reservation RPC, table, indexes and RLS | PASS | Matching `reserve_ai_generation` body, private reservation table with RLS enabled, two supporting indexes. No private-table policy by design. Clients use the RPC and table grants are revoked in the migration. `supabase/migrations/20261123110000_batch_c_ai_privacy.sql:18`, `:52`. | — |
| C-LOG | DB | Authenticated cannot insert AI logs. Members can read | PASS | Live authenticated table INSERT and every column INSERT/UPDATE are false, including `verified_generation`. SELECT grants remain with `is_circle_member(circle_id)` policy. The old INSERT policy is absent. `supabase/migrations/20261123110000_batch_c_ai_privacy.sql:6`. | — |
| DB-EXEC | DB | Public routine EXECUTE grants exclude PUBLIC and anon | PASS | All 28 public routines have no PUBLIC ACL EXECUTE, including default fallback evaluation, and no effective anon EXECUTE. See live ACLs below. | — |
| DB-PATH | DB | Every public SECURITY DEFINER routine has fixed empty search path | PASS | All 21 public definers have `search_path=""` in live `proconfig`. | — |
| DB-RLS | DB | Public RLS and policy predicates | PASS | All 13 public tables have RLS and policies. None of the 29 policies has unconditional true in USING or WITH CHECK. | — |
| DB-BODIES | DB | Live function body drift | PASS | All 37 live public/private function bodies match the corresponding final forward definition after collapsing whitespace and comparing MD5 fingerprints. Checks were inspected in the corresponding forward SQL. | — |
| DB-OBJECTS | DB | Live application schema objects described by baseline/forward SQL | PASS | No unexplained objects in inspected inventory. 13 public tables, one private table and its identity sequence, 37 functions, 29 policies, 10 triggers including the signup trigger, 82 constraints and 34 indexes. Three reservation constraints and the primary-key index are generated by the inline DDL at `supabase/migrations/20261123110000_batch_c_ai_privacy.sql:18`. Four inspected extensions are in `supabase/migrations/0000_baseline.sql:12`. No additional standalone types or operators returned for public/private. | — |
| ADV-AUTH-01 | DB | Leaked-password protection | FAIL | Current security advisor still reports `auth_leaked_password_protection`, WARN, matching `docs/DB_AUDIT.md:92`. | Enable compromised-password protection if supported by the plan. |
| DB-ADV | DB | Security and performance advisors rerun | PASS | Advisor tools returned 18 security findings and 29 performance findings. Prior audit recorded 15 and 28 respectively. Findings grouped below. `docs/DB_AUDIT.md:130`. | Review warning scope and usage before changes. |
| EDGE-DEPLOY | Edge | Deployed functions, status, JWT setting and current source | PASS | `handoff-brief` v9 and `home-digest` v7 are ACTIVE with `verify_jwt=true`. All four returned source files match byte-for-byte as decoded text. Handoff includes `index.ts`, `handler.mjs` and `_shared/handoff-content.mjs`. Deployed digest source declares HTTP 410 and has no provider call. `supabase/functions/home-digest/index.ts:1`. | Confirm gateway and CORS behavior with synthetic requests in the owner smoke test. |
| EDGE-SECRET-01 | Edge | Required secret name and inventory of other names | UNKNOWN | The connected Supabase plugin has no Edge secret-name listing capability. No authenticated CLI was available. | Owner checks the Edge Secrets name column and reports whether `ALLOWED_ORIGINS` is listed and which other names exist. |
| EDGE-SECRET-02 | Edge | `GEMINI_API_KEY` and `HANDOFF_BRIEF_ENABLED` absent | UNKNOWN | Source checks both settings. Secret names and global enablement are unverified. `supabase/functions/handoff-brief/handler.mjs:150`, `:162`. | Confirm both names are absent before the smoke test. |
| EDGE-CORS | Edge | Live `ALLOWED_ORIGINS` content | UNKNOWN | No safe single-setting read through the plugin. Exact origin matching was verified in the local mock suite. `supabase/functions/handoff-brief/handler.mjs:142`, `docs/BATCH_C.md:21`. | Owner checks the exact production origin is present and flags any wildcard or trailing slash, without sharing the setting value. |
| FE-SYNTAX | Frontend | Syntax for all browser scripts and Edge sources | PASS | Node 24.22.3 plain `--check` passed 15 browser JS, two Edge MJS and the digest TS. Plain `--check` rejects the TypeScript annotation at `supabase/functions/handoff-brief/index.ts:5`. Node's built-in `stripTypeScriptTypes` followed by `node --input-type=module --check` passed in memory. | — |
| FE-DIGEST | Frontend | No retired function or table references in browser JS/HTML | PASS | Case-insensitive search for `home[-_]digest` returned zero matches in both scopes. Home builds and renders the local brief at `js/home.js:556`, `:619`, and removes the old AI footer at `:542`. | — |
| FE-TIME-01 | Frontend | Manila dates for shifts, on-duty, doses and overdue calculations | PASS | Calendar, circle board/duty, Home, Circles and medication use `KalinTime` for wall-clock calculations. See every date/clock search hit below and `tests/batch-b-frontend.test.cjs:134`. | — |
| FE-TIME-02 | Frontend | Home date header and dose undo clock | FAIL | `dashboard.html:71` uses a device-zone date set once in `js/dashboard.js:57`. It can disagree with the Manila day. `js/medication.js:39` uses a separate device clock for Undo eligibility. Elapsed time is zone-independent, but device clock skew can show or hide Undo incorrectly while the server uses its own clock. | Use the shared Manila day for the header and address client/server clock skew in eligibility display. |
| FE-TIME-03 | Frontend | Home rolls over time-sensitive care status while open | FAIL | `js/home.js:85` captures one current instant per load. `:170`, `:366`, `:386` use that snapshot for urgency, next shifts and duty. Home has no minute refresh like `js/circle.js:949`. | Refresh time-dependent Home state across slot and day boundaries. |
| FE-ERR-01 | Frontend | Every documented Batch B error code has safe text | PASS | All 17 codes listed in `docs/BATCH_B.md:39` through `:55` map to fixed copy in `js/pharmacy-core.js:165` through `:181`. Tests at `tests/batch-b-frontend.test.cjs:163` check exact codes and generic fallback. The owner invariant code is migration-only. | — |
| FE-ERR-02 | Frontend | Unknown errors never show raw backend text | FAIL | Raw Auth message fallback flows to visible UI at `js/login.js:140`, `:205`, `:225` and `js/reset-password.js:101`. Dashboard matches messages for classification only (`js/dashboard.js:125`, `:131`). Care RPC and Edge UI paths use fixed copy, including the numeric-pattern stock message (`js/pharmacy-core.js:199`, `:205`, `js/circle.js:192`). | Use generic fallbacks for unknown Auth errors. |
| FE-NAME-01 | Frontend | Assignment snapshot selection and display | PASS | Calendar selects and prefers `assigned_name` at `js/calendar.js:113`, `:130`, with history handling at `:253`. Circle duty selects at `js/circle.js:640` and prefers at `:608`. Home selects at `js/home.js:126`, `:128` and prefers at `:378`. Circles selects at `js/circles.js:87` and prefers at `:101`. Circle board selects the column at `js/circle.js:764` and lists only open rows at `:766`, so it has no assignee label to prefer. | — |
| FE-NAME-02 | Frontend | Neutral signup fallback is testable and consistent in UI | FAIL | Normal signup requires a full name at `js/login.js:158`. Signed-in self labels can still fall back to the email local part in `js/dashboard.js:15`, `js/calendar.js:840`, `js/circle.js:611` and `js/home.js:381`. The live database fallback passed separately. | Verify the DB fallback using a synthetic Auth signup without metadata and align any self-label fallback with the intended privacy behavior. |
| FE-SHIFT-01 | Frontend | Started-shift Volunteer and Release gating | PASS | Calendar disables both actions and rechecks on click (`js/calendar.js:169`, `:272`, `:311`). Circle board disables Volunteer and rechecks (`js/circle.js:671`, `:701`, `:739`), with no Release control. Home filters started shifts on render and its list has no mutation controls (`js/home.js:364`, `dashboard.html:138`). | Smoke-test an open screen at Manila slot start. |
| FE-KEYS | Frontend | Credential scan of browser source | PASS | No service-role or Gemini key, private key, or JWT credential was found in browser JS/HTML. `js/supabase.js:7` contains the expected publishable browser credential. No credential strings are reproduced here. | — |
| FE-HTML | Frontend | All HTML parsing sinks checked | PASS | Ten HTML writes in three JS files, inventoried below. No user text reaches any reviewed HTML parsing sink. | — |
| FE-AI-GATE | Frontend | Handoff brief hidden or disabled when circle AI is off | FAIL | Button is enabled in `circle.html:71` and appended unconditionally at `js/circle.js:885`. Busy-state handling at `:241` ignores consent. `:440` does stop preview/send after click, and the server enforces consent. Generate summary has the same affordance at `:238`, `:382`. | Hide or disable both AI actions based on loaded consent and update after the owner changes it. |
| FE-AI-PREVIEW | Frontend | Preview, explicit confirmation, and owner toggle | PASS | Owner action calls `set_circle_ai_enabled` at `js/circle.js:285`, `:294`. Preview dialog at `circle.html:194`, note count/date/excerpt/full text at `js/circle.js:424`, explicit confirm/send at `:477`. | — |
| TEST-JS | Repo | Pure-JS suites | PASS | All 16 tests passed via `node --test tests/batch-b-frontend.test.cjs supabase/tests/batch_c_handoff.test.mjs`. Both suites use local mocks/synthetic fixtures. | — |
| TEST-BROWSER | Repo | Batch C mock-client browser suite | UNKNOWN | `playwright-core` does not resolve. No browser harness override is configured. The route allowlist also omits `/js/kalin-time.js`, now required by the current page scripts. `supabase/tests/batch_c_browser.mjs:6`, `:110`, `:112`, `circle.html:353`, `dashboard.html:252`. | Update the mock allowlist and rerun with an installed Playwright/Chromium harness. |
| REPO-STATUS | Repo | Working-tree changes and sensitive artifact names | FAIL | 20 modified tracked files and 34 pre-existing untracked files. Supabase CLI metadata includes project linkage and a pooler URL under unignored `supabase/.temp/`. No env files, token files, dumps or `supabase/.branches/` were found in the filename scan. `.gitignore:6` ignores `node_modules/` and `:7` ignores only `.env` by name. Full status below. | Exclude Supabase scratch and branch directories from Git. Keep any env variants private. |
| REPO-README | Repo | Setup, schema, Manila behavior, AI and notes status | FAIL | Existing local README is ignored and substantially stale. Specific statements and omissions below. | Reconcile the contributor guide with the baseline, Batches A–C and the hosted smoke-test status. |

## Catalog details

### Live routine ACLs

These are the catalog `proacl` values for the new or changed bodies and the four Batch A search-path changes. PostgreSQL ACL `X` denotes EXECUTE.

| Routines | Live `proacl` |
| --- | --- |
| `private.batch_a_valid_medication_times`, `private.batch_a_valid_medication_weekdays`, `public.adjust_pharmacy_stock`, `public.claim_shift`, `public.create_pharmacy_item`, `public.is_circle_member`, `public.manila_now`, `public.manila_today`, `public.mark_dose_taken`, `public.owns_circle`, `public.release_shift`, `public.request_to_join`, `public.undo_dose` | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |
| `private.batch_b_guard_circle_creator`, `private.batch_b_guard_owner_delete`, `private.batch_b_guard_owner_membership`, `private.batch_b_guard_shift_date`, `private.batch_b_shift_accepts_changes`, `private.batch_b_shift_slot_hours`, `private.release_departing_member_shifts` | `{postgres=X/postgres}` |
| `public.add_circle_owner`, `public.add_circle_owner_membership`, `public.handle_new_user`, `public.pharmacy_actor_name` | `{postgres=X/postgres,service_role=X/postgres}` |
| `public.reserve_ai_generation`, `public.set_circle_ai_enabled` | `{postgres=X/postgres,authenticated=X/postgres}` |

### Advisor findings

- **Security WARN (1)**. Leaked-password protection is still disabled, as in ADV-AUTH-01. [Supabase Auth password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- **Security WARN (16)**. Authenticated EXECUTE on public SECURITY DEFINER routines. `adjust_pharmacy_stock`, `claim_shift`, `create_circle`, `create_pharmacy_item`, `is_circle_member`, `is_circle_owner`, `mark_dose_taken`, `owns_circle`, `pharmacy_is_owner`, `release_shift`, `request_to_join`, `reserve_ai_generation`, `respond_to_join_request`, `set_circle_ai_enabled`, `shares_circle_with`, `undo_dose`. The two new consent/quota RPCs account for the increase from 14, and the warning is distinct from the PUBLIC/anon grant check. [Supabase linter 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- **Security INFO (1)**. `private.ai_generation_reservations` has RLS and zero policies, consistent with private table access through the RPC. [Supabase linter 0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- **Performance WARN (11)**. Per-row Auth evaluation in these RLS policies. `circles` (members read circles, users create circles, owner updates circle, owner deletes circle); `circle_members` (leave circle); `profiles` (Read own and circle-mates profiles, Update own profile); `shifts` (Owners can create shifts); `care_notes` (Authors can delete their notes, Members can add notes); `circle_join_requests` (Requester or circle owner can view requests). [Supabase linter 0003](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan)
- **Performance INFO (15)**. Foreign keys without covering indexes. `ai_log_created_by_fkey`, `care_notes_author_id_fkey`, `circle_join_requests_user_id_fkey`, `circle_tasks_created_by_fkey`, `circles_created_by_fkey`, `medication_doses_item_id_fkey`, `medication_doses_taken_by_fkey`, `medication_doses_undone_by_fkey`, `medication_schedules_created_by_fkey`, `medication_schedules_item_id_fkey`, `pharmacy_items_created_by_fkey`, `shifts_created_by_fkey`, `stock_movements_circle_id_fkey`, `stock_movements_created_by_fkey`, `stock_movements_dose_id_fkey`. [Supabase linter 0001](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
- **Performance INFO (3)**. `medication_doses_circle_day`, `ai_generation_reservations_user_at`, `ai_generation_reservations_circle_at` reported unused. [Supabase linter 0005](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

## Frontend grep evidence

Searches covered browser JS and HTML. The clock search found no `getDate(` or `getHours(` calls. An unqualified `new Date()` supplies an absolute instant. Its handling below determines whether device time-zone conversion leaks into the result. Absolute time from the browser can still be skewed.

| Clock evidence | Verdict |
| --- | --- |
| `js/kalin-time.js:14`, `:29`, `:31`, `:36`, `:37`, `:58`, `:67` | OK. Shared Manila formatting, UTC carrier dates, slot instants, cutoff and minute timer. |
| `js/calendar.js:64`, `:707` | OK. ISO slicing and parsing round-trip a UTC carrier representing a Manila calendar date. |
| `js/calendar.js:329`, `:466`, `:685` | OK. Instants are passed to Manila helpers for day and shift cutoffs. |
| `js/circles.js:81`, `js/circle.js:634`, `:702`, `js/home.js:85` | OK for zone conversion. Instants go through shared Manila logic. Home retains the computed state until reload or another refresh event. |
| `js/dashboard.js:59` | Bug. Home displays a browser-local calendar date. |
| `js/medication.js:39` | Bug for skew and shared-clock consistency. Raw device elapsed-time comparison controls Undo visibility. |
| `js/circle.js:11`, `:98`, `:227`, `:663` | OK. Stored timestamps formatted with Manila, membership instants sorted by epoch, and board calendar dates formatted from a UTC carrier. |
| `js/home.js:414` | OK. Stored activity timestamp is formatted with the Manila formatter at `:317`. |
| `js/pharmacy-core.js:64`, `:68`, `:79`, `:85`, `js/todo.js:118` | OK. Synthetic UTC calendar carriers for dates/weekdays, Manila formatting for stored timestamps. |

| HTML sink | Can user text reach it? |
| --- | --- |
| `js/calendar.js:412` | No. Grid markup uses date-derived labels and class flags, fixed slot metadata and SVG. Shift text is added through DOM creation at `:284` and `:413`. |
| `js/calendar.js:462` | No. Fixed check SVG. Circle names and counts use DOM text at `:461`. |
| `js/calendar.js:477` | No. Static drawer template. Circle labels use DOM text at `:491`. |
| `js/calendar.js:620` | No. Empty string clears grid. |
| `js/circle.js:151` | No. Fixed gear SVG. |
| `js/circle.js:160` | No. Owner state selects a fixed trash or leave SVG. |
| `js/dashboard.js:159` | No. Fixed copy SVG. Invite code is added as text at `:160`. |
| `js/dashboard.js:197` | No. Drawer template interpolates a fixed plus SVG. |
| `js/dashboard.js:254` | No. Both callers pass fixed state icon constants at `:333` and `:343`. |
| `js/dashboard.js:311` | No. Fixed plus SVG. |

No `outerHTML` assignments or HTML-file inline sinks were found. `js/dashboard.js:104` is a comment. AI preview excerpts and full text are set through text nodes at `js/circle.js:461` and `:464`.

## Repository details

### Git status

Branch `Forge` tracks `origin/Forge`. The list is the pre-report status. This audit adds only `docs/VERIFY.md`.

```text
 M calendar.html
 M circle.html
 M circles.html
 M css/app-ui.css
 M css/circle.css
 M dashboard.html
 M js/calendar.js
 M js/circle.js
 M js/circles.js
 M js/dashboard.js
 M js/home.js
 M js/medication.js
 M js/pharmacy-core.js
 M js/pharmacy.js
 M js/todo.js
 M login.html
 M pharmacies.html
 M pharmacy.html
 M reset-password.html
 M supabase/functions/home-digest/index.ts
?? docs/BATCH_A.md
?? docs/BATCH_B.md
?? docs/BATCH_C.md
?? docs/DB_AUDIT.md
?? docs/REVIEW.md
?? js/kalin-time.js
?? supabase/.temp/cli-latest
?? supabase/.temp/gotrue-version
?? supabase/.temp/linked-project.json
?? supabase/.temp/pooler-url
?? supabase/.temp/postgres-version
?? supabase/.temp/project-ref
?? supabase/.temp/rest-version
?? supabase/.temp/storage-migration
?? supabase/.temp/storage-version
?? supabase/functions/_shared/handoff-content.mjs
?? supabase/functions/handoff-brief/handler.mjs
?? supabase/functions/handoff-brief/index.ts
?? supabase/migrations/0000_baseline.sql
?? supabase/migrations/20261123090000_batch_a_hardening.sql
?? supabase/migrations/20261123100000_batch_b_behavior.sql
?? supabase/migrations/20261123110000_batch_c_ai_privacy.sql
?? supabase/migrations/manual/batch_a_rollback.sql
?? supabase/migrations/manual/batch_a_validate.sql
?? supabase/migrations/manual/batch_b_rollback.sql
?? supabase/migrations/manual/batch_c_rollback.sql
?? supabase/tests/batch_a_hardening.sql
?? supabase/tests/batch_b_behavior.sql
?? supabase/tests/batch_b_concurrency.mjs
?? supabase/tests/batch_c_ai_privacy.sql
?? supabase/tests/batch_c_browser.mjs
?? supabase/tests/batch_c_handoff.test.mjs
?? supabase/tests/batch_c_reservation_races.mjs
?? tests/batch-b-frontend.test.cjs
js/todo.js:4:  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
js/dashboard.js:104:/* Builds an element. Text is always set with textContent, never innerHTML,
js/dashboard.js:159:  chip.innerHTML = ICON_COPY;
js/dashboard.js:197:  group.innerHTML = `
js/dashboard.js:254:  iconWrap.innerHTML = icon;
js/dashboard.js:311:  card.innerHTML = ICON_PLUS;
js/home.js:10:  const dayLabel = new Intl.DateTimeFormat(undefined, {
js/home.js:317:  const activityDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: Time.zone });
js/circle.js:151:    button.innerHTML = ICON_GEAR;
js/circle.js:160:    action.innerHTML = owner ? ICON_TRASH : ICON_LEAVE;
js/calendar.js:412:  grid.innerHTML = html;
js/calendar.js:462:  button.insertAdjacentHTML('beforeend', VIEW_ICON_CHECK);
js/calendar.js:477:  drawer.innerHTML = `
js/calendar.js:620:    $('week-grid').innerHTML = '';
119:      { filename: name + '.js' });
184:    shift('started'), shift('available', { slot: 'evening', assigned_name: 'Old snapshot' }),
185:    shift('mine', { assigned_to: user.id, assigned_name: 'Snapshot <Volunteer>', profiles: { full_name: 'Other name' } }),
187:    shift('past', { shift_date: '2026-11-22', assigned_name: 'Past Volunteer' })
192:  assert.match(app.queries.find(query => query.table === 'shifts').calls[0][1], /assigned_name/);
229:  const duty = shift('duty', { assigned_to: user.id, assigned_name: 'Duty Snapshot', profiles: { full_name: 'Other name' } });
269:  const duty = shift('duty', { assigned_to: user.id, assigned_name: 'Snapshot Name', profiles: { full_name: 'Other name' } });
355:  app.element('item-name').value = item.name;
373:    const scripts = [...read(file + '.html').matchAll(/<script src="js\/([^"]+)"/g)].map(([, name]) => name);
```

`supabase/.temp/` is unexpected in the untracked set. Its files' contents are omitted. The batch docs, SQL, and tests are also untracked and would need to be intentionally included for a reviewable rollout. README exists locally and is excluded by `.gitignore:8`.

### README drift

- **Setup and deployment.** The setup instructions name absent standalone SQL scripts and a single-file dashboard paste. The current checkout has a baseline for new environments and ordered Batch A/B/C forward migrations. Handoff deploys with its handler and shared minimizer, and the browser needs that shared module at its relative path. Home Digest is retired with JWT verification retained. `README.md:30`, `:53`, `:84`, `:116`, `:123`, `:127`, `:137`, `docs/BATCH_C.md:19`.
- **Tables, functions and grants.** Document `private.ai_generation_reservations`, `circles.ai_enabled`, `ai_log.verified_generation`, `shifts.assigned_name`, legacy `home_digests`, `manila_today()`, `manila_now()`, `set_circle_ai_enabled` and `reserve_ai_generation`. Describe member reads and service-side AI log writes, current-membership note deletion, shift/ownership guards, the schedule checks, and per-routine PUBLIC EXECUTE revocation. `README.md:41`, `:49`, `:52`, `:109`, `docs/BATCH_A.md:23`, `docs/BATCH_C.md:7`.
- **Calendar, membership and time.** Reconcile the device-time claims and profile-only assignment labels with Manila wall time, stored snapshots, claim/release cutoffs, member departure, and approval-based join requests. `README.md:48`, `:64`, `:65`, `:74`, `:75`, `:118`, `:126`, `:142`.
- **AI workflow and status.** Replace the old 50-note direct generation and log-based cooldown description with preview/confirmation, minimization, owner and deployment gates, private reservation quotas, server-only draft writes, exact CORS settings, deterministic Home brief and retired endpoint. Both Edge functions are deployed. Global enablement, allowed origins and real-account behavior are unverified. Remove the unconditional instruction to set Gemini secrets for rollout. `README.md:15`, `:67`, `:81`, `:87`, `:117`, `docs/BATCH_C.md:8`, `:17`.
- **Notes and test coverage.** Keep the existing note-list/delete limitation explicit in the current feature list. The app supports Add note and previewing selected notes inside AI confirmation. The AI log is a draft list. Individual note browsing/deletion has no UI. The README's claim that SQL was never exercised is stale given the recorded disposable tests and current catalog evidence. `README.md:69`, `:79`, `:90`, `:119`, `js/circle.js:376`, `:455`, `:530`, `docs/BATCH_B.md:66`, `docs/BATCH_C.md:27`.

## Failed or unknown

1. **Privacy rollout gate.** Supabase secret names and production CORS configuration are unverified (EDGE-SECRET-01, EDGE-SECRET-02, EDGE-CORS). The circle exposes AI buttons before opt-in even though the send path checks consent (FE-AI-GATE).
2. **Care-time display.** Home can show the device day and retain stale due/overdue, upcoming shift and on-duty status. The dose Undo affordance depends on the device clock (FE-TIME-02, FE-TIME-03).
3. **Auth and display privacy.** Leaked-password protection remains off. Login/reset can display raw Auth errors. Signup requires a name in the normal UI, and several self labels can fall back to an email-derived name (ADV-AUTH-01, FE-ERR-02, FE-NAME-02).
4. **Clock specification.** Live `manila_now()` is volatile by design in the applied SQL. The request expects stable, which should be reconciled without weakening the check after locks (B-TIME-02).
5. **Verification and repository hygiene.** The browser suite could not run and its allowlist is stale. Linked CLI metadata is unignored and the contributor guide has outdated setup and AI instructions (TEST-BROWSER, REPO-STATUS, REPO-README).

## Needs a human with real accounts

Use dedicated owner, member, and outsider accounts with a synthetic circle and fictional care notes. Keep provider enablement off for the smoke test.

- [ ] Confirm the expected Edge secret names, exact production origin, and disabled provider configuration. Confirm a new circle defaults to AI off and no Gemini request is made when it stays off. Check that an outsider cannot change consent and only the owner can toggle it.
- [ ] Confirm owner and member can read their circle's allowed care data, and the outsider cannot read or mutate it. Verify an approved join creates a member and that only the owner has owner controls.
- [ ] Before a Manila slot starts, claim and release it as the assigned member. At and after 07:00 or 15:00 Manila time, check that Volunteer/Release are unavailable and the server rejects stale actions. Check the same display with a browser set to another time zone.
- [ ] Have two members claim the same open shift together. Exactly one gets it and the other's UI refreshes with a safe message.
- [ ] Mark and undo a fictional dose. Check duplicate suppression, active schedule/item rules, stock history, the member's 15-minute limit, and the owner's authorized undo.
- [ ] Leave as a member with historical, completed-today, unfinished-today and future assignments. Verify past and completed-today snapshots stay visible and unfinished-today and future assignments reopen. Verify the owner cannot leave.
- [ ] Sign up a dedicated synthetic account without name metadata through an approved Auth test flow. Verify its profile displays `Member`. The normal web signup currently requires a full name.
- [ ] Check the deployed frontend can load the shared preview module and that canceling preview makes zero Edge calls when preview testing is available with provider access kept off.

**Fix these first**
