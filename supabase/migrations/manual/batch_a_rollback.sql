-- Manual rollback. Restores the 2026-11-23 baseline definitions and postgres defaults.
-- Run only after confirming no subsequent release depends on Batch A.
BEGIN;
SET LOCAL search_path = pg_catalog, public;

ALTER TABLE public.circles
  DROP CONSTRAINT IF EXISTS circles_batch_a_name_length,
  DROP CONSTRAINT IF EXISTS circles_batch_a_description_length;
ALTER TABLE public.medication_schedules
  DROP CONSTRAINT IF EXISTS medication_schedules_batch_a_weekdays,
  DROP CONSTRAINT IF EXISTS medication_schedules_batch_a_times;
DROP FUNCTION IF EXISTS private.batch_a_valid_medication_weekdays(smallint[]);
DROP FUNCTION IF EXISTS private.batch_a_valid_medication_times(time without time zone[]);

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pharmacy_actor_name()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''),
    nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
    'Someone'
  );
$function$;

CREATE OR REPLACE FUNCTION public.request_to_join(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  c record;
  existing record;
  meta jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  display_name text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  select id, name into c
  from public.circles
  where is_active
    and invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));

  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  if exists (
    select 1 from public.circle_members
    where circle_id = c.id and user_id = uid
  ) then
    return jsonb_build_object('status', 'member', 'circle_name', c.name);
  end if;

  select * into existing
  from public.circle_join_requests
  where circle_id = c.id and user_id = uid
  for update;

  if found then
    if existing.status in ('pending', 'denied') then
      return jsonb_build_object('status', existing.status, 'circle_name', c.name);
    end if;

    -- Approved earlier but no longer a member: ask again
    update public.circle_join_requests
    set status = 'pending', decided_at = null, circle_name = c.name
    where id = existing.id;

    return jsonb_build_object('status', 'pending', 'circle_name', c.name);
  end if;

  display_name := coalesce(
    nullif(trim(meta ->> 'full_name'), ''),
    nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
    'Someone'
  );

  insert into public.circle_join_requests (circle_id, user_id, circle_name, requester_name, requester_email)
  values (c.id, uid, c.name, display_name, auth.jwt() ->> 'email')
  on conflict (circle_id, user_id) do nothing;

  select r.status into existing from public.circle_join_requests r
  where r.circle_id = c.id and r.user_id = uid;
  return jsonb_build_object('status', coalesce(existing.status, 'pending'), 'circle_name', c.name);
end;
$function$;

ALTER FUNCTION public.add_circle_owner() SET search_path TO public;
ALTER FUNCTION public.add_circle_owner_membership() SET search_path TO public, pg_temp;
ALTER FUNCTION public.is_circle_member(uuid) SET search_path TO public;
ALTER FUNCTION public.owns_circle(uuid) SET search_path TO public, pg_temp;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;

DROP POLICY IF EXISTS "Members can save AI log" ON "public"."ai_log";
CREATE POLICY "Members can save AI log" ON "public"."ai_log"
  AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((created_by = auth.uid()) AND is_circle_member(circle_id)));

DROP POLICY IF EXISTS "Members can view AI log" ON "public"."ai_log";
CREATE POLICY "Members can view AI log" ON "public"."ai_log"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (is_circle_member(circle_id));

DROP POLICY IF EXISTS "Authors can delete their notes" ON "public"."care_notes";
CREATE POLICY "Authors can delete their notes" ON "public"."care_notes"
  AS PERMISSIVE FOR DELETE TO PUBLIC
  USING ((author_id = auth.uid()));

DROP POLICY IF EXISTS "Members can add notes" ON "public"."care_notes";
CREATE POLICY "Members can add notes" ON "public"."care_notes"
  AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((author_id = auth.uid()) AND is_circle_member(circle_id)));

DROP POLICY IF EXISTS "Members can view notes" ON "public"."care_notes";
CREATE POLICY "Members can view notes" ON "public"."care_notes"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (is_circle_member(circle_id));

DROP POLICY IF EXISTS "Requester or circle owner can view requests" ON "public"."circle_join_requests";
CREATE POLICY "Requester or circle owner can view requests" ON "public"."circle_join_requests"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM circles c
  WHERE ((c.id = circle_join_requests.circle_id) AND (c.created_by = auth.uid()))))));

DROP POLICY IF EXISTS "Members can view doses" ON "public"."medication_doses";
CREATE POLICY "Members can view doses" ON "public"."medication_doses"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (is_circle_member(circle_id));

DROP POLICY IF EXISTS "Members can view schedules" ON "public"."medication_schedules";
CREATE POLICY "Members can view schedules" ON "public"."medication_schedules"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (is_circle_member(circle_id));

DROP POLICY IF EXISTS "Owners can add schedules" ON "public"."medication_schedules";
CREATE POLICY "Owners can add schedules" ON "public"."medication_schedules"
  AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK ((pharmacy_is_owner(circle_id) AND (EXISTS ( SELECT 1
   FROM pharmacy_items i
  WHERE ((i.id = medication_schedules.item_id) AND (i.circle_id = medication_schedules.circle_id) AND i.is_active)))));

DROP POLICY IF EXISTS "Owners can update schedules" ON "public"."medication_schedules";
CREATE POLICY "Owners can update schedules" ON "public"."medication_schedules"
  AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (pharmacy_is_owner(circle_id))
  WITH CHECK (pharmacy_is_owner(circle_id));

DROP POLICY IF EXISTS "Members can view pharmacy items" ON "public"."pharmacy_items";
CREATE POLICY "Members can view pharmacy items" ON "public"."pharmacy_items"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (is_circle_member(circle_id));

DROP POLICY IF EXISTS "Owners can update pharmacy items" ON "public"."pharmacy_items";
CREATE POLICY "Owners can update pharmacy items" ON "public"."pharmacy_items"
  AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (pharmacy_is_owner(circle_id))
  WITH CHECK (pharmacy_is_owner(circle_id));

DROP POLICY IF EXISTS "Members can view stock history" ON "public"."stock_movements";
CREATE POLICY "Members can view stock history" ON "public"."stock_movements"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (is_circle_member(circle_id));

COMMIT;
