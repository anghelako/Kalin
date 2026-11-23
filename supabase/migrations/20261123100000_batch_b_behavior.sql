-- Batch B assumes the live baseline and Batch A.
BEGIN;
SET LOCAL search_path = pg_catalog, public;

-- INT-04: calendar dates and the live slot clock always use Manila.
CREATE OR REPLACE FUNCTION public.manila_today()
RETURNS date
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT pg_catalog.timezone('Asia/Manila', pg_catalog.statement_timestamp())::date;
$function$;

CREATE OR REPLACE FUNCTION public.manila_now()
RETURNS timestamp without time zone
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT pg_catalog.timezone('Asia/Manila', pg_catalog.clock_timestamp());
$function$;

REVOKE ALL ON FUNCTION public.manila_today(), public.manila_now() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manila_today(), public.manila_now() TO authenticated, service_role;

-- INT-01: hold both ownership tables against concurrent writes during the preflight.
LOCK TABLE public.circles, public.circle_members IN SHARE ROW EXCLUSIVE MODE;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.circles c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.circle_members m
      WHERE m.circle_id = c.id AND m.user_id = c.created_by AND m.role = 'owner'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.circle_members m
    JOIN public.circles c ON c.id = m.circle_id
    WHERE m.role = 'owner' AND m.user_id <> c.created_by
  ) THEN
    RAISE EXCEPTION 'circle_owner_invariant_violation';
  END IF;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS circle_members_batch_b_one_owner
  ON public.circle_members (circle_id) WHERE role = 'owner';

CREATE OR REPLACE FUNCTION private.batch_b_guard_circle_creator()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'circle_creator_immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.batch_b_guard_owner_membership()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  creator uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.role = 'owner' THEN
    RAISE EXCEPTION 'circle_owner_immutable';
  END IF;

  SELECT c.created_by INTO creator FROM public.circles c WHERE c.id = NEW.circle_id;
  IF NEW.role = 'owner' AND NEW.user_id IS DISTINCT FROM creator THEN
    RAISE EXCEPTION 'circle_owner_must_be_creator';
  ELSIF NEW.role <> 'owner' AND NEW.user_id = creator THEN
    RAISE EXCEPTION 'circle_creator_must_be_owner';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.batch_b_guard_owner_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM public.circles) THEN
      RAISE EXCEPTION 'circle_owner_cannot_leave';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.circles c WHERE c.id = OLD.circle_id) THEN
    RAISE EXCEPTION 'circle_owner_cannot_leave';
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.batch_b_guard_circle_creator(),
  private.batch_b_guard_owner_membership(), private.batch_b_guard_owner_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS batch_b_circle_creator_immutable ON public.circles;
CREATE TRIGGER batch_b_circle_creator_immutable
  BEFORE UPDATE OF created_by ON public.circles
  FOR EACH ROW EXECUTE FUNCTION private.batch_b_guard_circle_creator();

DROP TRIGGER IF EXISTS batch_b_owner_membership_guard ON public.circle_members;
CREATE TRIGGER batch_b_owner_membership_guard
  BEFORE INSERT OR UPDATE ON public.circle_members
  FOR EACH ROW EXECUTE FUNCTION private.batch_b_guard_owner_membership();

-- Defer the parent check so both circle and Auth-account cascades can finish.
DROP TRIGGER IF EXISTS batch_b_owner_delete_guard ON public.circle_members;
CREATE CONSTRAINT TRIGGER batch_b_owner_delete_guard
  AFTER DELETE ON public.circle_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.role = 'owner')
  EXECUTE FUNCTION private.batch_b_guard_owner_delete();

DROP TRIGGER IF EXISTS batch_b_owner_truncate_guard ON public.circle_members;
CREATE TRIGGER batch_b_owner_truncate_guard
  BEFORE TRUNCATE ON public.circle_members
  FOR EACH STATEMENT EXECUTE FUNCTION private.batch_b_guard_owner_delete();

-- FN-01, FN-04, FN-03, INT-07, INT-08: Manila shift cutoffs and assignment history.
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS assigned_name text;
REVOKE INSERT (assigned_name), UPDATE (assigned_name) ON public.shifts
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.batch_b_shift_slot_hours(p_slot text)
RETURNS TABLE(starts_at time without time zone, ends_at time without time zone)
LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT hours.starts_at, hours.ends_at
  FROM (VALUES ('morning', time '07:00', time '15:00'),
               ('evening', time '15:00', time '22:00')) AS hours(slot, starts_at, ends_at)
  WHERE hours.slot = p_slot;
$function$;

-- All claim/release cutoff policy is here. Shift RPCs sample the clock after locking.
CREATE OR REPLACE FUNCTION private.batch_b_shift_accepts_changes(
  p_date date, p_slot text, p_manila_at timestamp without time zone
)
RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT coalesce((
    SELECT p_manila_at < p_date + hours.starts_at
    FROM private.batch_b_shift_slot_hours(p_slot) hours
  ), false);
$function$;

CREATE OR REPLACE FUNCTION private.batch_b_guard_shift_date()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.shift_date < public.manila_today() THEN
    RAISE EXCEPTION 'shift_in_past';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.batch_b_shift_slot_hours(text),
  private.batch_b_shift_accepts_changes(date, text, timestamp without time zone),
  private.batch_b_guard_shift_date() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS batch_b_shift_date_guard ON public.shifts;
CREATE TRIGGER batch_b_shift_date_guard
  BEFORE INSERT ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION private.batch_b_guard_shift_date();

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
    target_shift.shift_date, target_shift.slot, public.manila_now()
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
    target_shift.shift_date, target_shift.slot, public.manila_now()
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
      AND s.shift_date >= public.manila_today()
      AND departed_at < s.shift_date + (
        SELECT hours.ends_at FROM private.batch_b_shift_slot_hours(s.slot) hours
      );
  END IF;
  RETURN NULL;
END;
$function$;

-- Backfill only missing snapshots on already-assigned shifts. Existing names are preserved.
UPDATE public.shifts s
SET assigned_name = coalesce(nullif(pg_catalog.btrim(p.full_name), ''), 'Member')
FROM public.profiles p
WHERE s.assigned_to = p.id AND s.assigned_name IS NULL;

ALTER TABLE public.medication_schedules
  ALTER COLUMN start_date SET DEFAULT public.manila_today();

-- FN-02 and FN-05: membership, schedule, stock, then dose. Shared locks keep
-- membership and schedule eligibility stable while item writes serialize.
CREATE OR REPLACE FUNCTION public.mark_dose_taken(
  p_schedule uuid, p_slot_date date DEFAULT NULL::date,
  p_slot_time time without time zone DEFAULT NULL::time without time zone
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  target_circle uuid;
  schedule public.medication_schedules%ROWTYPE;
  item public.pharmacy_items%ROWTYPE;
  existing record;
  new_dose uuid;
  deduct numeric;
  flagged_dose boolean;
  note_text text;
  actor text := public.pharmacy_actor_name();
BEGIN
  SELECT s.circle_id INTO target_circle
  FROM public.medication_schedules s WHERE s.id = p_schedule;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule not found';
  END IF;
  PERFORM 1 FROM public.circle_members m
  WHERE m.circle_id = target_circle AND m.user_id = caller
  FOR SHARE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  SELECT s.* INTO schedule FROM public.medication_schedules s
  WHERE s.id = p_schedule AND s.circle_id = target_circle
  FOR SHARE OF s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule not found';
  END IF;
  IF NOT schedule.is_active THEN
    RAISE EXCEPTION 'schedule_inactive';
  END IF;

  IF schedule.frequency = 'as_needed' THEN
    IF p_slot_date IS NOT NULL OR p_slot_time IS NOT NULL THEN
      RAISE EXCEPTION 'As-needed doses don’t have a time slot';
    END IF;
  ELSE
    IF p_slot_date IS NULL OR p_slot_time IS NULL OR NOT pg_catalog.isfinite(p_slot_date)
       OR p_slot_time >= time '24:00' THEN
      RAISE EXCEPTION 'invalid_dose_slot';
    END IF;
    IF p_slot_date > public.manila_today() THEN
      RAISE EXCEPTION 'dose_slot_in_future';
    END IF;
    IF p_slot_date < schedule.start_date OR p_slot_date > schedule.end_date
       OR NOT coalesce(p_slot_time = ANY (schedule.times), false) THEN
      RAISE EXCEPTION 'invalid_dose_slot';
    END IF;
    IF schedule.frequency = 'weekly' AND NOT coalesce(
      EXTRACT(DOW FROM p_slot_date)::smallint = ANY (schedule.days_of_week), false
    ) THEN
      RAISE EXCEPTION 'invalid_dose_slot';
    END IF;
    IF schedule.frequency = 'interval' AND NOT coalesce(
      pg_catalog.mod(p_slot_date - schedule.start_date, nullif(schedule.interval_days, 0)) = 0,
      false
    ) THEN
      RAISE EXCEPTION 'invalid_dose_slot';
    END IF;
  END IF;

  SELECT i.* INTO item FROM public.pharmacy_items i
  WHERE i.id = schedule.item_id AND i.circle_id = target_circle
  FOR UPDATE OF i;
  IF NOT FOUND OR NOT item.is_active THEN
    RAISE EXCEPTION 'item_inactive';
  END IF;

  deduct := least(item.stock, schedule.dose_amount);
  flagged_dose := item.stock < schedule.dose_amount;
  INSERT INTO public.medication_doses
    (circle_id, schedule_id, item_id, amount, slot_date, slot_time,
     taken_by, taken_by_name, stock_removed, stock_after, flagged)
  VALUES
    (target_circle, schedule.id, item.id, schedule.dose_amount, p_slot_date, p_slot_time,
     caller, actor, deduct, item.stock - deduct, flagged_dose)
  ON CONFLICT (schedule_id, slot_date, slot_time) WHERE status = 'taken' AND slot_date IS NOT NULL
  DO NOTHING
  RETURNING id INTO new_dose;

  IF new_dose IS NULL THEN
    SELECT d.taken_by_name, d.taken_at INTO existing FROM public.medication_doses d
    WHERE d.schedule_id = schedule.id AND d.slot_date = p_slot_date
      AND d.slot_time = p_slot_time AND d.status = 'taken';
    RETURN pg_catalog.jsonb_build_object(
      'status', 'already_taken', 'by', existing.taken_by_name, 'at', existing.taken_at
    );
  END IF;

  UPDATE public.pharmacy_items SET stock = item.stock - deduct WHERE id = item.id;
  note_text := CASE
    WHEN NOT flagged_dose THEN NULL
    WHEN deduct = 0 THEN 'Given with no stock on record'
    ELSE 'Stock ran out during this dose'
  END;
  INSERT INTO public.stock_movements
    (circle_id, item_id, change, balance_after, reason, note, dose_id, created_by, created_by_name)
  VALUES (target_circle, item.id, -deduct, item.stock - deduct, 'dose', note_text, new_dose, caller, actor);

  RETURN pg_catalog.jsonb_build_object(
    'status', 'ok', 'dose_id', new_dose, 'stock_after', item.stock - deduct, 'flagged', flagged_dose
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.undo_dose(p_dose uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  actor text := public.pharmacy_actor_name();
  membership_role text;
  target_schedule uuid;
  dose public.medication_doses%ROWTYPE;
  item public.pharmacy_items%ROWTYPE;
  restored numeric;
  undone_time timestamp with time zone;
BEGIN
  SELECT d.* INTO dose FROM public.medication_doses d WHERE d.id = p_dose;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dose not found';
  END IF;
  target_schedule := dose.schedule_id;
  SELECT m.role INTO membership_role FROM public.circle_members m
  WHERE m.circle_id = dose.circle_id AND m.user_id = caller
  FOR SHARE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  PERFORM 1 FROM public.medication_schedules s
  WHERE s.id = target_schedule AND s.circle_id = dose.circle_id AND s.item_id = dose.item_id
  FOR SHARE OF s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dose not found';
  END IF;

  SELECT i.* INTO item FROM public.pharmacy_items i
  WHERE i.id = dose.item_id AND i.circle_id = dose.circle_id
  FOR UPDATE OF i;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dose not found';
  END IF;

  -- Undo remains possible after deactivation so an incorrect record can be reversed.
  SELECT d.* INTO dose FROM public.medication_doses d
  WHERE d.id = p_dose AND d.circle_id = item.circle_id AND d.item_id = item.id
    AND d.schedule_id = target_schedule
  FOR UPDATE OF d;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dose not found';
  END IF;
  IF dose.status <> 'taken' THEN
    RAISE EXCEPTION 'This dose was already undone';
  END IF;
  undone_time := pg_catalog.clock_timestamp();
  IF membership_role <> 'owner' THEN
    IF dose.taken_by IS DISTINCT FROM caller THEN
      RAISE EXCEPTION 'You can only undo doses you recorded';
    END IF;
    IF undone_time - dose.taken_at > interval '15 minutes' THEN
      RAISE EXCEPTION 'The 15-minute undo window has passed. Ask the circle owner to undo it';
    END IF;
  END IF;

  UPDATE public.medication_doses
  SET status = 'undone', undone_by = caller, undone_by_name = actor, undone_at = undone_time
  WHERE id = p_dose AND status = 'taken'
  RETURNING stock_removed INTO restored;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This dose was already undone';
  END IF;

  UPDATE public.pharmacy_items SET stock = item.stock + restored WHERE id = item.id;
  INSERT INTO public.stock_movements
    (circle_id, item_id, change, balance_after, reason, note, dose_id, created_by, created_by_name)
  VALUES (dose.circle_id, item.id, restored, item.stock + restored, 'undo',
          'Undid a dose recorded by ' || dose.taken_by_name, dose.id, caller, actor);

  RETURN pg_catalog.jsonb_build_object('status', 'ok', 'stock_after', item.stock + restored);
END;
$function$;

-- FN-09: check scale before coercing to the storage type, and derive ledger
-- values from balances actually stored in the item row.
CREATE OR REPLACE FUNCTION public.create_pharmacy_item(
  p_circle uuid, p_name text, p_strength text, p_form text, p_unit text,
  p_stock numeric, p_threshold numeric, p_expires date, p_notes text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  amount_limit constant numeric := 99999999.99;
  provided_stock numeric := coalesce(p_stock, 0);
  provided_threshold numeric := coalesce(p_threshold, 0);
  stored_stock numeric(10,2);
  new_id uuid;
  actor text := public.pharmacy_actor_name();
BEGIN
  IF NOT public.pharmacy_is_owner(p_circle) THEN
    RAISE EXCEPTION 'Only the circle owner can add medicines';
  END IF;
  IF NOT (provided_stock BETWEEN 0 AND amount_limit) OR pg_catalog.scale(provided_stock) > 2 THEN
    RAISE EXCEPTION 'invalid_stock_amount';
  END IF;
  IF NOT (provided_threshold BETWEEN 0 AND amount_limit) OR pg_catalog.scale(provided_threshold) > 2 THEN
    RAISE EXCEPTION 'invalid_stock_threshold';
  END IF;

  BEGIN
    INSERT INTO public.pharmacy_items
      (circle_id, name, strength, form, unit, stock, low_stock_threshold, expires_on, notes)
    VALUES
      (p_circle, trim(p_name), nullif(trim(coalesce(p_strength, '')), ''),
       coalesce(nullif(p_form, ''), 'tablet'), coalesce(nullif(p_unit, ''), 'tablets'),
       provided_stock::numeric(10,2), provided_threshold::numeric(10,2),
       p_expires, nullif(trim(coalesce(p_notes, '')), ''))
    RETURNING id, stock INTO new_id, stored_stock;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That medicine is already in the pharmacy';
  END;

  IF stored_stock > 0 THEN
    INSERT INTO public.stock_movements
      (circle_id, item_id, change, balance_after, reason, note, created_by, created_by_name)
    VALUES (p_circle, new_id, stored_stock, stored_stock, 'initial', 'Added to the pharmacy', auth.uid(), actor);
  END IF;
  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_pharmacy_stock(
  p_item uuid, p_mode text, p_amount numeric,
  p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text
)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  amount_limit constant numeric := 99999999.99;
  item public.pharmacy_items%ROWTYPE;
  amount numeric(10,2);
  target_stock numeric;
  stored_stock numeric(10,2);
  reason_code text;
  actor text := public.pharmacy_actor_name();
BEGIN
  SELECT i.* INTO item FROM public.pharmacy_items i WHERE i.id = p_item FOR UPDATE OF i;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medicine not found';
  END IF;
  IF NOT public.pharmacy_is_owner(item.circle_id) THEN
    RAISE EXCEPTION 'Only the circle owner can change stock';
  END IF;
  IF p_amount IS NULL OR NOT (p_amount BETWEEN 0 AND amount_limit)
     OR pg_catalog.scale(p_amount) > 2
     OR (p_mode IN ('add', 'remove') AND p_amount = 0) THEN
    RAISE EXCEPTION 'invalid_stock_amount';
  END IF;
  amount := p_amount::numeric(10,2);

  IF p_mode = 'add' THEN
    target_stock := item.stock + amount;
    reason_code := 'restock';
  ELSIF p_mode = 'remove' THEN
    IF amount > item.stock THEN
      RAISE EXCEPTION 'You can’t remove more than the current stock (%)', item.stock;
    END IF;
    target_stock := item.stock - amount;
    reason_code := CASE WHEN p_reason IN ('expired', 'discarded') THEN p_reason ELSE 'other' END;
  ELSIF p_mode = 'set' THEN
    IF nullif(trim(coalesce(p_note, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Add a short note explaining the correction';
    END IF;
    target_stock := amount;
    reason_code := 'correction';
  ELSE
    RAISE EXCEPTION 'Unknown stock change';
  END IF;

  IF NOT (target_stock BETWEEN 0 AND amount_limit)
     OR NOT (item.stock BETWEEN 0 AND amount_limit) THEN
    RAISE EXCEPTION 'stock_limit_exceeded';
  END IF;
  IF target_stock = item.stock THEN
    RETURN item.stock;
  END IF;

  UPDATE public.pharmacy_items SET stock = target_stock::numeric(10,2) WHERE id = item.id
  RETURNING stock INTO stored_stock;
  INSERT INTO public.stock_movements
    (circle_id, item_id, change, balance_after, reason, note, created_by, created_by_name)
  VALUES (item.circle_id, item.id, stored_stock - item.stock, stored_stock, reason_code,
          nullif(trim(coalesce(p_note, '')), ''), auth.uid(), actor);

  RETURN stored_stock;
END;
$function$;

COMMIT;
