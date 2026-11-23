-- Manual rollback to the Batch B schema. Disable deployed AI endpoints first.
-- This restores client AI-log inserts and removes consent, quotas and provenance markers.
BEGIN;

DROP FUNCTION IF EXISTS public.reserve_ai_generation(uuid);
DROP FUNCTION IF EXISTS public.set_circle_ai_enabled(uuid, boolean);
DROP TABLE IF EXISTS private.ai_generation_reservations;
ALTER TABLE public.circles DROP COLUMN IF EXISTS ai_enabled;
ALTER TABLE public.ai_log DROP COLUMN IF EXISTS verified_generation;

DROP POLICY IF EXISTS "Members can save AI log" ON public.ai_log;
CREATE POLICY "Members can save AI log" ON public.ai_log
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_circle_member(circle_id));
GRANT INSERT (circle_id, kind, body, created_by) ON public.ai_log TO authenticated;

COMMIT;
