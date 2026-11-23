-- KALIN public schema baseline exported from the live Supabase project on 2026-11-23 (Asia/Manila).
-- This baseline has NOT been tested on a fresh database.
-- Target: a fresh Supabase PostgreSQL 17 project with its platform roles and auth.users.
-- This is a structure-only snapshot. For existing projects, retain their migration history.
-- Managed schemas, extension internals and platform default privileges are provisioned by Supabase.
-- The app's auth.users trigger and private leave-trigger function are included as dependencies.

BEGIN;
SET LOCAL search_path = pg_catalog, public;

-- Live extension inventory. plpgsql is built into a fresh Supabase database.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions"; -- live version 1.11
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions"; -- live version 1.3
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault"; -- live version 0.3.2
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions"; -- live version 1.1

CREATE SCHEMA IF NOT EXISTS "private" AUTHORIZATION "postgres";
REVOKE ALL PRIVILEGES ON SCHEMA "private" FROM PUBLIC, "anon", "authenticated", "service_role";

-- Tables. Foreign keys are added after all table definitions.
CREATE TABLE "public"."ai_log" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "circle_id" uuid NOT NULL,
  "kind" text DEFAULT 'handoff_brief'::text NOT NULL,
  "body" text NOT NULL,
  "created_by" uuid DEFAULT auth.uid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_log_kind_check" CHECK (kind = ANY (ARRAY['handoff_brief'::text, 'summary'::text])),
  CONSTRAINT "ai_log_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."ai_log" OWNER TO "postgres";

CREATE TABLE "public"."care_notes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "circle_id" uuid NOT NULL,
  "author_id" uuid DEFAULT auth.uid() NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "care_notes_body_check" CHECK (char_length(TRIM(BOTH FROM body)) >= 1 AND char_length(TRIM(BOTH FROM body)) <= 2000),
  CONSTRAINT "care_notes_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."care_notes" OWNER TO "postgres";

CREATE TABLE "public"."circle_join_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "circle_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "circle_name" text NOT NULL,
  "requester_name" text NOT NULL,
  "requester_email" text,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  CONSTRAINT "circle_join_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])),
  CONSTRAINT "circle_join_requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "circle_join_requests_circle_id_user_id_key" UNIQUE (circle_id, user_id)
);
ALTER TABLE "public"."circle_join_requests" OWNER TO "postgres";

CREATE TABLE "public"."circle_members" (
  "circle_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text DEFAULT 'member'::text NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "color" text NOT NULL,
  CONSTRAINT "circle_members_role_check" CHECK (role = ANY (ARRAY['owner'::text, 'member'::text])),
  CONSTRAINT "circle_members_pkey" PRIMARY KEY (circle_id, user_id)
);
ALTER TABLE "public"."circle_members" OWNER TO "postgres";

CREATE TABLE "public"."circle_tasks" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "circle_id" uuid NOT NULL,
  "title" text NOT NULL,
  "due_date" date,
  "is_done" boolean DEFAULT false NOT NULL,
  "created_by" uuid DEFAULT auth.uid(),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "circle_tasks_due_date_check" CHECK (due_date >= '0001-01-01'::date AND due_date <= '9999-12-31'::date),
  CONSTRAINT "circle_tasks_title_check" CHECK (char_length(title) >= 1 AND char_length(title) <= 120 AND title ~ '[^[:space:]]'::text),
  CONSTRAINT "circle_tasks_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."circle_tasks" OWNER TO "postgres";

CREATE TABLE "public"."circles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_by" uuid DEFAULT auth.uid() NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "invite_code" text NOT NULL,
  CONSTRAINT "circles_description_check" CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT "circles_name_check" CHECK (char_length(TRIM(BOTH FROM name)) >= 1 AND char_length(TRIM(BOTH FROM name)) <= 80),
  CONSTRAINT "circles_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."circles" OWNER TO "postgres";

CREATE TABLE "public"."home_digests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid DEFAULT auth.uid() NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "home_digests_body_check" CHECK (char_length(body) >= 1 AND char_length(body) <= 600),
  CONSTRAINT "home_digests_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."home_digests" OWNER TO "postgres";

CREATE TABLE "public"."medication_doses" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "circle_id" uuid NOT NULL,
  "schedule_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "amount" numeric(8,2) NOT NULL,
  "slot_date" date,
  "slot_time" time without time zone,
  "status" text DEFAULT 'taken'::text NOT NULL,
  "taken_by" uuid,
  "taken_by_name" text NOT NULL,
  "taken_at" timestamp with time zone DEFAULT now() NOT NULL,
  "undone_by" uuid,
  "undone_by_name" text,
  "undone_at" timestamp with time zone,
  "stock_removed" numeric(10,2) DEFAULT 0 NOT NULL,
  "stock_after" numeric(10,2) DEFAULT 0 NOT NULL,
  "flagged" boolean DEFAULT false NOT NULL,
  CONSTRAINT "medication_doses_check" CHECK ((slot_date IS NULL) = (slot_time IS NULL)),
  CONSTRAINT "medication_doses_status_check" CHECK (status = ANY (ARRAY['taken'::text, 'undone'::text])),
  CONSTRAINT "medication_doses_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."medication_doses" OWNER TO "postgres";

CREATE TABLE "public"."medication_schedules" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "circle_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "dose_amount" numeric(8,2) NOT NULL,
  "frequency" text NOT NULL,
  "days_of_week" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
  "interval_days" smallint,
  "times" time without time zone[] DEFAULT '{}'::time without time zone[] NOT NULL,
  "start_date" date DEFAULT CURRENT_DATE NOT NULL,
  "end_date" date,
  "instructions" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid DEFAULT auth.uid(),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "medication_schedules_check" CHECK (frequency = 'as_needed'::text OR cardinality(times) >= 1 AND cardinality(times) <= 8),
  CONSTRAINT "medication_schedules_check1" CHECK (frequency <> 'weekly'::text OR cardinality(days_of_week) >= 1 AND cardinality(days_of_week) <= 7),
  CONSTRAINT "medication_schedules_check2" CHECK (frequency <> 'interval'::text OR interval_days IS NOT NULL),
  CONSTRAINT "medication_schedules_check3" CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT "medication_schedules_dose_amount_check" CHECK (dose_amount > 0::numeric),
  CONSTRAINT "medication_schedules_frequency_check" CHECK (frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'interval'::text, 'as_needed'::text])),
  CONSTRAINT "medication_schedules_instructions_check" CHECK (char_length(instructions) <= 200),
  CONSTRAINT "medication_schedules_interval_days_check" CHECK (interval_days >= 2 AND interval_days <= 60),
  CONSTRAINT "medication_schedules_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."medication_schedules" OWNER TO "postgres";

CREATE TABLE "public"."pharmacy_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "circle_id" uuid NOT NULL,
  "name" text NOT NULL,
  "strength" text,
  "form" text DEFAULT 'tablet'::text NOT NULL,
  "unit" text DEFAULT 'tablets'::text NOT NULL,
  "stock" numeric(10,2) DEFAULT 0 NOT NULL,
  "low_stock_threshold" numeric(10,2) DEFAULT 0 NOT NULL,
  "expires_on" date,
  "notes" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid DEFAULT auth.uid(),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pharmacy_items_form_check" CHECK (form = ANY (ARRAY['tablet'::text, 'capsule'::text, 'liquid'::text, 'drops'::text, 'patch'::text, 'injection'::text, 'inhaler'::text, 'cream'::text, 'other'::text])),
  CONSTRAINT "pharmacy_items_low_stock_threshold_check" CHECK (low_stock_threshold >= 0::numeric),
  CONSTRAINT "pharmacy_items_name_check" CHECK (char_length(TRIM(BOTH FROM name)) >= 1 AND char_length(TRIM(BOTH FROM name)) <= 80),
  CONSTRAINT "pharmacy_items_notes_check" CHECK (char_length(notes) <= 300),
  CONSTRAINT "pharmacy_items_stock_check" CHECK (stock >= 0::numeric),
  CONSTRAINT "pharmacy_items_strength_check" CHECK (char_length(strength) <= 40),
  CONSTRAINT "pharmacy_items_unit_check" CHECK (char_length(unit) >= 1 AND char_length(unit) <= 20),
  CONSTRAINT "pharmacy_items_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."pharmacy_items" OWNER TO "postgres";

CREATE TABLE "public"."profiles" (
  "id" uuid NOT NULL,
  "full_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."profiles" OWNER TO "postgres";

CREATE TABLE "public"."shifts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "circle_id" uuid NOT NULL,
  "shift_date" date NOT NULL,
  "slot" text NOT NULL,
  "assigned_to" uuid,
  "created_by" uuid DEFAULT auth.uid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shifts_slot_check" CHECK (slot = ANY (ARRAY['morning'::text, 'evening'::text])),
  CONSTRAINT "shifts_pkey" PRIMARY KEY (id),
  CONSTRAINT "shifts_one_per_slot" UNIQUE (circle_id, shift_date, slot)
);
ALTER TABLE "public"."shifts" OWNER TO "postgres";

CREATE TABLE "public"."stock_movements" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "circle_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "change" numeric(10,2) NOT NULL,
  "balance_after" numeric(10,2) NOT NULL,
  "reason" text NOT NULL,
  "note" text,
  "dose_id" uuid,
  "created_by" uuid,
  "created_by_name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_movements_note_check" CHECK (char_length(note) <= 300),
  CONSTRAINT "stock_movements_reason_check" CHECK (reason = ANY (ARRAY['initial'::text, 'dose'::text, 'undo'::text, 'restock'::text, 'correction'::text, 'expired'::text, 'discarded'::text, 'other'::text])),
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."stock_movements" OWNER TO "postgres";

-- Foreign keys and secondary indexes.
ALTER TABLE "public"."ai_log" ADD CONSTRAINT "ai_log_circle_id_fkey" FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;
ALTER TABLE "public"."ai_log" ADD CONSTRAINT "ai_log_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."care_notes" ADD CONSTRAINT "care_notes_author_id_fkey" FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."care_notes" ADD CONSTRAINT "care_notes_circle_id_fkey" FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;
ALTER TABLE "public"."circle_join_requests" ADD CONSTRAINT "circle_join_requests_circle_id_fkey" FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;
ALTER TABLE "public"."circle_join_requests" ADD CONSTRAINT "circle_join_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."circle_members" ADD CONSTRAINT "circle_members_circle_id_fkey" FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;
ALTER TABLE "public"."circle_members" ADD CONSTRAINT "circle_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."circle_tasks" ADD CONSTRAINT "circle_tasks_circle_id_fkey" FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;
ALTER TABLE "public"."circle_tasks" ADD CONSTRAINT "circle_tasks_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "public"."circles" ADD CONSTRAINT "circles_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."home_digests" ADD CONSTRAINT "home_digests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."medication_doses" ADD CONSTRAINT "medication_doses_circle_id_fkey" FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;
ALTER TABLE "public"."medication_doses" ADD CONSTRAINT "medication_doses_item_id_fkey" FOREIGN KEY (item_id) REFERENCES public.pharmacy_items(id) ON DELETE CASCADE;
ALTER TABLE "public"."medication_doses" ADD CONSTRAINT "medication_doses_schedule_id_fkey" FOREIGN KEY (schedule_id) REFERENCES public.medication_schedules(id) ON DELETE CASCADE;
ALTER TABLE "public"."medication_doses" ADD CONSTRAINT "medication_doses_taken_by_fkey" FOREIGN KEY (taken_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "public"."medication_doses" ADD CONSTRAINT "medication_doses_undone_by_fkey" FOREIGN KEY (undone_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "public"."medication_schedules" ADD CONSTRAINT "medication_schedules_circle_id_fkey" FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;
ALTER TABLE "public"."medication_schedules" ADD CONSTRAINT "medication_schedules_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "public"."medication_schedules" ADD CONSTRAINT "medication_schedules_item_id_fkey" FOREIGN KEY (item_id) REFERENCES public.pharmacy_items(id) ON DELETE CASCADE;
ALTER TABLE "public"."pharmacy_items" ADD CONSTRAINT "pharmacy_items_circle_id_fkey" FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;
ALTER TABLE "public"."pharmacy_items" ADD CONSTRAINT "pharmacy_items_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."shifts" ADD CONSTRAINT "shifts_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE "public"."shifts" ADD CONSTRAINT "shifts_circle_id_fkey" FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;
ALTER TABLE "public"."shifts" ADD CONSTRAINT "shifts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_circle_id_fkey" FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_dose_id_fkey" FOREIGN KEY (dose_id) REFERENCES public.medication_doses(id) ON DELETE SET NULL;
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY (item_id) REFERENCES public.pharmacy_items(id) ON DELETE CASCADE;

CREATE INDEX ai_log_circle_id_created_at_idx ON public.ai_log USING btree (circle_id, created_at DESC);
CREATE INDEX care_notes_circle_id_created_at_idx ON public.care_notes USING btree (circle_id, created_at DESC);
CREATE INDEX circle_members_user_idx ON public.circle_members USING btree (user_id);
CREATE INDEX circle_tasks_circle_id_id_idx ON public.circle_tasks USING btree (circle_id, id);
CREATE UNIQUE INDEX circles_invite_code_key ON public.circles USING btree (invite_code);
CREATE INDEX home_digests_user_created_idx ON public.home_digests USING btree (user_id, created_at DESC);
CREATE INDEX medication_doses_circle_day ON public.medication_doses USING btree (circle_id, slot_date);
CREATE INDEX medication_doses_circle_taken ON public.medication_doses USING btree (circle_id, taken_at DESC);
CREATE UNIQUE INDEX medication_doses_one_taken_per_slot ON public.medication_doses USING btree (schedule_id, slot_date, slot_time) WHERE ((status = 'taken'::text) AND (slot_date IS NOT NULL));
CREATE INDEX medication_schedules_circle ON public.medication_schedules USING btree (circle_id);
CREATE INDEX pharmacy_items_circle ON public.pharmacy_items USING btree (circle_id);
CREATE UNIQUE INDEX pharmacy_items_unique_medicine ON public.pharmacy_items USING btree (circle_id, lower(TRIM(BOTH FROM name)), lower(COALESCE(TRIM(BOTH FROM strength), ''::text)));
CREATE INDEX shifts_assigned_idx ON public.shifts USING btree (assigned_to);
CREATE INDEX shifts_circle_date_idx ON public.shifts USING btree (circle_id, shift_date);
CREATE INDEX stock_movements_item ON public.stock_movements USING btree (item_id, created_at DESC);

-- Functions, including the private trigger dependency.
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
ALTER FUNCTION "private"."release_departing_member_shifts"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.add_circle_owner_membership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.circle_members (circle_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (circle_id, user_id) do nothing;
  return new;
end;
$function$;
ALTER FUNCTION "public"."add_circle_owner_membership"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.add_circle_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.circle_members (circle_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$function$;
ALTER FUNCTION "public"."add_circle_owner"() OWNER TO "postgres";

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
ALTER FUNCTION "public"."adjust_pharmacy_stock"(p_item uuid, p_mode text, p_amount numeric, p_reason text, p_note text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.assign_member_color()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.color is null then
    new.color := public.next_circle_color(new.user_id);
  end if;
  return new;
end;
$function$;
ALTER FUNCTION "public"."assign_member_color"() OWNER TO "postgres";

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
ALTER FUNCTION "public"."claim_shift"(shift_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.create_circle(p_name text, p_description text)
 RETURNS TABLE(id uuid, name text, description text, created_by uuid, created_at timestamp with time zone, color text, invite_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_circle uuid;
begin
  if v_user is null then raise exception 'Sign in before creating a circle.'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 60 then
    raise exception 'Circle name must be between 1 and 60 characters.';
  end if;
  if char_length(coalesce(p_description, '')) > 120 then
    raise exception 'Circle description must be 120 characters or fewer.';
  end if;
  insert into public.circles as c (name, description, created_by)
  values (trim(p_name), nullif(trim(p_description), ''), v_user)
  returning c.id into v_circle;

  return query select c.id, c.name, c.description, c.created_by, c.created_at, m.color, c.invite_code
  from public.circles c join public.circle_members m on m.circle_id = c.id and m.user_id = v_user
  where c.id = v_circle;
end;
$function$;
ALTER FUNCTION "public"."create_circle"(p_name text, p_description text) OWNER TO "postgres";

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
ALTER FUNCTION "public"."create_pharmacy_item"(p_circle uuid, p_name text, p_strength text, p_form text, p_unit text, p_stock numeric, p_threshold numeric, p_expires date, p_notes text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.enforce_home_digest_cooldown()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));
  new.created_at := pg_catalog.clock_timestamp();
  if exists (
    select 1 from public.home_digests
    where user_id = new.user_id and created_at > new.created_at - interval '60 seconds'
  ) then
    raise exception 'Home brief cooldown' using errcode = 'P0429';
  end if;
  return new;
end;
$function$;
ALTER FUNCTION "public"."enforce_home_digest_cooldown"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.generate_invite_code()
 RETURNS text
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$function$;
ALTER FUNCTION "public"."generate_invite_code"() OWNER TO "postgres";

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
ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.is_circle_member(cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.circle_members
    where circle_id = cid and user_id = auth.uid()
  );
$function$;
ALTER FUNCTION "public"."is_circle_member"(cid uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.is_circle_owner(target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.circles
    where id = target and created_by = auth.uid()
  );
$function$;
ALTER FUNCTION "public"."is_circle_owner"(target uuid) OWNER TO "postgres";

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
ALTER FUNCTION "public"."mark_dose_taken"(p_schedule uuid, p_slot_date date, p_slot_time time without time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.next_circle_color(uid uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  palette constant text[] := array[
    '#8fe3c8', '#b9b8ff', '#8cc8f5', '#ffc999', '#f7a8c4', '#f3dc7a',
    '#bfe58a', '#f2958a', '#7fdde4', '#d3a8f2', '#d9c3a0', '#a9b8cc'
  ];
  pick text;
begin
  -- First palette color this person isn't using in an active circle
  select p.color into pick
  from unnest(palette) with ordinality as p(color, ord)
  where not exists (
    select 1
    from public.circle_members m
    join public.circles c on c.id = m.circle_id
    where m.user_id = uid
      and m.color = p.color
      and c.is_active
  )
  order by p.ord
  limit 1;

  if pick is not null then
    return pick;
  end if;

  -- All 12 are taken: reuse the least-used one
  select p.color into pick
  from unnest(palette) with ordinality as p(color, ord)
  order by (
    select count(*)
    from public.circle_members m
    join public.circles c on c.id = m.circle_id
    where m.user_id = uid
      and m.color = p.color
      and c.is_active
  ), p.ord
  limit 1;

  return pick;
end;
$function$;
ALTER FUNCTION "public"."next_circle_color"(uid uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.owns_circle(target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.circles c
    where c.id = target and c.created_by = auth.uid()
  );
$function$;
ALTER FUNCTION "public"."owns_circle"(target uuid) OWNER TO "postgres";

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
ALTER FUNCTION "public"."pharmacy_actor_name"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.pharmacy_is_owner(target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.circle_members
    where circle_id = target
      and user_id = auth.uid()
      and role = 'owner'
  );
$function$;
ALTER FUNCTION "public"."pharmacy_is_owner"(target uuid) OWNER TO "postgres";

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
ALTER FUNCTION "public"."release_shift"(shift_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.request_to_join_circle(p_invite_code text)
 RETURNS TABLE(circle_name text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  outcome jsonb := public.request_to_join(p_invite_code);
begin
  case outcome ->> 'status'
    when 'pending' then return query select outcome ->> 'circle_name';
    when 'member' then raise exception 'You are already a member of this circle.';
    when 'denied' then raise exception 'Your previous request was declined.';
    else raise exception 'Invalid or inactive invite code.';
  end case;
end;
$function$;
ALTER FUNCTION "public"."request_to_join_circle"(p_invite_code text) OWNER TO "postgres";

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
ALTER FUNCTION "public"."request_to_join"(p_code text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.respond_to_join_request(p_request uuid, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.circle_join_requests%rowtype;
begin
  if p_approve is null then raise exception 'Choose whether to approve the request.'; end if;
  select q.* into r from public.circle_join_requests q
  where q.id = p_request and q.status = 'pending'
  and exists (select 1 from public.circles c where c.id = q.circle_id and c.created_by = auth.uid())
  for update of q;
  if not found then raise exception 'This request is no longer pending or you cannot review it.'; end if;

  if p_approve then
    insert into public.circle_members (circle_id, user_id, role)
    values (r.circle_id, r.user_id, 'member')
    on conflict (circle_id, user_id) do nothing;
  end if;

  update public.circle_join_requests
  set status = case when p_approve then 'approved' else 'denied' end, decided_at = now()
  where id = r.id;
end;
$function$;
ALTER FUNCTION "public"."respond_to_join_request"(p_request uuid, p_approve boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.review_circle_join_request(p_request_id uuid, p_approve boolean)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select public.respond_to_join_request(p_request_id, p_approve) $function$;
ALTER FUNCTION "public"."review_circle_join_request"(p_request_id uuid, p_approve boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.shares_circle_with(other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.circle_members mine
    join public.circle_members theirs on theirs.circle_id = mine.circle_id
    where mine.user_id = auth.uid()
      and theirs.user_id = other
  );
$function$;
ALTER FUNCTION "public"."shares_circle_with"(other uuid) OWNER TO "postgres";

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
ALTER FUNCTION "public"."undo_dose"(p_dose uuid) OWNER TO "postgres";

-- Column defaults that depend on app functions.
ALTER TABLE "public"."circles" ALTER COLUMN "invite_code" SET DEFAULT "public"."generate_invite_code"();

-- Triggers.
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER circle_members_assign_color BEFORE INSERT ON public.circle_members FOR EACH ROW EXECUTE FUNCTION public.assign_member_color();
CREATE TRIGGER release_departing_member_shifts AFTER DELETE ON public.circle_members FOR EACH ROW WHEN ((old.role = 'member'::text)) EXECUTE FUNCTION private.release_departing_member_shifts();
CREATE TRIGGER on_circle_created AFTER INSERT ON public.circles FOR EACH ROW EXECUTE FUNCTION public.add_circle_owner();
CREATE TRIGGER home_digest_cooldown BEFORE INSERT ON public.home_digests FOR EACH ROW EXECUTE FUNCTION public.enforce_home_digest_cooldown();

-- Row-level security and policies.
ALTER TABLE "public"."ai_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."care_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."circle_join_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."circle_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."circle_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."circles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."home_digests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."medication_doses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."medication_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."pharmacy_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can save AI log" ON "public"."ai_log"
  AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((created_by = auth.uid()) AND is_circle_member(circle_id)));

CREATE POLICY "Members can view AI log" ON "public"."ai_log"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (is_circle_member(circle_id));

CREATE POLICY "Authors can delete their notes" ON "public"."care_notes"
  AS PERMISSIVE FOR DELETE TO PUBLIC
  USING ((author_id = auth.uid()));

CREATE POLICY "Members can add notes" ON "public"."care_notes"
  AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((author_id = auth.uid()) AND is_circle_member(circle_id)));

CREATE POLICY "Members can view notes" ON "public"."care_notes"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (is_circle_member(circle_id));

CREATE POLICY "Requester or circle owner can view requests" ON "public"."circle_join_requests"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM circles c
  WHERE ((c.id = circle_join_requests.circle_id) AND (c.created_by = auth.uid()))))));

CREATE POLICY "leave circle" ON "public"."circle_members"
  AS PERMISSIVE FOR DELETE TO "authenticated"
  USING (((user_id = auth.uid()) AND (role <> 'owner'::text)));

CREATE POLICY "members read members" ON "public"."circle_members"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (is_circle_member(circle_id));

CREATE POLICY "Creators and owners can delete tasks" ON "public"."circle_tasks"
  AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((is_circle_member(circle_id) AND ((created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM circle_members m
  WHERE ((m.circle_id = circle_tasks.circle_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = 'owner'::text)))))));

CREATE POLICY "Members can add tasks" ON "public"."circle_tasks"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((is_circle_member(circle_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "Members can read tasks" ON "public"."circle_tasks"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (is_circle_member(circle_id));

CREATE POLICY "Members can update tasks" ON "public"."circle_tasks"
  AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING (is_circle_member(circle_id))
  WITH CHECK (is_circle_member(circle_id));

CREATE POLICY "members read circles" ON "public"."circles"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (((created_by = auth.uid()) OR is_circle_member(id)));

CREATE POLICY "owner deletes circle" ON "public"."circles"
  AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((created_by = auth.uid()));

CREATE POLICY "owner updates circle" ON "public"."circles"
  AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((created_by = auth.uid()))
  WITH CHECK ((created_by = auth.uid()));

CREATE POLICY "users create circles" ON "public"."circles"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((created_by = auth.uid()));

CREATE POLICY "Insert own home digests" ON "public"."home_digests"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Read own home digests" ON "public"."home_digests"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Members can view doses" ON "public"."medication_doses"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (is_circle_member(circle_id));

CREATE POLICY "Members can view schedules" ON "public"."medication_schedules"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (is_circle_member(circle_id));

CREATE POLICY "Owners can add schedules" ON "public"."medication_schedules"
  AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK ((pharmacy_is_owner(circle_id) AND (EXISTS ( SELECT 1
   FROM pharmacy_items i
  WHERE ((i.id = medication_schedules.item_id) AND (i.circle_id = medication_schedules.circle_id) AND i.is_active)))));

CREATE POLICY "Owners can update schedules" ON "public"."medication_schedules"
  AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (pharmacy_is_owner(circle_id))
  WITH CHECK (pharmacy_is_owner(circle_id));

CREATE POLICY "Members can view pharmacy items" ON "public"."pharmacy_items"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (is_circle_member(circle_id));

CREATE POLICY "Owners can update pharmacy items" ON "public"."pharmacy_items"
  AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (pharmacy_is_owner(circle_id))
  WITH CHECK (pharmacy_is_owner(circle_id));

CREATE POLICY "Read own and circle-mates profiles" ON "public"."profiles"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (((id = auth.uid()) OR shares_circle_with(id)));

CREATE POLICY "Update own profile" ON "public"."profiles"
  AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));

CREATE POLICY "Members can view shifts" ON "public"."shifts"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (is_circle_member(circle_id));

CREATE POLICY "Owners can create shifts" ON "public"."shifts"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((is_circle_owner(circle_id) AND (assigned_to IS NULL) AND (created_by = auth.uid())));

CREATE POLICY "Owners can delete shifts" ON "public"."shifts"
  AS PERMISSIVE FOR DELETE TO "authenticated"
  USING (is_circle_owner(circle_id));

CREATE POLICY "Members can view stock history" ON "public"."stock_movements"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (is_circle_member(circle_id));

-- Per-object privileges. Clear grants inherited at creation from Supabase defaults.
REVOKE ALL PRIVILEGES ON SCHEMA "public" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT USAGE ON SCHEMA "public" TO PUBLIC, "postgres", "anon", "authenticated", "service_role";

REVOKE ALL PRIVILEGES ON TABLE "public"."ai_log" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."ai_log" TO "service_role";
GRANT SELECT ON TABLE "public"."ai_log" TO "authenticated";
GRANT INSERT ("circle_id", "kind", "body", "created_by") ON TABLE "public"."ai_log" TO "authenticated";

REVOKE ALL PRIVILEGES ON TABLE "public"."care_notes" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."care_notes" TO "service_role";
GRANT SELECT, DELETE ON TABLE "public"."care_notes" TO "authenticated";
GRANT INSERT ("circle_id", "body") ON TABLE "public"."care_notes" TO "authenticated";

REVOKE ALL PRIVILEGES ON TABLE "public"."circle_join_requests" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."circle_join_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."circle_join_requests" TO "authenticated";

REVOKE ALL PRIVILEGES ON TABLE "public"."circle_members" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."circle_members" TO "service_role";
GRANT SELECT, DELETE ON TABLE "public"."circle_members" TO "authenticated";

REVOKE ALL PRIVILEGES ON TABLE "public"."circle_tasks" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."circle_tasks" TO "service_role";
GRANT SELECT, DELETE ON TABLE "public"."circle_tasks" TO "authenticated";
GRANT INSERT ("circle_id", "title", "due_date") ON TABLE "public"."circle_tasks" TO "authenticated";
GRANT UPDATE ("title", "due_date", "is_done") ON TABLE "public"."circle_tasks" TO "authenticated";

REVOKE ALL PRIVILEGES ON TABLE "public"."circles" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."circles" TO "service_role";
GRANT SELECT, DELETE ON TABLE "public"."circles" TO "authenticated";
GRANT INSERT ("name", "description") ON TABLE "public"."circles" TO "authenticated";
GRANT UPDATE ("name", "description", "is_active") ON TABLE "public"."circles" TO "authenticated";

REVOKE ALL PRIVILEGES ON TABLE "public"."home_digests" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."home_digests" TO "service_role";
GRANT INSERT, SELECT ON TABLE "public"."home_digests" TO "authenticated";

REVOKE ALL PRIVILEGES ON TABLE "public"."medication_doses" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."medication_doses" TO "service_role";
GRANT SELECT ON TABLE "public"."medication_doses" TO "authenticated";

REVOKE ALL PRIVILEGES ON TABLE "public"."medication_schedules" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."medication_schedules" TO "service_role";
GRANT SELECT ON TABLE "public"."medication_schedules" TO "authenticated";
GRANT INSERT ("circle_id", "item_id", "dose_amount", "frequency", "days_of_week", "interval_days", "times", "start_date", "end_date", "instructions") ON TABLE "public"."medication_schedules" TO "authenticated";
GRANT UPDATE ("is_active") ON TABLE "public"."medication_schedules" TO "authenticated";

REVOKE ALL PRIVILEGES ON TABLE "public"."pharmacy_items" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."pharmacy_items" TO "service_role";
GRANT SELECT ON TABLE "public"."pharmacy_items" TO "authenticated";
GRANT UPDATE ("name", "strength", "form", "unit", "low_stock_threshold", "expires_on", "notes", "is_active") ON TABLE "public"."pharmacy_items" TO "authenticated";

REVOKE ALL PRIVILEGES ON TABLE "public"."profiles" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";
GRANT UPDATE ("full_name") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL PRIVILEGES ON TABLE "public"."shifts" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."shifts" TO "service_role";
GRANT SELECT, DELETE ON TABLE "public"."shifts" TO "authenticated";
GRANT INSERT ("circle_id", "shift_date", "slot") ON TABLE "public"."shifts" TO "authenticated";

REVOKE ALL PRIVILEGES ON TABLE "public"."stock_movements" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."stock_movements" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_movements" TO "authenticated";

REVOKE ALL PRIVILEGES ON FUNCTION "private"."release_departing_member_shifts"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."add_circle_owner_membership"() FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."add_circle_owner_membership"() TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."add_circle_owner"() FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."add_circle_owner"() TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."adjust_pharmacy_stock"(p_item uuid, p_mode text, p_amount numeric, p_reason text, p_note text) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."adjust_pharmacy_stock"(p_item uuid, p_mode text, p_amount numeric, p_reason text, p_note text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."adjust_pharmacy_stock"(p_item uuid, p_mode text, p_amount numeric, p_reason text, p_note text) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."assign_member_color"() FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."assign_member_color"() TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."claim_shift"(shift_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."claim_shift"(shift_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."claim_shift"(shift_id uuid) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."create_circle"(p_name text, p_description text) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."create_circle"(p_name text, p_description text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."create_circle"(p_name text, p_description text) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."create_pharmacy_item"(p_circle uuid, p_name text, p_strength text, p_form text, p_unit text, p_stock numeric, p_threshold numeric, p_expires date, p_notes text) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."create_pharmacy_item"(p_circle uuid, p_name text, p_strength text, p_form text, p_unit text, p_stock numeric, p_threshold numeric, p_expires date, p_notes text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."create_pharmacy_item"(p_circle uuid, p_name text, p_strength text, p_form text, p_unit text, p_stock numeric, p_threshold numeric, p_expires date, p_notes text) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."enforce_home_digest_cooldown"() FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."enforce_home_digest_cooldown"() TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."generate_invite_code"() FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."generate_invite_code"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."generate_invite_code"() TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."handle_new_user"() FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."is_circle_member"(cid uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."is_circle_member"(cid uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."is_circle_member"(cid uuid) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."is_circle_owner"(target uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."is_circle_owner"(target uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."is_circle_owner"(target uuid) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."mark_dose_taken"(p_schedule uuid, p_slot_date date, p_slot_time time without time zone) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."mark_dose_taken"(p_schedule uuid, p_slot_date date, p_slot_time time without time zone) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."mark_dose_taken"(p_schedule uuid, p_slot_date date, p_slot_time time without time zone) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."next_circle_color"(uid uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."next_circle_color"(uid uuid) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."owns_circle"(target uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."owns_circle"(target uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."owns_circle"(target uuid) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."pharmacy_actor_name"() FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."pharmacy_actor_name"() TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."pharmacy_is_owner"(target uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."pharmacy_is_owner"(target uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."pharmacy_is_owner"(target uuid) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."release_shift"(shift_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."release_shift"(shift_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."release_shift"(shift_id uuid) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."request_to_join_circle"(p_invite_code text) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."request_to_join_circle"(p_invite_code text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."request_to_join_circle"(p_invite_code text) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."request_to_join"(p_code text) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."request_to_join"(p_code text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."request_to_join"(p_code text) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."respond_to_join_request"(p_request uuid, p_approve boolean) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."respond_to_join_request"(p_request uuid, p_approve boolean) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."respond_to_join_request"(p_request uuid, p_approve boolean) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."review_circle_join_request"(p_request_id uuid, p_approve boolean) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."review_circle_join_request"(p_request_id uuid, p_approve boolean) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."review_circle_join_request"(p_request_id uuid, p_approve boolean) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."shares_circle_with"(other uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."shares_circle_with"(other uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."shares_circle_with"(other uuid) TO "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."undo_dose"(p_dose uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."undo_dose"(p_dose uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."undo_dose"(p_dose uuid) TO "service_role";

COMMIT;
