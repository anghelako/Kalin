-- Shifts get a specific start and end time instead of the fixed morning/evening slots.
-- Existing shifts are converted: morning = 07:00-15:00, evening = 15:00-22:00.
-- Times are Manila wall-clock times, same as before.
-- A shift whose end time is not later than its start time runs past midnight and ends the next day,
-- so a day can be covered in full (06:00-18:00, then 18:00-06:00). It can't start and end at the same time.
-- Safe to run more than once, in any order relative to 20261128100000_overnight_shifts.sql.

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS starts_at time without time zone,
  ADD COLUMN IF NOT EXISTS ends_at time without time zone;

UPDATE public.shifts
SET starts_at = CASE slot WHEN 'morning' THEN time '07:00' ELSE time '15:00' END,
    ends_at   = CASE slot WHEN 'morning' THEN time '15:00' ELSE time '22:00' END
WHERE starts_at IS NULL OR ends_at IS NULL;

ALTER TABLE public.shifts
  ALTER COLUMN starts_at SET NOT NULL,
  ALTER COLUMN ends_at SET NOT NULL,
  ALTER COLUMN slot DROP NOT NULL;

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_slot_check;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_one_per_slot;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_time_order_check;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_one_per_start;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_time_order_check CHECK (ends_at <> starts_at),
  ADD CONSTRAINT shifts_one_per_start UNIQUE (circle_id, shift_date, starts_at);

-- New shifts are created with times, not with the old slot name.
REVOKE INSERT (slot) ON TABLE public.shifts FROM authenticated;
GRANT INSERT (starts_at, ends_at) ON TABLE public.shifts TO authenticated;

-- Shifts in one circle can't overlap, including a night shift running into the next day's shifts.
-- An identical shift is let through so the calendar's "skip shifts that already exist" insert keeps working.
CREATE OR REPLACE FUNCTION private.shift_overlap_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  new_start timestamp without time zone := NEW.shift_date + NEW.starts_at;
  new_end timestamp without time zone := NEW.shift_date + NEW.ends_at
    + CASE WHEN NEW.ends_at <= NEW.starts_at THEN interval '1 day' ELSE interval '0' END;
BEGIN
  -- Start = end is rejected by shifts_time_order_check, which gives the clearer error.
  IF NEW.ends_at = NEW.starts_at THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.circle_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.circle_id = NEW.circle_id
      AND s.shift_date BETWEEN NEW.shift_date - 1 AND NEW.shift_date + 1
      AND (s.shift_date + s.starts_at) < new_end
      AND new_start < (s.shift_date + s.ends_at
        + CASE WHEN s.ends_at <= s.starts_at THEN interval '1 day' ELSE interval '0' END)
      AND NOT (s.shift_date = NEW.shift_date AND s.starts_at = NEW.starts_at AND s.ends_at = NEW.ends_at)
  ) THEN
    RAISE EXCEPTION 'shift_overlap';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.shift_overlap_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS shift_overlap_guard ON public.shifts;
CREATE TRIGGER shift_overlap_guard
  BEFORE INSERT ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION private.shift_overlap_guard();

-- Claim/release cutoff: changes are accepted until the shift's own start time.
CREATE OR REPLACE FUNCTION private.batch_b_shift_accepts_changes(
  p_date date, p_starts_at time without time zone, p_manila_at timestamp without time zone
)
RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT p_manila_at < p_date + p_starts_at;
$function$;

REVOKE ALL ON FUNCTION private.batch_b_shift_accepts_changes(date, time without time zone, timestamp without time zone)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_shift(shift_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  target_circle uuid;
  target_shift public.shifts%ROWTYPE;
BEGIN
  SELECT s.circle_id INTO target_circle FROM public.shifts s WHERE s.id = shift_id;
  PERFORM 1 FROM public.circle_members m
  WHERE m.circle_id = target_circle AND m.user_id = caller
  FOR KEY SHARE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  SELECT s.* INTO target_shift FROM public.shifts s
  WHERE s.id = shift_id AND s.circle_id = target_circle
  FOR NO KEY UPDATE OF s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_taken';
  END IF;
  IF NOT private.batch_b_shift_accepts_changes(
    target_shift.shift_date, target_shift.starts_at, public.manila_now()
  ) THEN
    RAISE EXCEPTION 'shift_started';
  END IF;

  UPDATE public.shifts s
  SET assigned_to = caller,
      assigned_name = coalesce((
        SELECT nullif(pg_catalog.btrim(p.full_name), '')
        FROM public.profiles p WHERE p.id = caller
      ), 'Member')
  WHERE s.id = shift_id AND s.assigned_to IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_taken';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_shift(shift_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  target_circle uuid;
  target_shift public.shifts%ROWTYPE;
BEGIN
  SELECT s.circle_id INTO target_circle FROM public.shifts s WHERE s.id = shift_id;
  PERFORM 1 FROM public.circle_members m
  WHERE m.circle_id = target_circle AND m.user_id = caller
  FOR KEY SHARE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  SELECT s.* INTO target_shift FROM public.shifts s
  WHERE s.id = shift_id AND s.circle_id = target_circle
  FOR NO KEY UPDATE OF s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_taken';
  END IF;
  IF NOT private.batch_b_shift_accepts_changes(
    target_shift.shift_date, target_shift.starts_at, public.manila_now()
  ) THEN
    RAISE EXCEPTION 'shift_started';
  END IF;

  UPDATE public.shifts s
  SET assigned_to = NULL, assigned_name = NULL
  WHERE s.id = shift_id AND s.assigned_to = caller;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_taken';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.release_departing_member_shifts()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  departed_at timestamp without time zone := public.manila_now();
BEGIN
  -- Circle deletion takes care of its own shifts through the foreign key.
  IF EXISTS (SELECT 1 FROM public.circles c WHERE c.id = OLD.circle_id) THEN
    UPDATE public.shifts s
    SET assigned_to = NULL, assigned_name = NULL
    WHERE s.circle_id = OLD.circle_id AND s.assigned_to = OLD.user_id
      AND departed_at < s.shift_date + s.ends_at
        + CASE WHEN s.ends_at <= s.starts_at THEN interval '1 day' ELSE interval '0' END;
  END IF;
  RETURN NULL;
END;
$function$;

-- The old slot lookups are no longer used.
DROP FUNCTION IF EXISTS private.batch_b_shift_accepts_changes(date, text, timestamp without time zone);
DROP FUNCTION IF EXISTS private.batch_b_shift_slot_hours(text);
