-- Run as postgres on a disposable database after Batch A and Batch B.
-- The synthetic fixtures and deterministic clock overrides are rolled back.
BEGIN;
SET LOCAL search_path = pg_catalog, public;

CREATE FUNCTION pg_temp.assert_ok(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Batch B assertion: %', label; END IF;
END;
$$;

CREATE FUNCTION pg_temp.expect_error(statement text, state text, message text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> state OR (message IS NOT NULL AND SQLERRM <> message) THEN RAISE; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Batch B expected SQLSTATE % (%)', state, message;
END;
$$;

CREATE TEMP TABLE batch_b_fixture (label text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO batch_b_fixture
SELECT kind, gen_random_uuid() FROM unnest(ARRAY[
  'owner', 'member', 'outsider', 'former', 'circle', 'other_circle', 'past', 'morning', 'evening',
  'future', 'late_ongoing', 'late_completed', 'item', 'daily', 'weekly', 'interval', 'as_needed', 'expired'
]) AS labels(kind);
GRANT SELECT ON batch_b_fixture TO authenticated, anon;

CREATE FUNCTION pg_temp.fixture(kind text) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM pg_temp.batch_b_fixture WHERE label = kind;
$$;

CREATE FUNCTION pg_temp.actor(kind text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  id uuid := pg_temp.fixture(kind);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(id::text, ''), true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', id, 'user_metadata', '{}'::jsonb)::text, true);
END;
$$;

CREATE FUNCTION pg_temp.at_time(value timestamp without time zone) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('batch_b.test_clock', value::text, true);
END;
$$;

SET LOCAL TIME ZONE 'America/Los_Angeles';
SELECT pg_temp.assert_ok(
  public.manila_today() = timezone('Asia/Manila', statement_timestamp())::date
  AND abs(EXTRACT(epoch FROM (public.manila_now() - timezone('Asia/Manila', clock_timestamp())))) < 1,
  'real helpers ignore the session time zone'
);
SET LOCAL TIME ZONE 'UTC';
SELECT pg_temp.assert_ok(
  public.manila_today() = timezone('Asia/Manila', statement_timestamp())::date
  AND (timezone('Asia/Manila', timestamptz '2031-01-05 15:59:59+00'))::date = date '2031-01-05'
  AND (timezone('Asia/Manila', timestamptz '2031-01-05 16:00:00+00'))::date = date '2031-01-06',
  'UTC+8 midnight differs from UTC midnight'
);
SELECT pg_temp.assert_ok(bool_and(
  private.batch_b_shift_accepts_changes(date '2031-01-06', slot, at_manila) = allowed
), 'before, at, and after the Manila claim/release cutoffs')
FROM (VALUES
  ('morning', timestamp '2031-01-06 06:59:59.999999', true),
  ('morning', timestamp '2031-01-06 07:00:00', false),
  ('morning', timestamp '2031-01-06 07:00:00.000001', false),
  ('evening', timestamp '2031-01-06 14:59:59.999999', true),
  ('evening', timestamp '2031-01-06 15:00:00', false),
  ('evening', timestamp '2031-01-06 15:00:00.000001', false),
  ('evening', timestamp '2031-01-06 21:59:59.999999', false),
  ('evening', timestamp '2031-01-06 22:00:00.000001', false)
) AS boundary(slot, at_manila, allowed);

-- Same signatures as the real clock helpers. Only this transaction sees these bodies.
CREATE OR REPLACE FUNCTION public.manila_today() RETURNS date
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $$ SELECT current_setting('batch_b.test_clock')::timestamp::date $$;
CREATE OR REPLACE FUNCTION public.manila_now() RETURNS timestamp without time zone
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path TO ''
AS $$ SELECT current_setting('batch_b.test_clock')::timestamp $$;

SELECT pg_temp.at_time(timestamp '2031-01-05 06:00');
INSERT INTO auth.users (id, raw_user_meta_data)
SELECT id, jsonb_build_object('full_name', 'Test ' || label)
FROM batch_b_fixture WHERE label IN ('owner', 'member', 'outsider', 'former');
INSERT INTO public.circles (id, name, created_by)
VALUES (pg_temp.fixture('circle'), 'Batch B synthetic circle', pg_temp.fixture('owner')),
       (pg_temp.fixture('other_circle'), 'Batch B second circle', pg_temp.fixture('owner'));
INSERT INTO public.circle_members (circle_id, user_id)
SELECT pg_temp.fixture('circle'), id FROM batch_b_fixture WHERE label IN ('member', 'former');
INSERT INTO public.circle_members (circle_id, user_id)
VALUES (pg_temp.fixture('other_circle'), pg_temp.fixture('former'));

INSERT INTO public.shifts (id, circle_id, shift_date, slot, created_by)
SELECT pg_temp.fixture(label), circle, day, slot, pg_temp.fixture('owner')
FROM (VALUES
  ('past', pg_temp.fixture('circle'), date '2031-01-05', 'evening'),
  ('morning', pg_temp.fixture('circle'), date '2031-01-06', 'morning'),
  ('evening', pg_temp.fixture('circle'), date '2031-01-06', 'evening'),
  ('future', pg_temp.fixture('circle'), date '2031-01-07', 'morning'),
  ('late_ongoing', pg_temp.fixture('circle'), date '2031-01-07', 'evening'),
  ('late_completed', pg_temp.fixture('other_circle'), date '2031-01-07', 'evening')
) AS shifts(label, circle, day, slot);

INSERT INTO public.pharmacy_items (id, circle_id, name, stock)
VALUES (pg_temp.fixture('item'), pg_temp.fixture('circle'), 'Synthetic item', 0.50);
INSERT INTO public.medication_schedules
  (id, circle_id, item_id, dose_amount, frequency, days_of_week, interval_days, times, start_date, end_date)
SELECT pg_temp.fixture(label), pg_temp.fixture('circle'), pg_temp.fixture('item'), 1.25,
       label, weekdays, stride, times, date '2031-01-02', date '2031-01-06'
FROM (VALUES
  ('daily', '{}'::smallint[], NULL::smallint, ARRAY[time '08:00']),
  ('weekly', ARRAY[1]::smallint[], NULL::smallint, ARRAY[time '08:00']),
  ('interval', '{}'::smallint[], 2::smallint, ARRAY[time '08:00']),
  ('as_needed', '{}'::smallint[], NULL::smallint, '{}'::time[])
) AS schedules(label, weekdays, stride, times);
INSERT INTO public.medication_schedules (id, circle_id, item_id, dose_amount, frequency, times, start_date, end_date)
VALUES (pg_temp.fixture('expired'), pg_temp.fixture('circle'), pg_temp.fixture('item'),
        1.25, 'daily', ARRAY[time '08:00'], date '2031-01-02', date '2031-01-05');
INSERT INTO public.care_notes (circle_id, author_id, body)
VALUES (pg_temp.fixture('circle'), pg_temp.fixture('member'), 'Synthetic note');
INSERT INTO public.circle_tasks (circle_id, created_by, title)
VALUES (pg_temp.fixture('circle'), pg_temp.fixture('member'), 'Synthetic task');
INSERT INTO public.ai_log (circle_id, created_by, body)
VALUES (pg_temp.fixture('circle'), pg_temp.fixture('member'), 'Synthetic brief');

SET LOCAL ROLE authenticated;
SELECT pg_temp.actor('member');
SELECT public.claim_shift(pg_temp.fixture('past'));
SELECT public.claim_shift(pg_temp.fixture('future'));
SELECT pg_temp.actor('former');
SELECT public.claim_shift(pg_temp.fixture('late_ongoing'));
SELECT public.claim_shift(pg_temp.fixture('late_completed'));

SELECT pg_temp.at_time(timestamp '2031-01-06 00:00:00');
SELECT pg_temp.actor('owner');
SELECT pg_temp.expect_error($sql$
  INSERT INTO public.shifts (circle_id, shift_date, slot)
  VALUES (pg_temp.fixture('circle'), date '2031-01-05', 'morning')
$sql$, 'P0001', 'shift_in_past');
SELECT pg_temp.expect_error($sql$
  INSERT INTO public.shifts (circle_id, shift_date, slot, assigned_name)
  VALUES (pg_temp.fixture('circle'), public.manila_today(), 'morning', 'Synthetic forged label')
$sql$, '42501');
SELECT pg_temp.expect_error($sql$
  UPDATE public.shifts SET assigned_name = 'Synthetic forged label' WHERE id = pg_temp.fixture('morning')
$sql$, '42501');
SELECT pg_temp.assert_ok(NOT has_column_privilege('anon', 'public.shifts', 'assigned_name', 'INSERT,UPDATE'),
  'anon cannot write assignment snapshots');
DO $test$
DECLARE
  removed bigint;
BEGIN
  DELETE FROM public.circle_members WHERE circle_id = pg_temp.fixture('circle') AND user_id = auth.uid();
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM pg_temp.assert_ok(removed = 0, 'authenticated owner cannot leave');
END;
$test$;

SELECT pg_temp.actor('outsider');
SELECT pg_temp.expect_error('SELECT public.claim_shift(pg_temp.fixture(''morning''))', 'P0001', 'not_a_member');
SELECT pg_temp.expect_error('SELECT public.release_shift(pg_temp.fixture(''future''))', 'P0001', 'not_a_member');
SELECT pg_temp.expect_error('SELECT public.mark_dose_taken(pg_temp.fixture(''as_needed''))', 'P0001', 'not_a_member');

SELECT pg_temp.actor('member');
SELECT pg_temp.at_time(timestamp '2031-01-06 06:59:59.999999');
SELECT public.claim_shift(pg_temp.fixture('morning'));
SELECT public.release_shift(pg_temp.fixture('morning'));
SELECT pg_temp.assert_ok(
  (SELECT assigned_to IS NULL AND assigned_name IS NULL FROM public.shifts WHERE id = pg_temp.fixture('morning')),
  'release clears both assignment fields before start'
);
SELECT public.claim_shift(pg_temp.fixture('morning'));
SELECT pg_temp.actor('owner');
SELECT pg_temp.expect_error('SELECT public.claim_shift(pg_temp.fixture(''morning''))', 'P0001', 'shift_taken');
SELECT pg_temp.expect_error('SELECT public.release_shift(pg_temp.fixture(''morning''))', 'P0001', 'shift_taken');
SELECT pg_temp.actor('member');
SELECT pg_temp.at_time(timestamp '2031-01-06 07:00:00');
SELECT pg_temp.expect_error('SELECT public.release_shift(pg_temp.fixture(''morning''))', 'P0001', 'shift_started');
SELECT pg_temp.expect_error('SELECT public.claim_shift(pg_temp.fixture(''morning''))', 'P0001', 'shift_started');
SELECT pg_temp.at_time(timestamp '2031-01-06 14:59:59.999999');
SELECT public.claim_shift(pg_temp.fixture('evening'));
SELECT public.release_shift(pg_temp.fixture('evening'));
SELECT public.claim_shift(pg_temp.fixture('evening'));
SELECT pg_temp.at_time(timestamp '2031-01-06 15:00:00.000001');
SELECT pg_temp.expect_error('SELECT public.release_shift(pg_temp.fixture(''evening''))', 'P0001', 'shift_started');

SELECT pg_temp.expect_error($sql$ SELECT public.mark_dose_taken(pg_temp.fixture('daily'), date '2031-01-07', time '08:00') $sql$, 'P0001', 'dose_slot_in_future');
SELECT pg_temp.expect_error($sql$ SELECT public.mark_dose_taken(pg_temp.fixture('daily'), date '2031-01-06', time '09:00') $sql$, 'P0001', 'invalid_dose_slot');
SELECT pg_temp.expect_error($sql$ SELECT public.mark_dose_taken(pg_temp.fixture('daily'), date '2031-01-01', time '08:00') $sql$, 'P0001', 'invalid_dose_slot');
SELECT pg_temp.expect_error($sql$ SELECT public.mark_dose_taken(pg_temp.fixture('weekly'), date '2031-01-05', time '08:00') $sql$, 'P0001', 'invalid_dose_slot');
SELECT pg_temp.expect_error($sql$ SELECT public.mark_dose_taken(pg_temp.fixture('interval'), date '2031-01-05', time '08:00') $sql$, 'P0001', 'invalid_dose_slot');
SELECT pg_temp.expect_error($sql$ SELECT public.mark_dose_taken(pg_temp.fixture('expired'), date '2031-01-06', time '08:00') $sql$, 'P0001', 'invalid_dose_slot');
SELECT pg_temp.expect_error($sql$ SELECT public.mark_dose_taken(pg_temp.fixture('as_needed'), date '2031-01-06', time '08:00') $sql$,
  'P0001', 'As-needed doses don’t have a time slot');
SELECT pg_temp.assert_ok(
  public.mark_dose_taken(pg_temp.fixture('daily'), date '2031-01-06', time '08:00') @>
    '{"status":"ok","flagged":true,"stock_after":0}'::jsonb, 'insufficient stock remains recordable'
);
SELECT pg_temp.assert_ok(
  public.mark_dose_taken(pg_temp.fixture('daily'), date '2031-01-06', time '08:00')->>'status' = 'already_taken',
  'duplicate scheduled dose response'
);
SELECT pg_temp.assert_ok(
  public.mark_dose_taken(pg_temp.fixture('weekly'), date '2031-01-06', time '08:00')->>'status' = 'ok',
  'configured weekday succeeds'
);
SELECT pg_temp.assert_ok(
  public.mark_dose_taken(pg_temp.fixture('interval'), date '2031-01-06', time '08:00')->>'status' = 'ok',
  'configured interval succeeds'
);
SELECT pg_temp.assert_ok(
  public.mark_dose_taken(pg_temp.fixture('as_needed'))->>'status' = 'ok', 'as-needed execution remains available'
);

SELECT pg_temp.actor('owner');
UPDATE public.medication_schedules SET is_active = false WHERE id = pg_temp.fixture('daily');
UPDATE public.pharmacy_items SET is_active = false WHERE id = pg_temp.fixture('item');
SELECT pg_temp.expect_error($sql$ SELECT public.mark_dose_taken(pg_temp.fixture('daily'), date '2031-01-06', time '08:00') $sql$, 'P0001', 'schedule_inactive');
SELECT pg_temp.expect_error($sql$ SELECT public.mark_dose_taken(pg_temp.fixture('as_needed')) $sql$, 'P0001', 'item_inactive');
SELECT pg_temp.actor('member');
SELECT pg_temp.assert_ok(
  public.undo_dose((SELECT id FROM public.medication_doses WHERE schedule_id = pg_temp.fixture('daily')))
    @> '{"status":"ok","stock_after":0.50}'::jsonb,
  'member can correct own dose even after schedule and item deactivation'
);
SELECT pg_temp.actor('owner');
UPDATE public.pharmacy_items SET is_active = true WHERE id = pg_temp.fixture('item');
WITH made AS (
  INSERT INTO public.medication_schedules (circle_id, item_id, dose_amount, frequency)
  VALUES (pg_temp.fixture('circle'), pg_temp.fixture('item'), 1, 'as_needed')
  RETURNING start_date
)
SELECT pg_temp.assert_ok(start_date = date '2031-01-06', 'new schedule defaults to Manila date') FROM made;

DO $test$
DECLARE
  stock_item uuid;
  bad numeric;
BEGIN
  stock_item := public.create_pharmacy_item(pg_temp.fixture('circle'), 'Synthetic decimals',
    NULL, NULL, NULL, 10.10, 0.01, NULL, NULL);
  PERFORM pg_temp.assert_ok(public.adjust_pharmacy_stock(stock_item, 'add', 0.02) = 10.12, 'exact restock');
  PERFORM pg_temp.assert_ok(public.adjust_pharmacy_stock(stock_item, 'remove', 0.01) = 10.11, 'exact removal');
  PERFORM pg_temp.assert_ok(public.adjust_pharmacy_stock(stock_item, 'set', 4.20, NULL, 'Synthetic correction') = 4.20,
    'exact correction');
  PERFORM pg_temp.assert_ok((SELECT count(*) = 4 AND sum(change) = 4.20 AND
    bool_and((change, balance_after) IN ((10.10,10.10), (0.02,10.12), (-0.01,10.11), (-5.91,4.20)))
    FROM public.stock_movements WHERE item_id = stock_item), 'each ledger entry equals its stored balance change');
  FOREACH bad IN ARRAY ARRAY[0::numeric, -1, 0.001, 100000000, 'NaN'::numeric, 'Infinity'::numeric] LOOP
    PERFORM pg_temp.expect_error(format('SELECT public.adjust_pharmacy_stock(%L,%L,%L::numeric)', stock_item, 'add', bad),
      'P0001', 'invalid_stock_amount');
  END LOOP;
  PERFORM pg_temp.expect_error(format('SELECT public.adjust_pharmacy_stock(%L,%L,99999999.99)', stock_item, 'add'),
    'P0001', 'stock_limit_exceeded');
  PERFORM pg_temp.expect_error($sql$
    SELECT public.create_pharmacy_item(pg_temp.fixture('circle'), 'Invalid threshold', NULL, NULL, NULL, 0, 1.001, NULL, NULL)
  $sql$, 'P0001', 'invalid_stock_threshold');
  PERFORM pg_temp.expect_error($sql$
    SELECT public.create_pharmacy_item(pg_temp.fixture('circle'), 'Invalid starting balance', NULL, NULL, NULL, 1.001, 0, NULL, NULL)
  $sql$, 'P0001', 'invalid_stock_amount');
END;
$test$;

SELECT pg_temp.actor('member');
UPDATE public.profiles SET full_name = 'Changed synthetic name' WHERE id = auth.uid();
DELETE FROM public.circle_members WHERE circle_id = pg_temp.fixture('circle') AND user_id = auth.uid();
SELECT pg_temp.expect_error('SELECT public.claim_shift(pg_temp.fixture(''future''))', 'P0001', 'not_a_member');
SELECT pg_temp.expect_error('SELECT public.mark_dose_taken(pg_temp.fixture(''as_needed''))', 'P0001', 'not_a_member');
RESET ROLE;
SELECT pg_temp.expect_error($sql$
  SELECT public.undo_dose((SELECT id FROM public.medication_doses WHERE schedule_id = pg_temp.fixture('daily')))
$sql$, 'P0001', 'not_a_member');

SET LOCAL ROLE authenticated;
SELECT pg_temp.actor('owner');
SELECT pg_temp.assert_ok(
  (SELECT count(*) = 2 FROM public.shifts WHERE id IN (pg_temp.fixture('past'), pg_temp.fixture('morning'))
    AND assigned_to = pg_temp.fixture('member') AND assigned_name = 'Test member')
  AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = pg_temp.fixture('member')),
  'past and completed-today shifts keep the captured label without profile visibility'
);
SELECT pg_temp.assert_ok(
  (SELECT count(*) = 2 FROM public.shifts WHERE id IN (pg_temp.fixture('evening'), pg_temp.fixture('future'))
    AND assigned_to IS NULL AND assigned_name IS NULL),
  'leave opens ongoing and future shifts'
);
SELECT pg_temp.assert_ok(
  EXISTS (SELECT 1 FROM public.care_notes WHERE author_id = pg_temp.fixture('member'))
  AND EXISTS (SELECT 1 FROM public.medication_doses WHERE taken_by = pg_temp.fixture('member'))
  AND EXISTS (SELECT 1 FROM public.circle_tasks WHERE created_by = pg_temp.fixture('member'))
  AND EXISTS (SELECT 1 FROM public.ai_log WHERE created_by = pg_temp.fixture('member')),
  'leave retains notes, doses, tasks and saved briefs'
);
SELECT pg_temp.actor('former');
SELECT pg_temp.at_time(timestamp '2031-01-07 21:59:59.999999');
DELETE FROM public.circle_members WHERE circle_id = pg_temp.fixture('circle') AND user_id = auth.uid();
SELECT pg_temp.at_time(timestamp '2031-01-07 22:00:00.000001');
DELETE FROM public.circle_members WHERE circle_id = pg_temp.fixture('other_circle') AND user_id = auth.uid();
RESET ROLE;
SELECT pg_temp.assert_ok(
  (SELECT assigned_to IS NULL AND assigned_name IS NULL FROM public.shifts WHERE id = pg_temp.fixture('late_ongoing'))
  AND (SELECT assigned_to = pg_temp.fixture('former') AND assigned_name = 'Test former'
       FROM public.shifts WHERE id = pg_temp.fixture('late_completed')),
  'leave immediately before the evening end opens the shift and leave after it keeps history'
);

DO $test$
BEGIN
  PERFORM set_config('batch_b.invite_one', invite_code, true)
  FROM public.circles WHERE id = pg_temp.fixture('circle');
  PERFORM set_config('batch_b.invite_two', invite_code, true)
  FROM public.circles WHERE id = pg_temp.fixture('other_circle');
END;
$test$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor('outsider');
SELECT pg_temp.assert_ok(public.request_to_join(current_setting('batch_b.invite_one'))->>'status' = 'pending', 'join request stays pending');
SELECT pg_temp.assert_ok(public.request_to_join(current_setting('batch_b.invite_two'))->>'status' = 'pending', 'second join request stays pending');
SELECT pg_temp.actor('owner');
SELECT public.respond_to_join_request(
  (SELECT id FROM public.circle_join_requests WHERE circle_id = pg_temp.fixture('circle') AND user_id = pg_temp.fixture('outsider')), false
);
SELECT public.respond_to_join_request(
  (SELECT id FROM public.circle_join_requests WHERE circle_id = pg_temp.fixture('other_circle') AND user_id = pg_temp.fixture('outsider')), true
);
SELECT pg_temp.actor('outsider');
SELECT pg_temp.assert_ok(public.request_to_join(current_setting('batch_b.invite_one'))->>'status' = 'denied', 'declined join stays declined');
SELECT pg_temp.assert_ok(public.request_to_join(current_setting('batch_b.invite_two'))->>'status' = 'member', 'approval still adds a member');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.actor(NULL);
SELECT pg_temp.expect_error('SELECT public.manila_now()', '42501');
SELECT pg_temp.expect_error('SELECT public.manila_today()', '42501');
SELECT pg_temp.expect_error('SELECT public.claim_shift(pg_temp.fixture(''future''))', '42501');
SELECT pg_temp.expect_error('SELECT public.release_shift(pg_temp.fixture(''future''))', '42501');
SELECT pg_temp.expect_error('SELECT public.mark_dose_taken(pg_temp.fixture(''daily''))', '42501');
SELECT pg_temp.expect_error('SELECT public.undo_dose(NULL)', '42501');
RESET ROLE;

-- Test protected writes with a privileged role so the triggers themselves are exercised.
SELECT pg_temp.expect_error($sql$
  UPDATE public.circles SET created_by = pg_temp.fixture('member') WHERE id = pg_temp.fixture('circle')
$sql$, 'P0001', 'circle_creator_immutable');
SELECT pg_temp.expect_error($sql$
  UPDATE public.circle_members SET role = 'member' WHERE circle_id = pg_temp.fixture('circle') AND role = 'owner'
$sql$, 'P0001', 'circle_owner_immutable');
SELECT pg_temp.expect_error($sql$
  INSERT INTO public.circle_members (circle_id,user_id,role)
  VALUES (pg_temp.fixture('circle'),pg_temp.fixture('member'),'owner')
$sql$, 'P0001', 'circle_owner_must_be_creator');
SELECT pg_temp.expect_error($sql$
  INSERT INTO public.circle_members (circle_id,user_id,role)
  VALUES (pg_temp.fixture('circle'),pg_temp.fixture('owner'),'member') ON CONFLICT DO NOTHING
$sql$, 'P0001', 'circle_creator_must_be_owner');
SELECT pg_temp.expect_error('TRUNCATE public.circle_members', 'P0001', 'circle_owner_cannot_leave');
DO $test$
BEGIN
  BEGIN
    DELETE FROM public.circle_members WHERE circle_id = pg_temp.fixture('circle') AND role = 'owner';
    SET CONSTRAINTS public.batch_b_owner_delete_guard IMMEDIATE;
    RAISE EXCEPTION 'Owner deletion was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'circle_owner_cannot_leave' THEN RAISE; END IF;
  END;
END;
$test$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.actor('owner');
DELETE FROM public.circles WHERE id = pg_temp.fixture('circle');
RESET ROLE;
SET CONSTRAINTS public.batch_b_owner_delete_guard IMMEDIATE;
SELECT pg_temp.assert_ok(
  NOT EXISTS (SELECT 1 FROM public.circles WHERE id = pg_temp.fixture('circle'))
  AND NOT EXISTS (SELECT 1 FROM public.circle_members WHERE circle_id = pg_temp.fixture('circle'))
  AND NOT EXISTS (SELECT 1 FROM public.shifts WHERE circle_id = pg_temp.fixture('circle')),
  'owner circle delete cascades through memberships and shifts'
);
SET CONSTRAINTS public.batch_b_owner_delete_guard DEFERRED;
DELETE FROM auth.users WHERE id = pg_temp.fixture('owner');
SET CONSTRAINTS public.batch_b_owner_delete_guard IMMEDIATE;
SELECT pg_temp.assert_ok(
  NOT EXISTS (SELECT 1 FROM public.circles WHERE id = pg_temp.fixture('other_circle'))
  AND NOT EXISTS (SELECT 1 FROM public.circle_members WHERE circle_id = pg_temp.fixture('other_circle')),
  'creator account deletion cascades through its circle and owner row'
);

ROLLBACK;
