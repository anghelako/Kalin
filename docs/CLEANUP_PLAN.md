# Kalin cleanup plan

## Scope and status

Phase 1 inventory only. Before this report, the working tree contained 60 files in scope. Git listed 33 tracked files, including 23 modified files, and 27 untracked files. The inventory includes this report. No files were moved or deleted.

The inventory uses `git status --short --untracked-files=all`, `git ls-files`, and `rg --files --hidden --no-ignore`. It excludes `.git`, `node_modules`, and `supabase/.temp`. The references column shows up to three other files with a case-insensitive literal path or basename match in HTML, `js/`, `css/`, `supabase/`, `tests/`, and `README.md`. No package files were present. The two `index.ts` paths were matched with their parent directories to avoid attributing references to the wrong Edge Function. “None” means the scoped search found no literal match. Dynamic references include HTML and JS paths constructed by the Batch B test at `tests/batch-b-frontend.test.cjs:115–122,373` and deployment entrypoints resolved by function directory.

There are 44 KEEP, 17 ARCHIVE, zero DELETE, and zero ASK entries. No generated junk or unreferenced assets surfaced in scope. The live Supabase project was untouched.

## File inventory

| Path | Bytes | Git status | Referenced by | Class | Reason |
| --- | ---: | --- | --- | --- | --- |
| `.gitignore` | 119 | Tracked, modified | none | KEEP | Repository ignore rules. |
| `calendar.html` | 11400 | Tracked, modified | `circle.html`, `circles.html`, `dashboard.html` | KEEP | Application page. |
| `circle.html` | 15649 | Tracked, modified | `css/pharmacy.css`, `js/circles.js`, `js/dashboard.js` | KEEP | Application page. |
| `circles.html` | 7650 | Tracked, modified | `calendar.html`, `circle.html`, `dashboard.html` | KEEP | Application page. |
| `css/app-ui.css` | 35158 | Tracked, modified | `calendar.html`, `circle.html`, `circles.html` | KEEP | Stylesheet referenced by application pages. |
| `css/calendar.css` | 11444 | Tracked | `calendar.html`, `README.md` | KEEP | Stylesheet referenced by application pages. |
| `css/circle.css` | 11332 | Tracked, modified | `circle.html`, `pharmacy.html`, `css/dashboard.css` | KEEP | Stylesheet referenced by application pages. |
| `css/dashboard.css` | 19230 | Tracked | `calendar.html`, `circle.html`, `circles.html` | KEEP | Stylesheet referenced by application pages. |
| `css/login.css` | 12920 | Tracked | `calendar.html`, `circle.html`, `circles.html` | KEEP | Stylesheet referenced by application pages. |
| `css/pharmacy.css` | 9786 | Tracked | `circle.html`, `pharmacies.html`, `pharmacy.html` | KEEP | Stylesheet referenced by application pages. |
| `dashboard.html` | 12001 | Tracked, modified | `calendar.html`, `circle.html`, `circles.html` | KEEP | Application page. |
| `docs/BATCH_A.md` | 4634 | Untracked | none | ARCHIVE | Batch A implementation notes. |
| `docs/BATCH_B.md` | 10456 | Untracked | `tests/batch-b-frontend.test.cjs` | ARCHIVE | Batch B notes and retained-test fixture. |
| `docs/BATCH_C.md` | 6388 | Untracked | none | ARCHIVE | Batch C implementation notes. |
| `docs/CLEANUP_PLAN.md` | 17406 | Untracked | none | KEEP | Active approval record for this cleanup. |
| `docs/DB_AUDIT.md` | 48366 | Untracked | none | ARCHIVE | Database audit report. |
| `docs/FIXES.md` | 3036 | Untracked | none | ARCHIVE | Frontend fixes and test report. |
| `docs/REVIEW.md` | 25793 | Untracked | none | ARCHIVE | Repository review notes. |
| `docs/VERIFY.md` | 33782 | Untracked | none | ARCHIVE | Batch verification report. |
| `images/favicon.png` | 14391 | Tracked | `calendar.html`, `circle.html`, `circles.html` | KEEP | Asset referenced by application pages. |
| `images/kalin-logo.png` | 64270 | Tracked | `calendar.html`, `circle.html`, `circles.html` | KEEP | Asset referenced by application pages. |
| `js/calendar.js` | 24142 | Tracked, modified | `calendar.html`, `js/dashboard.js`, `js/pharmacy-core.js` | KEEP | Referenced frontend script. |
| `js/circle.js` | 39157 | Tracked, modified | `circle.html`, `js/dashboard.js`, `js/medication.js` | KEEP | Referenced frontend script. |
| `js/circles.js` | 5408 | Tracked, modified | `circles.html` | KEEP | Referenced frontend script. |
| `js/dashboard.js` | 26435 | Tracked, modified | `calendar.html`, `circle.html`, `circles.html` | KEEP | Referenced frontend script. |
| `js/home.js` | 28994 | Tracked, modified | `calendar.html`, `circle.html`, `circles.html` | KEEP | Referenced frontend script. |
| `js/kalin-time.js` | 3689 | Untracked | `calendar.html`, `circle.html`, `circles.html` | KEEP | Referenced frontend script. |
| `js/login.js` | 7994 | Tracked, modified | `login.html`, `README.md` | KEEP | Referenced frontend script. |
| `js/medication.js` | 21232 | Tracked, modified | `circle.html`, `js/circle.js`, `README.md` | KEEP | Referenced frontend script. |
| `js/pharmacies.js` | 4615 | Tracked | `pharmacies.html` | KEEP | Referenced frontend script. |
| `js/pharmacy-core.js` | 9413 | Tracked, modified | `calendar.html`, `circle.html`, `circles.html` | KEEP | Referenced frontend script. |
| `js/pharmacy.js` | 21964 | Tracked, modified | `pharmacy.html`, `README.md` | KEEP | Referenced frontend script. |
| `js/reset-password.js` | 3527 | Tracked, modified | `reset-password.html`, `README.md` | KEEP | Referenced frontend script. |
| `js/shell.js` | 1487 | Tracked | `circles.html`, `dashboard.html`, `pharmacies.html` | KEEP | Referenced frontend script. |
| `js/supabase.js` | 845 | Tracked | `calendar.html`, `circle.html`, `circles.html` | KEEP | Referenced frontend script. |
| `js/todo.js` | 10151 | Tracked, modified | `circle.html`, `README.md` | KEEP | Referenced frontend script. |
| `login.html` | 8161 | Tracked, modified | `reset-password.html`, `js/dashboard.js`, `README.md` | KEEP | Application page. |
| `pharmacies.html` | 7441 | Tracked, modified | `circle.html`, `circles.html`, `pharmacy.html` | KEEP | Application page. |
| `pharmacy.html` | 14659 | Tracked, modified | `css/pharmacy.css`, `js/home.js`, `js/medication.js` | KEEP | Application page. |
| `README.md` | 18781 | Tracked | none | KEEP | Project README. |
| `reset-password.html` | 4671 | Tracked, modified | `js/supabase.js`, `README.md` | KEEP | Application page. |
| `supabase/functions/_shared/handoff-content.mjs` | 3763 | Untracked | `js/circle.js`, `supabase/functions/handoff-brief/handler.mjs`, `supabase/tests/batch_c_browser.mjs` | KEEP | Shared content used by frontend and Edge code. |
| `supabase/functions/handoff-brief/handler.mjs` | 10832 | Untracked | `supabase/functions/handoff-brief/index.ts`, `supabase/tests/batch_c_handoff.test.mjs` | KEEP | Handoff Edge Function source or handler. |
| `supabase/functions/handoff-brief/index.ts` | 304 | Untracked | `README.md` | KEEP | Handoff Edge Function source or handler. |
| `supabase/functions/home-digest/index.ts` | 295 | Tracked, modified | none | KEEP | Deployed 410 stub pending undeployment confirmation. |
| `supabase/migrations/0000_baseline.sql` | 59964 | Untracked | none | KEEP | Migration baseline. |
| `supabase/migrations/20261123090000_batch_a_hardening.sql` | 10389 | Untracked | none | KEEP | Versioned Batch A, B, or C migration. |
| `supabase/migrations/20261123100000_batch_b_behavior.sql` | 21443 | Untracked | none | KEEP | Versioned Batch A, B, or C migration. |
| `supabase/migrations/20261123110000_batch_c_ai_privacy.sql` | 4612 | Untracked | none | KEEP | Versioned Batch A, B, or C migration. |
| `supabase/migrations/manual/batch_a_rollback.sql` | 7533 | Untracked | none | ARCHIVE | Manual Batch A rollback. |
| `supabase/migrations/manual/batch_a_validate.sql` | 322 | Untracked | none | ARCHIVE | Manual Batch A validation. |
| `supabase/migrations/manual/batch_b_rollback.sql` | 11041 | Untracked | none | ARCHIVE | Manual Batch B rollback. |
| `supabase/migrations/manual/batch_c_rollback.sql` | 834 | Untracked | none | ARCHIVE | Manual Batch C rollback. |
| `supabase/tests/batch_a_hardening.sql` | 18145 | Untracked | none | ARCHIVE | Batch A database verification. |
| `supabase/tests/batch_b_behavior.sql` | 21853 | Untracked | none | ARCHIVE | Batch B database behavior checks. |
| `supabase/tests/batch_b_concurrency.mjs` | 6711 | Untracked | none | ARCHIVE | Batch B database concurrency harness. |
| `supabase/tests/batch_c_ai_privacy.sql` | 6179 | Untracked | none | ARCHIVE | Batch C database privacy checks. |
| `supabase/tests/batch_c_browser.mjs` | 15924 | Untracked | none | ARCHIVE | Batch C mock browser harness explicitly selected for archiving. |
| `supabase/tests/batch_c_handoff.test.mjs` | 9584 | Untracked | none | KEEP | Passing pure-JS suite retained by request. |
| `supabase/tests/batch_c_reservation_races.mjs` | 4375 | Untracked | none | ARCHIVE | Batch C database reservation race harness. |
| `tests/batch-b-frontend.test.cjs` | 18148 | Untracked | none | KEEP | Passing pure-JS suite retained by request. |

## Dead code candidates

The JavaScript check searched named declarations in `js/` and traced references across repo source. The CSS and markup checks included JavaScript-generated classes. SAFE candidates have static evidence of no live callers or matching elements. RISKY candidates require product or browser review.

| ID | Assessment | Location | Grep evidence |
| --- | --- | --- | --- |
| CODE-01 | SAFE | `js/circle.js:46–68` | A whole-word grep for `dutyCard`, `weekCard`, and `linkButton` finds only declarations for the two cards. The local link helper is called only by those cards at lines 59 and 66. The live layout uses `headerCard` and `circleGrid` at line 931. |
| CODE-02 | SAFE | `js/circle.js:10–15,70–113` | A whole-word grep for `membersCard`, `memberRow`, `memberName`, and `formatDate` finds only the `membersCard` declaration at line 95, its only call to `memberRow` at line 110, and that row's calls to the local name and date helpers at lines 82 and 88. The live settings menu still needs membership data. |
| CODE-03 | RISKY | `js/circle.js:115–131,983–1036`, `circle.html:160–191`, `css/dashboard.css:541,574,602,711`, `css/app-ui.css:648` | Grep for `settingsCard`, `openEdit`, and `edit-dialog` finds no caller for `settingsCard`. Its button at line 122 is the only caller of `openEdit`. The live `settingsMenu` is rendered at line 911. The disconnected dialog still has an owner edit submission handler, so confirm the product decision before removing the flow. Shared dialog selector lists need targeted edits. |
| CODE-04 | SAFE after matching producer removal | `css/circle.css:107–193` | Grep for `duty-row`, `duty-dot big`, `member-list`, `member-avatar`, `member-info`, `settings-actions`, and `btn-danger` finds only the style rules and legacy builders at `js/circle.js:54–55,81–87,109,118,124`. Remove the exact rules only after their matching producer is removed. The plain `.duty-dot` remains in use. |
| CODE-05 | SAFE | `css/dashboard.css:421–429` | A whole-token grep for `circle-badge` returns only the CSS rule, with no HTML or JavaScript producer. |
| CODE-06 | SAFE | `css/dashboard.css:120–131,139–142,159–161,684,733` | A whole-token grep for `collapsed` and `animating` returns only the old CSS drawer states. Calendar still uses `.chev` at `calendar.html:100`, and the rail's `.nav-toggle` at `js/dashboard.js:211–216` renders a plus SVG. |
| — | RISKY | `css/dashboard.css:12–201,651–691` | Six app pages render `<aside class="side">`. Grep finds the live rail markup and classes `.nav-group`, `.circle-drawer`, `.circle-list`, `.nav-toggle`, and `.circle-link` in `js/dashboard.js:201–255`. `css/app-ui.css:195–262,330–331` overrides portions of the cascade. Keep the generic sidebar rules pending a breakpoint review. |

## References affected by proposed moves

| Source | Target | Effect and proposed handling |
| --- | --- | --- |
| `tests/batch-b-frontend.test.cjs:131` (KEEP) | `docs/BATCH_B.md` (ARCH-05) | The test reads the report at startup and extracts exact expected friendly messages. Archiving the report alone would cause ENOENT. As part of ARCH-05, preserve the existing expected values in the retained test and rerun it. |

No other KEEP-to-ARCHIVE reference was found in the app, test suites, migrations, or README. There are no DELETE targets.

These archive candidates also cite other archive candidates. Partial approval can leave paths stale in any referrer that stays behind. Moving the referrer and target together preserves their relative layout.

| Target | Archive candidates that cite it |
| --- | --- |
| ARCH-01 `docs/DB_AUDIT.md` | ARCH-04 `docs/BATCH_A.md`, ARCH-05 `docs/BATCH_B.md`, ARCH-06 `docs/BATCH_C.md`, ARCH-02 `docs/VERIFY.md` |
| ARCH-04 `docs/BATCH_A.md` | ARCH-05 `docs/BATCH_B.md`, ARCH-02 `docs/VERIFY.md` |
| ARCH-05 `docs/BATCH_B.md` | ARCH-02 `docs/VERIFY.md` |
| ARCH-06 `docs/BATCH_C.md` | ARCH-02 `docs/VERIFY.md` |
| ARCH-07 `docs/REVIEW.md` | ARCH-02 `docs/VERIFY.md` |
| ARCH-08 `supabase/migrations/manual/batch_a_rollback.sql` | ARCH-04 `docs/BATCH_A.md`, ARCH-02 `docs/VERIFY.md` |
| ARCH-09 `supabase/migrations/manual/batch_a_validate.sql` | ARCH-04 `docs/BATCH_A.md`, ARCH-02 `docs/VERIFY.md` |
| ARCH-10 `supabase/migrations/manual/batch_b_rollback.sql` | ARCH-05 `docs/BATCH_B.md`, ARCH-02 `docs/VERIFY.md` |
| ARCH-11 `supabase/migrations/manual/batch_c_rollback.sql` | ARCH-06 `docs/BATCH_C.md`, ARCH-02 `docs/VERIFY.md` |
| ARCH-12 `supabase/tests/batch_a_hardening.sql` | ARCH-04 `docs/BATCH_A.md`, ARCH-02 `docs/VERIFY.md` |
| ARCH-13 `supabase/tests/batch_b_behavior.sql` | ARCH-05 `docs/BATCH_B.md`, ARCH-02 `docs/VERIFY.md` |
| ARCH-14 `supabase/tests/batch_b_concurrency.mjs` | ARCH-05 `docs/BATCH_B.md`, ARCH-02 `docs/VERIFY.md` |
| ARCH-15 `supabase/tests/batch_c_ai_privacy.sql` | ARCH-06 `docs/BATCH_C.md`, ARCH-02 `docs/VERIFY.md` |
| ARCH-16 `supabase/tests/batch_c_reservation_races.mjs` | ARCH-06 `docs/BATCH_C.md`, ARCH-02 `docs/VERIFY.md` |
| ARCH-17 `supabase/tests/batch_c_browser.mjs` | ARCH-06 `docs/BATCH_C.md`, ARCH-03 `docs/FIXES.md`, ARCH-02 `docs/VERIFY.md` |

### Pre-existing stale paths

The following paths were absent at inventory time. `README.md` cites `supabase/todo_setup.sql` (lines 30, 123), `supabase/pharmacy_setup.sql` (31, 137), `supabase/shifts_setup.sql` (32, 53, 88, 116), and `supabase/circles_join_setup.sql` (127). App code also mentions those setup files at `js/todo.js:28`, `js/pharmacy-core.js:22,162`, `js/calendar.js:98`, `js/circle.js:795,871`, and `js/dashboard.js:86,662`.

## Proposed actions for approval

“Approve all recommended” covers the ARCH rows and the test-reference fix in ARCH-05. CODE rows require explicit ID approval. The archive copy and verification steps are deferred to Phase 2.

| ID | Recommendation | Target | Proposed action |
| --- | --- | --- | --- |
| ARCH-01 | Recommended | `docs/DB_AUDIT.md` | Archive after verified copy. |
| ARCH-02 | Recommended | `docs/VERIFY.md` | Archive after verified copy. |
| ARCH-03 | Recommended | `docs/FIXES.md` | Archive after verified copy. |
| ARCH-04 | Recommended | `docs/BATCH_A.md` | Archive after verified copy. |
| ARCH-05 | Recommended | `docs/BATCH_B.md` | Archive after verified copy. Preserve the Markdown-derived expected messages in `tests/batch-b-frontend.test.cjs` before moving the report, then rerun the test. |
| ARCH-06 | Recommended | `docs/BATCH_C.md` | Archive after verified copy. |
| ARCH-07 | Recommended | `docs/REVIEW.md` | Archive after verified copy. |
| ARCH-08 | Recommended | `supabase/migrations/manual/batch_a_rollback.sql` | Archive after verified copy. |
| ARCH-09 | Recommended | `supabase/migrations/manual/batch_a_validate.sql` | Archive after verified copy. |
| ARCH-10 | Recommended | `supabase/migrations/manual/batch_b_rollback.sql` | Archive after verified copy. |
| ARCH-11 | Recommended | `supabase/migrations/manual/batch_c_rollback.sql` | Archive after verified copy. |
| ARCH-12 | Recommended | `supabase/tests/batch_a_hardening.sql` | Archive after verified copy. |
| ARCH-13 | Recommended | `supabase/tests/batch_b_behavior.sql` | Archive after verified copy. |
| ARCH-14 | Recommended | `supabase/tests/batch_b_concurrency.mjs` | Archive after verified copy. |
| ARCH-15 | Recommended | `supabase/tests/batch_c_ai_privacy.sql` | Archive after verified copy. |
| ARCH-16 | Recommended | `supabase/tests/batch_c_reservation_races.mjs` | Archive after verified copy. |
| ARCH-17 | Recommended | `supabase/tests/batch_c_browser.mjs` | Archive after verified copy. |
| CODE-01 | Explicit approval only | `js/circle.js` | Remove the unused duty and week cards and their local link helper. |
| CODE-02 | Explicit approval only | `js/circle.js` | Remove the unused members card and its private row, name, and date helpers. |
| CODE-03 | Explicit approval only, risky | `js/circle.js`, `circle.html`, `css/dashboard.css`, `css/app-ui.css` | Remove the unused settings card, disconnected owner edit dialog, handlers, and dialog-specific CSS selector branches. |
| CODE-04 | Explicit approval only | `css/circle.css` | Remove legacy styles associated with any approved matching producer removal in CODE-01, CODE-02, or CODE-03. |
| CODE-05 | Explicit approval only | `css/dashboard.css` | Remove the unused `.circle-badge` rule. |
| CODE-06 | Explicit approval only | `css/dashboard.css` | Remove the old drawer state rules and drawer chevron selector branches. |
