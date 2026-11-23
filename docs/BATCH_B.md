# Database behavior Batch B

Prepared 2026-11-23 against the [live schema audit](DB_AUDIT.md), [baseline](../supabase/migrations/0000_baseline.sql), and [Batch A](BATCH_A.md). All work and tests used local files and synthetic data. Production was untouched.

| Audit ID | Behavior |
|---|---|
| FN-01 / FN-04 | Current members can claim an open shift or release their own shift only before its Manila start. Both RPCs lock membership before the shift, read the clock after obtaining the locks, and use a conditional assignment update. Morning starts at 07:00 and evening at 15:00. |
| FN-03 / INT-07 | Leaving opens today’s unfinished shifts and all future shifts. Today’s morning shift is complete at 15:00 and today’s evening shift at 22:00. Completed and past shifts keep their assignment snapshot. Notes, doses, tasks, and saved AI briefs stay. |
| INT-08 | A before-insert trigger blocks dates before the current Manila day, including through calendar bulk creation. A shift on today’s date may still be created after its slot starts. |
| FN-02 | Scheduled doses must match an active schedule and active item, a configured wall-clock time, and the date range and frequency rule. The slot date cannot be after the Manila day. Valid slots earlier than today remain recordable. Insufficient stock still records and flags a dose, and as-needed doses still omit the slot fields. |
| FN-05 | Mark and undo acquire locks in membership, schedule, then stock order. Undo locks and rechecks the dose after stock. It still permits reversal after an item or schedule is stopped, subject to the existing actor and 15-minute rules. |
| FN-09 | Opening stock, thresholds, and adjustment amounts accept at most two decimal places and the storage maximum of 99,999,999.99. Add/remove require a positive amount, while opening, threshold and set allow zero. Ledger balances and deltas use the stored stock values. |
| INT-04 | `public.manila_today()` is stable and derives its date from the statement instant in Asia/Manila. `public.manila_now()` returns the current Manila wall clock as a timestamp without time zone. The medication start-date default uses the date helper. Stored event timestamps remain absolute instants. |
| INT-01 | Circle creation still inserts the creator as owner. Triggers enforce immutable creators and owner rows, and the partial index enforces at most one owner per circle. Owner deletion is checked after cascades can complete. The migration checks for preexisting owner drift and aborts without rewriting it. |
| Join requests | `request_to_join` and `respond_to_join_request` keep their Batch A bodies and signatures. Approvals still create a member and declines stay declined. |

`shifts.assigned_name` is readable under the existing shift SELECT policy and has no client write grant. A successful claim stores the claimant’s profile display name, with `Member` as the fallback for a missing or blank name. Release clears both assignment fields. The single commented backfill fills only NULL snapshots on existing assigned shifts. Backfilled names reflect profiles at migration time. Assignments already cleared before Batch B cannot be reconstructed by that backfill.

## Frontend changes to ship with the database migration

The database and RPC signatures are ready for the changes below. This batch contains SQL, tests, and documentation only.

| Surface | Change |
|---|---|
| [Calendar](../js/calendar.js#L139) | Select `assigned_name` and prefer it over the joined profile name. For completed history, a snapshot can still identify a volunteer if a later account deletion nulled the profile FK. For current and future shifts, use `assigned_to` to determine whether a shift is open. Gate Volunteer and Release using the Manila slot start, apply the same day to the create dialog, and refresh the affected rows after a rejected mutation. |
| [Circle board and duty](../js/circle.js#L471) | Compute the board range, displayed date, on-duty slot, and progress in Manila. Select the snapshot for duty labels. Hide Volunteer for shifts whose start has arrived, even if the open-shifts query returned them, and handle the shift messages below. |
| [Home](../js/home.js#L92) and [Circles](../js/circles.js#L72) | Use Manila for today, the calendar range, duty and urgency. Include `assigned_name` in Home’s shift projection and prefer it for assignment labels. Exclude started shifts from pick-up suggestions and brief facts. Reuse the shift message map for any claim or release action. |
| [Medication](../js/medication.js#L50) and [shared date helpers](../js/pharmacy-core.js#L55) | Use Manila midnight for dose lookbacks, and Manila date and wall-clock time for `Due`, `Overdue`, the schedule start-date form, expiry dates, and displayed timestamps. Send the selected schedule date and time unchanged when recording a dose. Map the new dose messages and refresh medication state on rejection. |
| [Pharmacy](../js/pharmacy.js#L361) | Map the three stock messages and mirror the two-decimal and range limits in the forms. The RPC still enforces them for every caller. |

Use one shared Manila date/time implementation in the frontend. Derive wall-clock fields in `Asia/Manila`, and compute slot instants and midnight ranges using that zone. If using the `manila_now` RPC, interpret its timestamp as Manila wall time. Keep the server’s limits authoritative when a screen crosses a cutoff or the device clock is wrong.

## Changed database messages

The values below are PostgreSQL exception messages with SQLSTATE `P0001`. Client code should match `error.message` and keep a generic fallback for unrelated failures.

| Message | Emitted by | Suggested customer-facing copy or handling |
|---|---|---|
| `shift_started` | Claim or release at or after the slot start. | This shift has already started. |
| `not_a_member` | Claim or release without a current membership for the shift, or mark/undo without a current membership for the dose’s circle. | You’re no longer a member of this circle. Refresh the circle or return to Home. |
| `shift_taken` | Claim when the shift is assigned, release when the caller no longer holds it, or the shift disappears after membership was checked. | This shift is no longer available to change. |
| `shift_in_past` | Inserting a shift dated before Manila today. | Pick today or a later date. |
| `schedule_inactive` | Marking a dose on a stopped schedule. | This medication schedule has been stopped. |
| `item_inactive` | Marking a dose when the medicine is inactive or the schedule’s item is unavailable in that circle. | This medicine is inactive or unavailable. |
| `invalid_dose_slot` | Marking a scheduled dose with missing, unsupported, or unconfigured date/time fields. | This time is no longer part of the schedule. |
| `dose_slot_in_future` | Marking a scheduled dose after the current Manila calendar day. | You can’t record a dose for a future date. |
| `invalid_stock_amount` | Opening stock or an adjustment amount fails its scale, range, or positivity rule. | Enter a valid stock amount with up to two decimal places. |
| `invalid_stock_threshold` | The opening low-stock threshold fails the scale or range rule. | Enter a valid threshold with up to two decimal places. |
| `stock_limit_exceeded` | An adjustment would exceed the supported stock range, or the stored balance is outside that range. | This change is outside the supported stock range. |
| `circle_creator_immutable` | Updating a circle’s creator. | Circle ownership cannot be transferred. |
| `circle_owner_immutable` | Updating an existing owner membership. | The owner membership cannot be changed. |
| `circle_owner_must_be_creator` | Assigning owner to a non-creator. | Only the creator can own this circle. |
| `circle_creator_must_be_owner` | Assigning a member role to the creator. | The creator must remain the owner. |
| `circle_owner_cannot_leave` | Removing an owner while the circle exists, including a membership truncate. The app’s RLS continues to hide the owner row from self-service leave. | Owners must delete the circle to remove their ownership. |
| `circle_owner_invariant_violation` | The migration finds an existing circle with a missing or mismatched owner. | Operator review is required before retrying the migration. |

The existing as-needed input error, missing schedule and dose errors, undo actor and time-window errors, and stock permission, correction-note, duplicate-medicine, and insufficient-stock errors are retained. A successful duplicate scheduled submission still returns `already_taken` with the existing response shape.

## Migration, rollback, and tests

- Apply the [migration](../supabase/migrations/20261123100000_batch_b_behavior.sql) after Batch A. The ownership preflight uses table locks to prevent writes between validation and trigger installation. The DDL, missing-only snapshot backfill, and routine replacements are one transaction.
- The [manual rollback](../supabase/migrations/manual/batch_b_rollback.sql) restores Batch A routine behavior and removes the new column, helpers, triggers, index, and default. Removing the column discards saved snapshots. It does not undo historical writes made while Batch B was active.
- Run [behavior SQL](../supabase/tests/batch_b_behavior.sql) as `postgres` with `ON_ERROR_STOP` on a disposable PostgreSQL 17 database after applying Batch A and Batch B. It rolls back its synthetic fixtures and temporary clock overrides.
- Run [concurrency tests](../supabase/tests/batch_b_concurrency.mjs) with Node.js, the `postgres` client library, and local `PGHOST`, `PGPORT`, `PGUSER`, and `PGDATABASE` settings. Use a disposable database. The tests verify that the second connection actually waits, then check both claim/leave orders, competing claims, and a duplicate scheduled dose.

Verified on a disposable native PostgreSQL 17.12 server. The SQL suite passed for owner, member, outsider, former-member and anonymous contexts, including Manila slot boundaries, membership departure, dose validation and owner deletion cascades. The concurrent sessions passed all four race cases. A separate migration check passed the owner preflight rejection, missing-only backfill, repeated application, rollback and reapplication. The disposable server used stub Supabase Auth helpers and omitted managed extension declarations from the baseline. Hosted Auth, PostgREST and the frontend integration were outside the test.
