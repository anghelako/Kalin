-- Run as postgres on a disposable database with ON_ERROR_STOP enabled.
-- Synthetic fixtures, helper objects, and test-only grants are rolled back.
BEGIN;
SET LOCAL search_path = pg_catalog, public;

CREATE TEMP TABLE batch_a_fixture (name text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO batch_a_fixture
SELECT name, gen_random_uuid()
FROM unnest(ARRAY[
  'owner', 'member', 'outsider', 'circle', 'other_circle', 'item', 'schedule', 'dose'
]) AS names(name);
GRANT SELECT ON batch_a_fixture TO authenticated, anon;

CREATE FUNCTION pg_temp.fixture(label text) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM pg_temp.batch_a_fixture WHERE name = label;
$$;

CREATE FUNCTION pg_temp.set_actor(label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  actor_id uuid := pg_temp.fixture(label);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(actor_id::text, ''), true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor_id,
    'email', 'batch-a-fallback' || chr(64) || 'example.invalid',
    'user_metadata', CASE WHEN label = 'owner'
      THEN '{"full_name":"Synthetic Owner"}'::jsonb ELSE '{}'::jsonb END
  )::text, true);
END;
$$;

CREATE FUNCTION pg_temp.assert_true(assertion boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF assertion IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Batch A assertion failed: %', label;
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.expect_count(expected bigint, statement text, label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  actual bigint;
BEGIN
  EXECUTE statement INTO actual;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Batch A %: expected %, got %', label, expected, actual;
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.expect_error(expected text, statement text, label text,
                                     expected_constraint text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  actual_constraint text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_constraint = CONSTRAINT_NAME;
    IF SQLSTATE <> expected OR
       (expected_constraint IS NOT NULL AND actual_constraint <> expected_constraint) THEN
      RAISE;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Batch A %: expected SQLSTATE %', label, expected;
END;
$$;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT id, name || '-' || id::text || chr(64) || 'example.invalid',
       CASE name
         WHEN 'owner' THEN '{"full_name":"Synthetic Owner"}'::jsonb
         WHEN 'member' THEN '{"full_name":" ","name":"Synthetic Member"}'::jsonb
         ELSE '{}'::jsonb
       END
FROM batch_a_fixture WHERE name IN ('owner', 'member', 'outsider');

SELECT pg_temp.assert_true(
  (SELECT array_agg(full_name ORDER BY f.name) FROM public.profiles p
   JOIN batch_a_fixture f ON p.id = f.id) =
  ARRAY['Synthetic Member', 'Member', 'Synthetic Owner'],
  'signup trigger uses explicit names or the neutral fallback'
);

INSERT INTO public.circles (id, name, created_by)
VALUES (pg_temp.fixture('circle'), 'Synthetic care circle', pg_temp.fixture('owner')),
       (pg_temp.fixture('other_circle'), 'Synthetic other circle', pg_temp.fixture('outsider'));
INSERT INTO public.circle_members (circle_id, user_id)
VALUES (pg_temp.fixture('circle'), pg_temp.fixture('member'));
INSERT INTO public.care_notes (circle_id, author_id, body)
VALUES (pg_temp.fixture('circle'), pg_temp.fixture('owner'), 'Synthetic owner note'),
       (pg_temp.fixture('circle'), pg_temp.fixture('member'), 'Synthetic member keepsake');
INSERT INTO public.ai_log (circle_id, created_by, body)
VALUES (pg_temp.fixture('circle'), pg_temp.fixture('owner'), 'Synthetic AI log');
INSERT INTO public.pharmacy_items (id, circle_id, name, stock)
VALUES (pg_temp.fixture('item'), pg_temp.fixture('circle'), 'Synthetic medicine', 10);
INSERT INTO public.medication_schedules (id, circle_id, item_id, dose_amount, frequency)
VALUES (pg_temp.fixture('schedule'), pg_temp.fixture('circle'), pg_temp.fixture('item'), 1, 'as_needed');
INSERT INTO public.medication_doses (id, circle_id, schedule_id, item_id, amount, taken_by_name)
VALUES (pg_temp.fixture('dose'), pg_temp.fixture('circle'), pg_temp.fixture('schedule'),
        pg_temp.fixture('item'), 1, 'Synthetic fixture');
INSERT INTO public.stock_movements (circle_id, item_id, change, balance_after, reason, created_by_name)
VALUES (pg_temp.fixture('circle'), pg_temp.fixture('item'), 10, 10, 'initial', 'Synthetic fixture');

SELECT pg_temp.expect_count(13, $sql$
  SELECT count(*) FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('ai_log','care_notes','circle_join_requests','medication_doses',
                     'medication_schedules','pharmacy_items','stock_movements')
    AND roles = ARRAY['authenticated'::name]
$sql$, 'all thirteen policy roles');

SELECT pg_temp.expect_count(4, $sql$
  SELECT count(*) FROM pg_catalog.pg_proc
  WHERE oid IN ('public.add_circle_owner()'::regprocedure,
                'public.add_circle_owner_membership()'::regprocedure,
                'public.is_circle_member(uuid)'::regprocedure,
                'public.owns_circle(uuid)'::regprocedure)
    AND prosecdef AND proconfig @> ARRAY['search_path=""']
$sql$, 'all four definer search paths');

-- The effective PUBLIC execute default is cleared explicitly in future RPC deployments.
CREATE TABLE public.batch_a_acl_probe (id integer);
CREATE FUNCTION public.batch_a_acl_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1';
REVOKE EXECUTE ON FUNCTION public.batch_a_acl_probe() FROM PUBLIC;
SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon', 'public.batch_a_acl_probe', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated', 'public.batch_a_acl_probe', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_function_privilege('anon', 'public.batch_a_acl_probe()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.batch_a_acl_probe()', 'EXECUTE'),
  'future postgres-created public objects lack direct client grants'
);

CREATE FUNCTION pg_temp.test_reads(expected bigint, expected_requests bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY[
    'ai_log', 'care_notes', 'medication_doses', 'medication_schedules',
    'pharmacy_items', 'stock_movements', 'circle_join_requests'
  ] LOOP
    PERFORM pg_temp.expect_count(
      CASE WHEN relation = 'circle_join_requests' THEN expected_requests
           WHEN relation = 'care_notes' THEN expected * 2
           ELSE expected END,
      format('SELECT count(*) FROM public.%I WHERE circle_id = pg_temp.fixture(''circle'')', relation),
      relation || ' SELECT policy'
    );
  END LOOP;
END;
$$;

CREATE FUNCTION pg_temp.test_writes(is_member boolean, is_owner boolean) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  note_sql text := $sql$
    INSERT INTO public.care_notes (circle_id, body)
    VALUES (pg_temp.fixture('circle'), 'Synthetic write test')
  $sql$;
  log_sql text := $sql$
    INSERT INTO public.ai_log (circle_id, body)
    VALUES (pg_temp.fixture('circle'), 'Synthetic write test')
  $sql$;
  schedule_sql text := $sql$
    INSERT INTO public.medication_schedules (circle_id, item_id, dose_amount, frequency, times)
    VALUES (pg_temp.fixture('circle'), pg_temp.fixture('item'), 1, 'daily', ARRAY[time '08:00'])
  $sql$;
BEGIN
  IF is_member THEN
    EXECUTE note_sql;
    EXECUTE log_sql;
    PERFORM pg_temp.expect_count(1, $sql$
      WITH removed AS (
        DELETE FROM public.care_notes
        WHERE circle_id = pg_temp.fixture('circle') AND body = 'Synthetic write test'
        RETURNING 1
      ) SELECT count(*) FROM removed
    $sql$, 'current author can delete own note');
  ELSE
    PERFORM pg_temp.expect_error('42501', note_sql, 'non-member note denied');
    PERFORM pg_temp.expect_error('42501', log_sql, 'non-member AI log denied');
  END IF;
  IF is_owner THEN
    EXECUTE schedule_sql;
  ELSE
    PERFORM pg_temp.expect_error('42501', schedule_sql, 'non-owner schedule insert denied');
  END IF;
  PERFORM pg_temp.expect_count(CASE WHEN is_owner THEN 1 ELSE 0 END, $sql$
    WITH changed AS (
      UPDATE public.medication_schedules SET is_active = true
      WHERE id = pg_temp.fixture('schedule') RETURNING 1
    ) SELECT count(*) FROM changed
  $sql$, 'schedule UPDATE policy');
  PERFORM pg_temp.expect_count(CASE WHEN is_owner THEN 1 ELSE 0 END, $sql$
    WITH changed AS (
      UPDATE public.pharmacy_items SET notes = 'Synthetic inventory test'
      WHERE id = pg_temp.fixture('item') RETURNING 1
    ) SELECT count(*) FROM changed
  $sql$, 'pharmacy UPDATE policy');
  PERFORM pg_temp.expect_count(0, $sql$
    WITH removed AS (
      DELETE FROM public.care_notes
      WHERE circle_id = pg_temp.fixture('circle') AND author_id <> auth.uid()
      RETURNING 1
    ) SELECT count(*) FROM removed
  $sql$, 'cannot delete a different author note');
END;
$$;

-- Requester fixture, going through the actual RPC as an authenticated outsider.
DO $tests$
BEGIN
  PERFORM set_config('batch_a.synthetic_invite', invite_code, true)
  FROM public.circles WHERE id = pg_temp.fixture('circle');
END;
$tests$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_actor('outsider');
SELECT pg_temp.assert_true(
  public.request_to_join(current_setting('batch_a.synthetic_invite'))->>'status' = 'pending',
  'outsider submits a pending join request'
);
SELECT pg_temp.assert_true(
  (SELECT requester_name FROM public.circle_join_requests WHERE circle_id = pg_temp.fixture('circle')) = 'Member',
  'request display name uses the neutral fallback'
);
RESET ROLE;

-- Exercise each read policy before allowed writes change the fixture counts.
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_actor('owner');
SELECT pg_temp.test_reads(1, 1);
SELECT pg_temp.assert_true(public.is_circle_member(pg_temp.fixture('circle'))
  AND public.owns_circle(pg_temp.fixture('circle'))
  AND public.request_to_join(current_setting('batch_a.synthetic_invite'))->>'status' = 'member',
  'owner membership, ownership and join behavior');
SELECT pg_temp.set_actor('member');
SELECT pg_temp.test_reads(1, 0);
SELECT pg_temp.assert_true(public.is_circle_member(pg_temp.fixture('circle'))
  AND NOT public.owns_circle(pg_temp.fixture('circle'))
  AND public.request_to_join(current_setting('batch_a.synthetic_invite'))->>'status' = 'member',
  'member membership, ownership and join behavior');
SELECT pg_temp.set_actor('outsider');
SELECT pg_temp.test_reads(0, 1);
SELECT pg_temp.assert_true(NOT public.is_circle_member(pg_temp.fixture('circle'))
  AND NOT public.owns_circle(pg_temp.fixture('circle')),
  'outsider membership and ownership');

SELECT pg_temp.expect_error('P0001', $sql$
  SELECT public.mark_dose_taken(pg_temp.fixture('schedule'))
$sql$, 'outsider cannot record a dose');
SELECT pg_temp.test_writes(false, false);
SELECT pg_temp.set_actor('member');
SELECT pg_temp.test_writes(true, false);
SELECT pg_temp.assert_true(
  public.mark_dose_taken(pg_temp.fixture('schedule'))->>'status' = 'ok',
  'member can record a dose'
);
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM public.medication_doses
          WHERE schedule_id = pg_temp.fixture('schedule') AND taken_by = auth.uid()
            AND taken_by_name = 'Member'),
  'member dose actor uses neutral fallback'
);
SELECT pg_temp.set_actor('owner');
SELECT pg_temp.test_writes(true, true);
SELECT pg_temp.assert_true(
  public.adjust_pharmacy_stock(pg_temp.fixture('item'), 'add', 1) = 10,
  'owner can adjust stock'
);
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM public.stock_movements
          WHERE item_id = pg_temp.fixture('item') AND created_by = auth.uid()
            AND created_by_name = 'Synthetic Owner'),
  'owner stock actor preserves the explicit display name'
);
SELECT pg_temp.expect_error('42501', 'SELECT public.pharmacy_actor_name()', 'actor helper is not a client RPC');
SELECT pg_temp.expect_error('42501', 'SELECT public.handle_new_user()', 'signup trigger is not a client RPC');
SELECT pg_temp.expect_error('42501', 'SELECT public.add_circle_owner()', 'owner trigger is not a client RPC');
SELECT pg_temp.expect_error('42501', 'SELECT public.add_circle_owner_membership()', 'alternate owner trigger is not a client RPC');

-- Circle limits use the same trimmed name and raw description lengths as create_circle.
INSERT INTO public.circles (name, description) VALUES (' ' || repeat('n', 60) || ' ', repeat('d', 120));
SELECT pg_temp.expect_error('23514',
  'INSERT INTO public.circles (name) VALUES (repeat(''n'', 61))',
  'name length', 'circles_batch_a_name_length');
SELECT pg_temp.expect_error('23514',
  'INSERT INTO public.circles (name, description) VALUES (''Synthetic'', repeat(''d'', 121))',
  'description length', 'circles_batch_a_description_length');

-- Valid weekly endpoints and every invalid array shape exercise the actual table checks.
INSERT INTO public.medication_schedules (circle_id, item_id, dose_amount, frequency, days_of_week, times)
VALUES (pg_temp.fixture('circle'), pg_temp.fixture('item'), 1, 'weekly',
        ARRAY[0,6]::smallint[], ARRAY[time '00:00', time '23:59:59']);
DO $tests$
DECLARE
  bad_array text;
BEGIN
  FOREACH bad_array IN ARRAY ARRAY['ARRAY[-1,0]', 'ARRAY[6,7]', 'ARRAY[1,1]', 'ARRAY[1,NULL]', 'ARRAY[[1,2],[3,4]]'] LOOP
    PERFORM pg_temp.expect_error('23514', format($sql$
      INSERT INTO public.medication_schedules (circle_id, item_id, dose_amount, frequency, days_of_week, times)
      VALUES (pg_temp.fixture('circle'), pg_temp.fixture('item'), 1, 'weekly', %s::smallint[], ARRAY[time '08:00'])
    $sql$, bad_array), 'invalid weekdays', 'medication_schedules_batch_a_weekdays');
  END LOOP;
  FOREACH bad_array IN ARRAY ARRAY[
    'ARRAY[time ''24:00'']', 'ARRAY[time ''08:00'', time ''08:00'']',
    'ARRAY[time ''08:00'', NULL]', 'ARRAY[[time ''07:00'', time ''08:00'']]'
  ] LOOP
    PERFORM pg_temp.expect_error('23514', format($sql$
      INSERT INTO public.medication_schedules (circle_id, item_id, dose_amount, frequency, times)
      VALUES (pg_temp.fixture('circle'), pg_temp.fixture('item'), 1, 'daily', %s)
    $sql$, bad_array), 'invalid times', 'medication_schedules_batch_a_times');
  END LOOP;
END;
$tests$;

RESET ROLE;

-- Both the installed and detached trigger create exactly one owner for a new circle.
CREATE FUNCTION pg_temp.test_owner_trigger(label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  actor text;
  new_circle uuid;
BEGIN
  FOREACH actor IN ARRAY ARRAY['owner','member','outsider'] LOOP
    PERFORM pg_temp.set_actor(actor);
    INSERT INTO public.circles (name) VALUES ('Synthetic owner trigger') RETURNING id INTO new_circle;
    PERFORM pg_temp.assert_true(
      (SELECT count(*) FROM public.circle_members
       WHERE circle_id = new_circle AND user_id = auth.uid() AND role = 'owner') = 1,
      label || ' creates an owner row for ' || actor
    );
  END LOOP;
END;
$$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.test_owner_trigger('installed owner trigger');
RESET ROLE;

-- Exercise the legacy helper independently by swapping triggers in this test transaction.
ALTER TABLE public.circles DISABLE TRIGGER on_circle_created;
CREATE TRIGGER batch_a_test_alternate_owner AFTER INSERT ON public.circles
  FOR EACH ROW EXECUTE FUNCTION public.add_circle_owner_membership();
SET LOCAL ROLE authenticated;
SELECT pg_temp.test_owner_trigger('alternate owner trigger');
RESET ROLE;
DROP TRIGGER batch_a_test_alternate_owner ON public.circles;
ALTER TABLE public.circles ENABLE TRIGGER on_circle_created;

SET LOCAL ROLE authenticated;
SELECT pg_temp.set_actor('member');
DELETE FROM public.circle_members WHERE circle_id = pg_temp.fixture('circle') AND user_id = auth.uid();
DO $tests$
DECLARE
  removed bigint;
BEGIN
  DELETE FROM public.care_notes;
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM pg_temp.assert_true(removed = 0, 'former author cannot delete own note after leaving');
END;
$tests$;
RESET ROLE;
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM public.care_notes WHERE author_id = pg_temp.fixture('member')),
  'former member note still exists'
);

SET LOCAL ROLE anon;
SELECT pg_temp.set_actor(NULL);
SELECT pg_temp.expect_error('42501', 'SELECT public.is_circle_member(pg_temp.fixture(''circle''))', 'anon membership RPC');
SELECT pg_temp.expect_error('42501', 'SELECT public.owns_circle(pg_temp.fixture(''circle''))', 'anon ownership RPC');
SELECT pg_temp.expect_error('42501', 'SELECT public.request_to_join(NULL)', 'anon join RPC');
SELECT pg_temp.expect_error('42501', 'SELECT public.handle_new_user()', 'anon signup trigger execute');
SELECT pg_temp.expect_error('42501', 'SELECT public.pharmacy_actor_name()', 'anon actor helper execute');
SELECT pg_temp.expect_error('42501', 'SELECT public.add_circle_owner()', 'anon owner trigger execute');
SELECT pg_temp.expect_error('42501', 'SELECT public.add_circle_owner_membership()', 'anon alternate owner trigger execute');
SELECT pg_temp.expect_error('42501', 'INSERT INTO public.circles (name) VALUES (''Synthetic'')', 'anon cannot create a circle');
SELECT pg_temp.expect_error('42501', 'SELECT * FROM public.care_notes', 'anon table ACL');
RESET ROLE;

-- Look past the normal table ACLs to prove that the policies themselves exclude anon.
-- A synthetic owner subject gives predicates the strongest possible test case.
GRANT SELECT ON public.ai_log, public.care_notes, public.circle_join_requests, public.medication_doses,
  public.medication_schedules, public.pharmacy_items, public.stock_movements TO anon;
GRANT INSERT ON public.ai_log, public.care_notes, public.medication_schedules TO anon;
GRANT UPDATE ON public.medication_schedules, public.pharmacy_items TO anon;
GRANT DELETE ON public.care_notes TO anon;
SET LOCAL ROLE anon;
SELECT pg_temp.set_actor('owner');
SELECT pg_temp.test_reads(0, 0);
SELECT pg_temp.test_writes(false, false);
SELECT pg_temp.expect_count(0, $sql$
  WITH removed AS (DELETE FROM public.care_notes RETURNING 1) SELECT count(*) FROM removed
$sql$, 'anon DELETE policy excludes even the synthetic author context');
RESET ROLE;

ROLLBACK;
