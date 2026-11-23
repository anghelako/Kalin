-- Batch C assumes the live baseline and Batches A and B.
BEGIN;

ALTER TABLE public.circles
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_log
  ADD COLUMN IF NOT EXISTS verified_generation boolean NOT NULL DEFAULT false;

REVOKE INSERT, UPDATE ON TABLE public.ai_log FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, circle_id, kind, body, created_by, created_at, verified_generation),
       UPDATE (id, circle_id, kind, body, created_by, created_at, verified_generation)
  ON TABLE public.ai_log FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Members can save AI log" ON public.ai_log;

REVOKE INSERT (ai_enabled), UPDATE (ai_enabled)
  ON TABLE public.circles FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.ai_generation_reservations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Keep the user's daily attempt when its circle is deleted.
  circle_id uuid REFERENCES public.circles(id) ON DELETE SET NULL,
  reserved_at timestamp with time zone NOT NULL
);
ALTER TABLE private.ai_generation_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.ai_generation_reservations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE private.ai_generation_reservations_id_seq FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS ai_generation_reservations_user_at
  ON private.ai_generation_reservations (user_id, reserved_at);
CREATE INDEX IF NOT EXISTS ai_generation_reservations_circle_at
  ON private.ai_generation_reservations (circle_id, reserved_at);

CREATE OR REPLACE FUNCTION public.set_circle_ai_enabled(p_circle_id uuid, p_enabled boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN RETURN 'unauthorized'; END IF;
  IF p_enabled IS NULL THEN RETURN 'invalid_request'; END IF;

  UPDATE public.circles
  SET ai_enabled = p_enabled
  WHERE id = p_circle_id AND created_by = caller;
  IF NOT FOUND THEN RETURN 'not_owner'; END IF;
  RETURN 'ok';
END;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_ai_generation(circle_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  target_circle uuid := circle_id;
  circle_enabled boolean;
  reserved_time timestamp with time zone;
  day_start timestamp with time zone;
BEGIN
  IF caller IS NULL THEN RETURN 'unauthorized'; END IF;
  IF NOT public.is_circle_member(target_circle) THEN RETURN 'not_a_member'; END IF;

  -- Distinct lock namespaces and fixed order serialize cross-circle user caps
  -- and cross-user circle cooldowns, including across Edge instances.
  PERFORM pg_catalog.pg_advisory_xact_lock(114511, pg_catalog.hashtext(caller::text));
  PERFORM pg_catalog.pg_advisory_xact_lock(114512, pg_catalog.hashtext(target_circle::text));

  SELECT c.ai_enabled AND c.is_active INTO circle_enabled
  FROM public.circles c WHERE c.id = target_circle FOR SHARE OF c;
  IF NOT FOUND THEN RETURN 'not_a_member'; END IF;
  PERFORM 1 FROM public.circle_members m
  WHERE m.circle_id = target_circle AND m.user_id = caller FOR KEY SHARE OF m;
  IF NOT FOUND THEN RETURN 'not_a_member'; END IF;
  IF NOT circle_enabled THEN RETURN 'ai_disabled'; END IF;

  reserved_time := pg_catalog.clock_timestamp();
  day_start := pg_catalog.date_trunc('day', reserved_time, 'Asia/Manila');

  IF (SELECT count(*) FROM private.ai_generation_reservations r
      WHERE r.user_id = caller AND r.reserved_at >= day_start) >= 10 THEN
    RETURN 'daily_limit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.ai_generation_reservations r
    WHERE r.circle_id = target_circle
      AND r.reserved_at > reserved_time - interval '60 seconds'
  ) THEN
    RETURN 'cooldown';
  END IF;

  -- Retain the cross-midnight cooldown and clear this user's older history.
  DELETE FROM private.ai_generation_reservations r
  WHERE r.user_id = caller AND r.reserved_at < least(day_start, reserved_time - interval '60 seconds');
  INSERT INTO private.ai_generation_reservations (user_id, circle_id, reserved_at)
  VALUES (caller, target_circle, reserved_time);
  RETURN 'ok';
END;
$function$;

REVOKE ALL ON FUNCTION public.set_circle_ai_enabled(uuid, boolean), public.reserve_ai_generation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_circle_ai_enabled(uuid, boolean), public.reserve_ai_generation(uuid)
  TO authenticated;

COMMIT;
