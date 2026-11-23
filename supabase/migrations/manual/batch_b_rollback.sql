-- Manual Batch B rollback. Review dependencies and export any snapshots that must be retained.
BEGIN;
SET LOCAL search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS batch_b_circle_creator_immutable ON public.circles;
DROP TRIGGER IF EXISTS batch_b_owner_membership_guard ON public.circle_members;
DROP TRIGGER IF EXISTS batch_b_owner_delete_guard ON public.circle_members;
DROP TRIGGER IF EXISTS batch_b_owner_truncate_guard ON public.circle_members;
DROP TRIGGER IF EXISTS batch_b_shift_date_guard ON public.shifts;
DROP INDEX IF EXISTS public.circle_members_batch_b_one_owner;

ALTER TABLE public.medication_schedules ALTER COLUMN start_date SET DEFAULT CURRENT_DATE;

CREATE OR REPLACE FUNCTION public.claim_shift(shift_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  claimant uuid := auth.uid();
begin
  -- Lock the membership before the shift so claiming and leaving serialize.
  perform 1
  from public.circle_members m
  join public.shifts s on s.circle_id = m.circle_id
  where s.id = shift_id
    and m.user_id = claimant
  for key share of m;

  if not found then
    raise exception 'This shift is no longer available.';
  end if;

  update public.shifts s
  set assigned_to = claimant
  where s.id = shift_id
    and s.assigned_to is null;

  if not found then
    raise exception 'This shift is no longer available.';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_shift(shift_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.shifts s
     set assigned_to = null
   where s.id = shift_id
     and s.assigned_to = auth.uid();

  if not found then
    raise exception 'You can only release your own shifts.';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_dose_taken(p_schedule uuid, p_slot_date date DEFAULT NULL::date, p_slot_time time without time zone DEFAULT NULL::time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s record;
  it record;
  existing record;
  new_dose uuid;
  deduct numeric;
  flag boolean;
  note_text text;
  actor text := public.pharmacy_actor_name();
begin
  select * into s from public.medication_schedules where id = p_schedule;
  if not found then
    raise exception 'Schedule not found';
  end if;
  if not public.is_circle_member(s.circle_id) then
    raise exception 'You’re not part of this circle';
  end if;
  if not s.is_active then
    raise exception 'This medication schedule has been stopped';
  end if;

  if s.frequency = 'as_needed' then
    if p_slot_date is not null or p_slot_time is not null then
      raise exception 'As-needed doses don’t have a time slot';
    end if;
  elsif p_slot_date is null or p_slot_time is null then
    raise exception 'Missing dose time';
  end if;

  -- Lock the medicine so two caregivers can't change its stock at the same time
  select * into it from public.pharmacy_items where id = s.item_id for update;
  if not it.is_active then
    raise exception 'This medicine is inactive in the pharmacy';
  end if;

  deduct := least(it.stock, s.dose_amount);
  flag := it.stock < s.dose_amount;

  insert into public.medication_doses
    (circle_id, schedule_id, item_id, amount, slot_date, slot_time,
     taken_by, taken_by_name, stock_removed, stock_after, flagged)
  values
    (s.circle_id, s.id, s.item_id, s.dose_amount, p_slot_date, p_slot_time,
     auth.uid(), actor, deduct, it.stock - deduct, flag)
  on conflict (schedule_id, slot_date, slot_time) where status = 'taken' and slot_date is not null
  do nothing
  returning id into new_dose;

  if new_dose is null then
    select taken_by_name, taken_at into existing
    from public.medication_doses
    where schedule_id = s.id
      and slot_date = p_slot_date
      and slot_time = p_slot_time
      and status = 'taken';

    return jsonb_build_object('status', 'already_taken', 'by', existing.taken_by_name, 'at', existing.taken_at);
  end if;

  update public.pharmacy_items set stock = it.stock - deduct where id = it.id;

  note_text := case
    when not flag then null
    when deduct = 0 then 'Given with no stock on record'
    else 'Stock ran out during this dose'
  end;

  insert into public.stock_movements
    (circle_id, item_id, change, balance_after, reason, note, dose_id, created_by, created_by_name)
  values
    (s.circle_id, it.id, -deduct, it.stock - deduct, 'dose', note_text, new_dose, auth.uid(), actor);

  return jsonb_build_object(
    'status', 'ok',
    'dose_id', new_dose,
    'stock_after', it.stock - deduct,
    'flagged', flag
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.undo_dose(p_dose uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d record;
  it record;
  back numeric;
  actor text := public.pharmacy_actor_name();
begin
  select * into d from public.medication_doses where id = p_dose;
  if not found then
    raise exception 'Dose not found';
  end if;
  if not public.is_circle_member(d.circle_id) then
    raise exception 'You’re not part of this circle';
  end if;
  if d.status <> 'taken' then
    raise exception 'This dose was already undone';
  end if;

  if not public.pharmacy_is_owner(d.circle_id) then
    if d.taken_by is distinct from auth.uid() then
      raise exception 'You can only undo doses you recorded';
    end if;
    if now() - d.taken_at > interval '15 minutes' then
      raise exception 'The 15-minute undo window has passed. Ask the circle owner to undo it';
    end if;
  end if;

  select * into it from public.pharmacy_items where id = d.item_id for update;

  update public.medication_doses
  set status = 'undone', undone_by = auth.uid(), undone_by_name = actor, undone_at = now()
  where id = d.id
    and status = 'taken'
  returning stock_removed into back;

  if not found then
    raise exception 'This dose was already undone';
  end if;

  update public.pharmacy_items set stock = it.stock + back where id = it.id;

  insert into public.stock_movements
    (circle_id, item_id, change, balance_after, reason, note, dose_id, created_by, created_by_name)
  values
    (d.circle_id, it.id, back, it.stock + back, 'undo', 'Undid a dose recorded by ' || d.taken_by_name, d.id, auth.uid(), actor);

  return jsonb_build_object('status', 'ok', 'stock_after', it.stock + back);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_pharmacy_item(p_circle uuid, p_name text, p_strength text, p_form text, p_unit text, p_stock numeric, p_threshold numeric, p_expires date, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  new_id uuid;
  actor text := public.pharmacy_actor_name();
  opening numeric := coalesce(p_stock, 0);
begin
  if not public.pharmacy_is_owner(p_circle) then
    raise exception 'Only the circle owner can add medicines';
  end if;
  if opening < 0 then
    raise exception 'Stock can’t be negative';
  end if;

  begin
    insert into public.pharmacy_items
      (circle_id, name, strength, form, unit, stock, low_stock_threshold, expires_on, notes)
    values
      (p_circle, trim(p_name), nullif(trim(coalesce(p_strength, '')), ''),
       coalesce(nullif(p_form, ''), 'tablet'), coalesce(nullif(p_unit, ''), 'tablets'),
       opening, coalesce(p_threshold, 0), p_expires, nullif(trim(coalesce(p_notes, '')), ''))
    returning id into new_id;
  exception
    when unique_violation then
      raise exception 'That medicine is already in the pharmacy';
  end;

  if opening > 0 then
    insert into public.stock_movements
      (circle_id, item_id, change, balance_after, reason, note, created_by, created_by_name)
    values
      (p_circle, new_id, opening, opening, 'initial', 'Added to the pharmacy', auth.uid(), actor);
  end if;

  return new_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_pharmacy_stock(p_item uuid, p_mode text, p_amount numeric, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  it record;
  delta numeric;
  why text;
  new_stock numeric;
  actor text := public.pharmacy_actor_name();
begin
  select * into it from public.pharmacy_items where id = p_item for update;
  if not found then
    raise exception 'Medicine not found';
  end if;
  if not public.pharmacy_is_owner(it.circle_id) then
    raise exception 'Only the circle owner can change stock';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Enter a valid amount';
  end if;

  if p_mode = 'add' then
    if p_amount = 0 then
      raise exception 'Enter how much to add';
    end if;
    delta := p_amount;
    why := 'restock';
  elsif p_mode = 'remove' then
    if p_amount = 0 then
      raise exception 'Enter how much to remove';
    end if;
    if p_amount > it.stock then
      raise exception 'You can’t remove more than the current stock (%)', it.stock;
    end if;
    delta := -p_amount;
    why := case when p_reason in ('expired', 'discarded') then p_reason else 'other' end;
  elsif p_mode = 'set' then
    if nullif(trim(coalesce(p_note, '')), '') is null then
      raise exception 'Add a short note explaining the correction';
    end if;
    delta := p_amount - it.stock;
    why := 'correction';
    if delta = 0 then
      return it.stock;
    end if;
  else
    raise exception 'Unknown stock change';
  end if;

  new_stock := it.stock + delta;
  update public.pharmacy_items set stock = new_stock where id = it.id;

  insert into public.stock_movements
    (circle_id, item_id, change, balance_after, reason, note, created_by, created_by_name)
  values
    (it.circle_id, it.id, delta, new_stock, why, nullif(trim(coalesce(p_note, '')), ''), auth.uid(), actor);

  return new_stock;
end;
$function$;

CREATE OR REPLACE FUNCTION private.release_departing_member_shifts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Circle deletion already cascades to its shifts.
  if exists (select 1 from public.circles where id = old.circle_id) then
    update public.shifts
    set assigned_to = null
    where circle_id = old.circle_id
      and assigned_to = old.user_id;
  end if;
  return null;
end;
$function$;

-- This removes Batch B snapshots, including those captured after the backfill.
ALTER TABLE public.shifts DROP COLUMN IF EXISTS assigned_name;
DROP FUNCTION IF EXISTS private.batch_b_guard_circle_creator();
DROP FUNCTION IF EXISTS private.batch_b_guard_owner_membership();
DROP FUNCTION IF EXISTS private.batch_b_guard_owner_delete();
DROP FUNCTION IF EXISTS private.batch_b_guard_shift_date();
DROP FUNCTION IF EXISTS private.batch_b_shift_accepts_changes(date, text, timestamp without time zone);
DROP FUNCTION IF EXISTS private.batch_b_shift_slot_hours(text);
DROP FUNCTION IF EXISTS public.manila_now();
DROP FUNCTION IF EXISTS public.manila_today();

COMMIT;
