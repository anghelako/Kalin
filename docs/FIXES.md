# Kalin frontend fixes

| Verify item | Files | Result |
| --- | --- | --- |
| FE-AI-GATE | `circle.html`, `js/circle.js` | Handoff brief and Generate summary are hidden until the loaded circle has `ai_enabled = true`. The owner can change consent in Circle settings, and both actions update as soon as the change succeeds. Members can read saved summaries and add notes with AI off. After an `ai_disabled` response, the UI says “AI drafts aren't available yet.” and hides both actions for the signed-in user's tab session, including reloads when session storage is available. The Edge Function uses the same code for deployment disablement and circle disablement, so either response locks the actions for that session. |
| FE-TIME-03 | `js/home.js` | A visible Home tab updates urgency, dose status, upcoming shifts, on-duty labels, and day-dependent progress. Minute ticks reuse the loaded data within the day. Slot and day changes refresh the relevant query ranges. The timer pauses while hidden and updates as soon as the tab becomes visible. |
| FE-TIME-02 | `dashboard.html`, `js/dashboard.js`, `js/kalin-time.js`, `js/medication.js`, `js/calendar.js`, `js/circle.js`, `js/circles.js`, `js/home.js` | The Home header follows the Manila date at midnight. The app measures the server offset once per authenticated page load using `manila_now` in the background. Shift and dose decisions share the corrected clock, with a zero-offset fallback if the call fails. The Undo RPC remains authoritative for the 15-minute window and its rejection copy is preserved. |
| FE-ERR-02 | `js/login.js`, `js/reset-password.js` | Unknown Auth errors use “Something went wrong. Please try again.” Known cases keep their specific copy. |
| FE-NAME-02 | `js/dashboard.js`, `js/calendar.js`, `js/circle.js`, `js/home.js` | Missing or blank display names use “Member,” including self labels. |
| TEST-BROWSER | `supabase/tests/batch_c_browser.mjs` | The mock harness serves `/js/kalin-time.js` and checks consent, saved history, session disablement, note saving, slot changes, and midnight rollover after returning to a hidden tab. |
| REPO-STATUS | `.gitignore` | All five patterns were already present and matched sample paths. `git ls-files supabase/.temp` returned no paths. |

## Verification

- `node --check` passed for all 10 edited JS and MJS files.
- `node --test tests/batch-b-frontend.test.cjs supabase/tests/batch_c_handoff.test.mjs` passed all 16 existing tests.
- Five additional in-memory checks passed for AI gating, one-time clock correction and Undo, Home's cached minute updates and visibility rollover, the Manila header, and Auth error copy.
- The mock browser run stopped at import with `ERR_MODULE_NOT_FOUND` for `playwright-core`. Install commands for a future run are `npm install --no-save --no-package-lock playwright-core` and `npx playwright-core install chromium`.
- Verification used synthetic data and mocks. The deployment setting, live RPC results, live Auth, and live data were outside this verification.
