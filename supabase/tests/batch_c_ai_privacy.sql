-- Run as postgres on a disposable database after Batch C. Fixtures roll back.
BEGIN;

CREATE TEMP TABLE batch_c_fixture (label text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO batch_c_fixture SELECT label, gen_random_uuid()
FROM unnest(ARRAY['owner', 'member', 'outsider', 'circle', 'other_circle']) AS labels(label);
GRANT SELECT ON batch_c_fixture TO authenticated, anon, service_role;

CREATE FUNCTION pg_temp.fixture(kind text) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM pg_temp.batch_c_fixture WHERE label = kind
$$;

CREATE FUNCTION pg_temp.actor(kind text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  id uuid := pg_temp.fixture(kind);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(id::text, ''), true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', id)::text, true);
END;
$$;

CREATE FUNCTION pg_temp.check_result(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Batch C assertion: %', label; END IF;
END;
$$;

CREATE FUNCTION pg_temp.expect_denied(statement text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  RAISE EXCEPTION 'Batch C expected an access denial';
END;
$$;

INSERT INTO auth.users (id)
SELECT id FROM batch_c_fixture WHERE label IN ('owner', 'member', 'outsider');
INSERT INTO public.circles (id, name, created_by)
VALUES (pg_temp.fixture('circle'), 'Synthetic consent circle', pg_temp.fixture('owner')),
       (pg_temp.fixture('other_circle'), 'Synthetic cap circle', pg_temp.fixture('owner'));
INSERT INTO public.circle_members (circle_id, user_id)
VALUES (pg_temp.fixture('circle'), pg_temp.fixture('member'));

SET LOCAL ROLE authenticated;
SELECT pg_temp.actor('owner');
SELECT pg_temp.check_result(
  (SELECT ai_enabled IS FALSE FROM public.circles WHERE id = pg_temp.fixture('circle')) AND
  public.reserve_ai_generation(pg_temp.fixture('circle')) = 'ai_disabled', 'circle defaults to disabled'
);
SELECT pg_temp.expect_denied('UPDATE public.circles SET ai_enabled = true WHERE id = pg_temp.fixture(''circle'')');
SELECT pg_temp.expect_denied($sql$
  INSERT INTO public.circles (name,ai_enabled) VALUES ('Synthetic direct enable',true)
$sql$);
SELECT pg_temp.check_result(public.set_circle_ai_enabled(pg_temp.fixture('circle'), true) = 'ok', 'owner enables consent');
SELECT pg_temp.check_result(public.set_circle_ai_enabled(pg_temp.fixture('other_circle'), true) = 'ok', 'owner enables a second circle');
SELECT pg_temp.check_result(public.reserve_ai_generation(pg_temp.fixture('circle')) = 'ok', 'enabled owner can reserve');

SELECT pg_temp.actor('member');
SELECT pg_temp.check_result(public.set_circle_ai_enabled(pg_temp.fixture('circle'), false) = 'not_owner', 'member cannot change consent');
SELECT pg_temp.check_result(public.reserve_ai_generation(pg_temp.fixture('circle')) = 'cooldown', 'one circle cooldown applies across members');
SELECT pg_temp.expect_denied($sql$
  INSERT INTO public.ai_log (circle_id, kind, body) VALUES (pg_temp.fixture('circle'), 'summary', 'Synthetic forged draft')
$sql$);
SELECT pg_temp.expect_denied($sql$
  INSERT INTO public.ai_log (circle_id, kind, body, verified_generation)
  VALUES (pg_temp.fixture('circle'), 'summary', 'Synthetic forged verification', true)
$sql$);
INSERT INTO public.care_notes (circle_id, body) VALUES (pg_temp.fixture('circle'), 'Synthetic note remains writable');

SELECT pg_temp.actor('outsider');
SELECT pg_temp.check_result(public.reserve_ai_generation(pg_temp.fixture('circle')) = 'not_a_member', 'outsider cannot reserve');
SELECT pg_temp.check_result(public.set_circle_ai_enabled(pg_temp.fixture('circle'), true) = 'not_owner', 'outsider cannot opt a circle in');
SELECT pg_temp.actor(NULL);
SELECT pg_temp.check_result(public.reserve_ai_generation(pg_temp.fixture('circle')) = 'unauthorized', 'missing UID fails closed');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.expect_denied('SELECT public.reserve_ai_generation(pg_temp.fixture(''circle''))');
SELECT pg_temp.expect_denied('SELECT public.set_circle_ai_enabled(pg_temp.fixture(''circle''), true)');
SELECT pg_temp.expect_denied('SELECT * FROM public.ai_log');
RESET ROLE;

SET LOCAL ROLE service_role;
INSERT INTO public.ai_log (circle_id, kind, body, created_by, verified_generation)
VALUES (pg_temp.fixture('circle'), 'summary', 'Synthetic server-written draft', pg_temp.fixture('owner'), true);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.actor('member');
SELECT pg_temp.check_result(EXISTS (
  SELECT 1 FROM public.ai_log WHERE circle_id = pg_temp.fixture('circle') AND verified_generation
), 'members can still read a verified draft');
SELECT pg_temp.actor('outsider');
SELECT pg_temp.check_result(NOT EXISTS (
  SELECT 1 FROM public.ai_log WHERE circle_id = pg_temp.fixture('circle')
), 'outsiders cannot read the draft');
SELECT pg_temp.actor('owner');
SELECT pg_temp.check_result(public.set_circle_ai_enabled(pg_temp.fixture('circle'), false) = 'ok', 'owner can disable consent');
SELECT pg_temp.check_result(public.reserve_ai_generation(pg_temp.fixture('circle')) = 'ai_disabled', 'opt-out blocks new reservations');
RESET ROLE;

INSERT INTO private.ai_generation_reservations (user_id, circle_id, reserved_at)
SELECT pg_temp.fixture('owner'), pg_temp.fixture('circle'), date_trunc('day', clock_timestamp(), 'Asia/Manila')
FROM generate_series(1, 9);
DELETE FROM public.circles WHERE id = pg_temp.fixture('circle');
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor('owner');
SELECT pg_temp.check_result(public.reserve_ai_generation(pg_temp.fixture('other_circle')) = 'daily_limit',
  'Manila daily cap covers other circles and survives deleting the source circle');
RESET ROLE;

SELECT pg_temp.check_result(NOT EXISTS (
  SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  WHERE p.oid IN ('public.reserve_ai_generation(uuid)'::regprocedure, 'public.set_circle_ai_enabled(uuid,boolean)'::regprocedure)
    AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
), 'new RPCs have no implicit PUBLIC execute');

ROLLBACK;
